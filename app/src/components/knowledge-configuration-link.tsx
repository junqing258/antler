import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import { BookOpenIcon, ExternalLinkIcon } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type ServerInfo = { baseUrl: string; token: string };
type RagConfig = {
  ragUrl: string | null;
  ragKeyConfigured: boolean;
  ragConfigOverridden: boolean;
};
const inputClassName =
  "h-10 w-full rounded-lg border border-[#ddd] px-[11px] text-[13px] font-normal text-[#222] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15";
const buttonClassName =
  "rounded-lg border border-[#ddd] bg-white px-3 py-2 text-[13px] text-[#4b4b4b] hover:bg-[#f0f0f0] disabled:opacity-50";

function KnowledgeConfigurationForm({
  getServerInfo,
  onConfigChange,
}: {
  getServerInfo: () => Promise<ServerInfo>;
  onConfigChange: (config: RagConfig) => void;
}) {
  const [config, setConfig] = useState<RagConfig | null>(null);
  const [ragUrl, setRagUrl] = useState("");
  const [ragKey, setRagKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [reload, setReload] = useState(0);

  const applyConfig = (next: RagConfig) => {
    onConfigChange(next);
    setConfig(next);
    setRagUrl(next.ragUrl ?? "");
    setRagKey("");
    setClearKey(false);
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const server = await getServerInfo();
        const response = await fetch(`${server.baseUrl}/api/config`, {
          headers: { "x-antler-token": server.token },
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error("无法读取知识库配置，请检查 backend 服务连接。");
        const next = (await response.json()) as RagConfig;
        if (!controller.signal.aborted) applyConfig(next);
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "无法读取知识库配置。",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [getServerInfo, reload, onConfigChange]);

  const save = async (reset = false) => {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const server = await getServerInfo();
      const response = await fetch(`${server.baseUrl}/api/config/rag`, {
        method: reset ? "DELETE" : "PUT",
        headers: {
          "x-antler-token": server.token,
          ...(reset ? {} : { "content-type": "application/json" }),
        },
        ...(reset
          ? {}
          : {
              body: JSON.stringify({
                ragUrl: ragUrl.trim(),
                ...(clearKey || ragKey.trim()
                  ? { ragKey: clearKey ? "" : ragKey.trim() }
                  : {}),
              }),
            }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "无法保存知识库配置。");
      applyConfig(result as RagConfig);
      setStatus(reset ? "已恢复环境默认值。" : "知识库配置已保存，即时生效。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法保存知识库配置。");
    } finally {
      setSaving(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save();
  };
  const openManagement = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!("__TAURI_INTERNALS__" in window) || !config?.ragUrl) return;
    event.preventDefault();
    void openUrl(config.ragUrl).catch(() =>
      setError("无法打开知识库管理页，请检查系统默认浏览器。"),
    );
  };

  return (
    <form className="grid gap-5" onSubmit={submit}>
      {loading && (
        <p className="m-0 text-sm text-[#777]" role="status">
          正在读取配置…
        </p>
      )}
      <fieldset
        className="m-0 grid gap-5 border-0 p-0"
        disabled={loading || saving || !config}
      >
        <label className="grid gap-1.5 text-xs font-semibold text-[#4b4b4b]">
          RAG 服务地址
          <input
            className={inputClassName}
            type="url"
            value={ragUrl}
            onChange={(event) => setRagUrl(event.target.value)}
            placeholder="https://rag.example.com"
          />
          <span className="font-normal leading-5 text-[#777]">
            填写 HTTP 或 HTTPS 服务地址，例如 http://localhost:8001。
          </span>
        </label>
        <label className="grid gap-1.5 text-xs font-semibold text-[#4b4b4b]">
          RAG API Key
          <input
            className={inputClassName}
            type="password"
            value={ragKey}
            onChange={(event) => {
              setRagKey(event.target.value);
              setClearKey(false);
            }}
            placeholder={
              clearKey
                ? "保存后清除密钥"
                : config?.ragKeyConfigured
                  ? "已配置，留空保留现有密钥"
                  : "请输入 API Key"
            }
            autoComplete="off"
          />
          <span className="font-normal leading-5 text-[#777]">
            {clearKey
              ? "保存后将清除现有密钥。"
              : config?.ragKeyConfigured
                ? "密钥已配置；输入新密钥可替换，留空则保留。"
                : "尚未配置密钥。"}
          </span>
        </label>
        {config?.ragKeyConfigured && (
          <button
            type="button"
            className="justify-self-start border-0 bg-transparent p-0 text-xs text-[#b42318]"
            onClick={() => {
              setClearKey(!clearKey);
              setRagKey("");
            }}
          >
            {clearKey ? "取消清除密钥" : "清除密钥"}
          </button>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className={buttonClassName}
            onClick={() => void save(true)}
            disabled={!config?.ragConfigOverridden}
          >
            恢复环境默认值
          </button>
          <button
            type="submit"
            className="rounded-lg border-0 bg-primary px-4 py-2 text-[13px] font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存配置"}
          </button>
        </div>
      </fieldset>
      {error && (
        <p className="m-0 text-xs leading-5 text-[#b42318]" role="alert">
          {error}
        </p>
      )}
      {!loading && !config && (
        <button
          type="button"
          className={buttonClassName}
          onClick={() => setReload((value) => value + 1)}
        >
          重试
        </button>
      )}
      {status && (
        <p className="m-0 text-xs text-primary" role="status">
          {status}
        </p>
      )}
      {config?.ragUrl && (
        <a
          className="flex items-center gap-1.5 text-[13px] text-primary no-underline hover:underline"
          href={config.ragUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={openManagement}
        >
          打开知识库管理页面
          <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
        </a>
      )}
    </form>
  );
}

export function KnowledgeConfigurationLink({
  getServerInfo,
}: {
  getServerInfo: () => Promise<ServerInfo>;
}) {
  const [ragUrl, setRagUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadController = useRef<AbortController | null>(null);
  const onConfigChange = useCallback((next: RagConfig) => {
    loadController.current?.abort();
    setRagUrl(next.ragUrl);
    setLoading(false);
    setError("");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setRagUrl(null);
    setError("");
    void (async () => {
      try {
        const server = await getServerInfo();
        const response = await fetch(`${server.baseUrl}/api/config`, {
          headers: { "x-antler-token": server.token },
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error("无法读取服务地址，请打开知识库配置重试。");
        const next = (await response.json()) as RagConfig;
        if (!controller.signal.aborted) setRagUrl(next.ragUrl);
      } catch {
        if (!controller.signal.aborted)
          setError("无法读取服务地址，请打开知识库配置重试。");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [getServerInfo]);

  const openService = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!("__TAURI_INTERNALS__" in window) || !ragUrl) return;
    event.preventDefault();
    void openUrl(ragUrl).catch(() =>
      setError("无法打开服务地址，请检查系统默认浏览器。"),
    );
  };
  const serviceClassName =
    "flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-[#777] no-underline hover:bg-[#f0f0f0] hover:text-[#222]";
  const serviceLabel = (
    <>
      <span>服务地址</span>
      <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
    </>
  );

  return (
    <Dialog>
      <div className="mt-1.5 flex items-center gap-1">
        <DialogTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border-0 bg-transparent px-3 py-1.5 text-left text-[13px] text-[#4b4b4b] hover:bg-[#f0f0f0] hover:text-[#222]">
          <BookOpenIcon className="size-[15px] shrink-0" aria-hidden="true" />
          <span className="whitespace-nowrap">知识库配置</span>
        </DialogTrigger>
        {ragUrl ? (
          <a
            className={serviceClassName}
            href={ragUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="打开知识库服务地址"
            title={ragUrl}
            onClick={openService}
          >
            {serviceLabel}
          </a>
        ) : (
          <button
            className={`${serviceClassName} border-0 bg-transparent disabled:opacity-50`}
            type="button"
            disabled
            aria-label="打开知识库服务地址"
            title={
              loading
                ? "正在读取服务地址…"
                : error || "未配置服务地址，请先配置知识库。"
            }
          >
            {serviceLabel}
          </button>
        )}
      </div>
      {error && ragUrl && (
        <p className="mx-3 my-1 text-xs leading-5 text-[#b42318]" role="alert">
          {error}
        </p>
      )}
      <DialogContent className="max-h-[calc(100svh-32px)] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-[14px] border-[#e4e4e4] bg-white p-6 sm:p-7">
        <DialogHeader>
          <DialogTitle>知识库配置</DialogTitle>
          <DialogDescription className="text-xs leading-5 text-[#777]">
            配置保存在当前后端服务，保存后即时生效。未覆盖时使用环境中的默认值。
          </DialogDescription>
        </DialogHeader>
        <KnowledgeConfigurationForm
          getServerInfo={getServerInfo}
          onConfigChange={onConfigChange}
        />
      </DialogContent>
    </Dialog>
  );
}
