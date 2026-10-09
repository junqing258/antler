import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { BookOpenIcon, ExternalLinkIcon } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

type ServerInfo = { baseUrl: string; token: string };
const linkClassName =
  "mt-1.5 flex w-full items-center gap-2 rounded-lg border-0 bg-transparent px-3 py-1.5 text-left text-[13px] text-[#4b4b4b] no-underline hover:bg-[#f0f0f0] hover:text-[#222] disabled:opacity-50";
const configurationHint =
  "请在 backend 环境中配置有效的 ANTLER_RAG_URL，并重启服务。";

export function KnowledgeConfigurationLink({
  getServerInfo,
}: {
  getServerInfo: () => Promise<ServerInfo>;
}) {
  const [ragUrl, setRagUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        const server = await getServerInfo();
        const response = await fetch(`${server.baseUrl}/api/config`, {
          headers: { "x-antler-token": server.token },
          signal,
        });
        if (!response.ok)
          throw new Error("无法读取知识库配置，请检查 backend 服务连接。");
        const config = (await response.json()) as { ragUrl: string | null };
        if (!signal.aborted) setRagUrl(config.ragUrl);
      } catch (cause) {
        if (!signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "无法读取知识库配置。",
          );
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [getServerInfo],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const openConfiguration = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!("__TAURI_INTERNALS__" in window) || !ragUrl) return;
    event.preventDefault();
    void openUrl(ragUrl).catch(() =>
      setError("无法打开知识库配置页，请检查系统默认浏览器。"),
    );
  };
  const label = (
    <>
      <BookOpenIcon className="size-[15px]" aria-hidden="true" />
      <span>知识库配置</span>
      <ExternalLinkIcon
        className="ml-auto size-3.5 text-[#888]"
        aria-hidden="true"
      />
    </>
  );

  return (
    <div>
      {ragUrl ? (
        <a
          className={linkClassName}
          href={ragUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={openConfiguration}
        >
          {label}
        </a>
      ) : (
        <button
          className={linkClassName}
          type="button"
          disabled={loading}
          onClick={() => setError(error || configurationHint)}
        >
          {label}
        </button>
      )}
      {error && (
        <p className="mx-3 my-1 text-xs leading-5 text-[#b42318]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
