import { createHash, createHmac } from "node:crypto";

export type CosClientConfig = {
  secretId: string;
  secretKey: string;
  token?: string;
  region: string;
  bucket: string;
  scheme?: string;
  endpoint?: string;
  timeoutMs?: number;
  maxRetries?: number;
};

/** COS 返回非 2xx 且不可自动处理时抛出；message 只含对象键摘要、状态码与 request id。 */
export class CosError extends Error {
  constructor(
    readonly operation: string,
    readonly key: string,
    readonly status?: number,
    readonly requestId?: string,
  ) {
    super(
      `cos ${operation} failed: key=${key.slice(0, 16)} status=${status ?? "network"} requestId=${requestId ?? "-"}`,
    );
    this.name = "CosError";
  }
}

const encodeKeyPath = (key: string) =>
  key.split("/").map(encodeURIComponent).join("/");

/**
 * 腾讯云 COS XML API 的窄封装：仅对象 PUT/GET/DELETE，JSON 载荷。
 * 授权头、SecretId/SecretKey/Token 绝不进入错误信息或日志。
 */
export class CosClient {
  private readonly scheme: string;
  private readonly host: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(private readonly config: CosClientConfig) {
    this.scheme = config.scheme ?? "https";
    this.host = config.endpoint
      ? config.endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "")
      : `${config.bucket}.cos.${config.region}.myqcloud.com`;
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.maxRetries = config.maxRetries ?? 3;
  }

  /** 404 返回 undefined；创建探测与幂等删除之外的 404 分类由调用方负责。 */
  async get(key: string): Promise<string | undefined> {
    const response = await this.request("get", key);
    if (response.status === 404) return undefined;
    await this.expect("get", key, response);
    return await response.text();
  }

  async put(key: string, body: string): Promise<void> {
    await this.expect("put", key, await this.request("put", key, body));
  }

  /** 幂等删除；404 视为已删除。 */
  async delete(key: string): Promise<void> {
    const response = await this.request("delete", key);
    if (response.status === 404) return;
    await this.expect("delete", key, response);
    await response.body?.cancel().catch(() => {});
  }

  private url(key: string) {
    return `${this.scheme}://${this.host}/${encodeKeyPath(key)}`;
  }

  /** q-sign-algorithm=sha1 签名；空 header/param 列表，host 不参与签名。 */
  private authorization(method: string, key: string) {
    const now = Math.floor(Date.now() / 1000);
    const keyTime = `${now - 60};${now + 600}`;
    const signKey = createHmac("sha1", this.config.secretKey)
      .update(keyTime)
      .digest("hex");
    const path = `/${encodeKeyPath(key)}`;
    // COS 规范要求 HttpString 使用小写方法名。
    const httpString = `${method.toLowerCase()}\n${path}\n\n\n`;
    const stringToSign = `sha1\n${keyTime}\n${createHash("sha1").update(httpString).digest("hex")}\n`;
    const signature = createHmac("sha1", signKey)
      .update(stringToSign)
      .digest("hex");
    return (
      `q-sign-algorithm=sha1&q-ak=${this.config.secretId}&q-sign-time=${keyTime}` +
      `&q-key-time=${keyTime}&q-header-list=&q-url-param-list=&q-signature=${signature}`
    );
  }

  private async request(
    method: "get" | "put" | "delete",
    key: string,
    body?: string,
  ): Promise<Response> {
    const url = this.url(key);
    let lastError: unknown;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      if (attempt)
        await new Promise((resolve) =>
          setTimeout(resolve, 100 * 4 ** (attempt - 1)),
        );
      try {
        const headers: Record<string, string> = {
          authorization: this.authorization(method.toUpperCase(), key),
        };
        if (this.config.token)
          headers["x-cos-security-token"] = this.config.token;
        if (body !== undefined)
          headers["content-type"] = "application/json; charset=utf-8";
        const response = await fetch(url, {
          method: method.toUpperCase(),
          headers,
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        // 限流与 5xx 重试；其余状态交给调用方分类。
        if (response.status >= 500 || response.status === 429) {
          lastError = new CosError(
            method,
            key,
            response.status,
            requestId(response),
          );
          await response.body?.cancel().catch(() => {});
          continue;
        }
        return response;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof CosError
      ? lastError
      : new CosError(method, key);
  }

  private async expect(operation: string, key: string, response: Response) {
    if (response.ok) return;
    await response.body?.cancel().catch(() => {});
    throw new CosError(operation, key, response.status, requestId(response));
  }
}

const requestId = (response: Response) =>
  response.headers.get("x-cos-request-id") ?? undefined;
