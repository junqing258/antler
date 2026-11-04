import { afterEach, describe, expect, it, vi } from "vitest";
import { CosClient, CosError } from "../../src/conversations/cos-client.js";

const SECRET_ID = "AKIDexample-secret-id";
const SECRET_KEY = "super-secret-key-value";

const client = () =>
  new CosClient({
    secretId: SECRET_ID,
    secretKey: SECRET_KEY,
    region: "ap-guangzhou",
    bucket: "bucket-1250000000",
    maxRetries: 3,
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CosClient", () => {
  it("signs requests and never logs the secret key", async () => {
    const fetchMock = vi.fn(
      async (_input?: string | URL, _init?: RequestInit) =>
        new Response("", { status: 200 }) as unknown as globalThis.Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    await client().put("a/b.json", "{}");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^q-sign-algorithm=sha1&q-ak=/);
    expect(headers.authorization).toContain("q-signature=");
    expect(headers.authorization).not.toContain(SECRET_KEY);
    expect(fetchMock.mock.calls[0][0]).toContain(
      "bucket-1250000000.cos.ap-guangzhou.myqcloud.com/a/b.json",
    );
  });

  it("passes the temporary token as an unsigned header", async () => {
    const fetchMock = vi.fn(
      async (_input?: string | URL, _init?: RequestInit) =>
        new Response("", { status: 200 }) as unknown as globalThis.Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const tokened = new CosClient({
      secretId: SECRET_ID,
      secretKey: SECRET_KEY,
      token: "temp-token",
      region: "ap-guangzhou",
      bucket: "bucket-1250000000",
    });
    await tokened.put("a.json", "{}");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-cos-security-token"]).toBe(
      "temp-token",
    );
  });

  it("treats 404 on get as absent and 404 on delete as deleted", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("not found", {
        status: 404,
      }) as unknown as globalThis.Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(client().get("missing.json")).resolves.toBeUndefined();
    await expect(client().delete("missing.json")).resolves.toBeUndefined();
  });

  it("retries 5xx with backoff and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", { status: 500 }) as unknown as globalThis.Response,
      )
      .mockResolvedValueOnce(
        new Response("", { status: 200 }) as unknown as globalThis.Response,
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(client().put("a.json", "{}")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("classifies non-retryable 4xx as CosError without leaking credentials", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("forbidden", {
        status: 403,
        headers: { "x-cos-request-id": "req-1" },
      }) as unknown as globalThis.Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const error = await client().get("a.json").catch((caught) => caught);
    expect(error).toBeInstanceOf(CosError);
    expect((error as CosError).status).toBe(403);
    expect((error as CosError).requestId).toBe("req-1");
    expect((error as Error).message).not.toContain(SECRET_KEY);
    expect((error as Error).message).not.toContain(SECRET_ID);
  });

  it("throws CosError after exhausting retries on 5xx", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("", { status: 503 }) as unknown as globalThis.Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(client().put("a.json", "{}")).rejects.toMatchObject({
      name: "CosError",
      status: 503,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
