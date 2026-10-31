import { useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

function UpdatePrompt() {
  const [error, setError] = useState("");
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.warn("无法注册 Antler 离线缓存：", error);
    },
  });

  if (!offlineReady && !needRefresh) return null;

  const close = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
    setError("");
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 bottom-4 left-4 z-50 rounded-xl border border-[#e8e8e8] bg-white p-4 text-sm text-[#222] shadow-lg sm:left-auto sm:max-w-sm"
    >
      <p>
        {needRefresh
          ? "Antler 有新版本，请在当前任务结束后刷新更新。"
          : "页面已可离线打开，发送消息仍需网络连接。"}
      </p>
      {error && <p className="mt-2 text-red-600">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={close}
          className="rounded-lg px-3 py-1.5 hover:bg-[#f0f0f0]"
        >
          {needRefresh ? "稍后" : "知道了"}
        </button>
        {needRefresh && (
          <button
            type="button"
            onClick={() => {
              setError("");
              void updateServiceWorker(true).catch(() =>
                setError("更新失败，请稍后重试。"),
              );
            }}
            className="rounded-lg bg-[#14a883] px-3 py-1.5 text-white hover:bg-[#119572]"
          >
            刷新更新
          </button>
        )}
      </div>
    </div>
  );
}

export function PwaUpdatePrompt() {
  if (
    !import.meta.env.PROD ||
    !window.isSecureContext ||
    !("serviceWorker" in navigator)
  ) {
    return null;
  }
  return <UpdatePrompt />;
}
