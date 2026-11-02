import { useEffect, useState } from "react";
import { authHeaders, serverInfo } from "@/lib/server-info";

export function KnowledgeNavLink() {
  const [url, setUrl] = useState<string>();
  const [message, setMessage] = useState("正在读取知识库地址…");
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const server = await serverInfo();
        const response = await fetch(`${server.baseUrl}/api/config`, {
          headers: authHeaders(server),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const config = await response.json() as { ragUrl?: string | null };
        const destination = config.ragUrl ? new URL(config.ragUrl) : undefined;
        if (controller.signal.aborted) return;
        if (destination && ["http:", "https:"].includes(destination.protocol)) {
          setUrl(destination.href);
        } else {
          setMessage("请先在知识库配置中填写 Antler Knowledge 服务地址。");
        }
      } catch {
        if (!controller.signal.aborted) setMessage("无法读取知识库地址，请稍后重试。");
      }
    })();
    return () => controller.abort();
  }, []);

  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" title="Antler Knowledge">
      知识库
    </a>
  ) : (
    <button type="button" disabled title={message} className="text-sm text-[#999]">
      知识库
    </button>
  );
}
