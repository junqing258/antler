import { useEffect, useRef, useState } from "react";
import { ChatScreen } from "@antler/ui";
import type { ChatSession, SessionState } from "@antler/client-runtime";
import { SessionLoading } from "./session-loading";

/**
 * Web 主聊天视图：消费 useChatSession 的同一 ChatSession，
 * 经共享 ChatScreen 渲染；一次只挂载一种聊天实现。
 */
export function SharedThread({
  session,
  state,
  model,
  models,
  onModelChange,
  onConfigureCredentials,
}: {
  session: ChatSession;
  state: SessionState;
  model: string;
  models: string[];
  onModelChange: (model: string) => void;
  onConfigureCredentials?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [operationError, setOperationError] = useState("");
  const pendingDraft = useRef<string | null>(null);
  useEffect(() => {
    if (!state.running || pendingDraft.current === null) return;
    const submitted = pendingDraft.current;
    pendingDraft.current = null;
    setDraft((current) => (current === submitted ? "" : current));
  }, [state.running]);
  const problem = session.credentialProblem();
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    if (
      !state.ready ||
      state.running ||
      state.sending ||
      state.contextReason ||
      session.credentialProblem()
    )
      return;
    pendingDraft.current = draft;
    void session.send(text).finally(() => {
      if (!session.getSnapshot().running) pendingDraft.current = null;
    });
  };
  if (!state.ready) {
    return <SessionLoading notice={state.notice} />;
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatScreen
        messages={state.messages}
        ready={state.ready}
        running={state.running}
        sending={state.sending}
        hasMore={state.hasMore}
        notice={state.notice}
        operationError={operationError}
        contextReason={state.contextReason}
        credentialProblem={problem}
        draft={draft}
        onDraftChange={setDraft}
        onSend={send}
        onStop={() => {
          setOperationError("");
          void session
            .cancel()
            .catch(() => setOperationError("停止请求失败，请重试。"));
        }}
        onLoadEarlier={() => {
          setOperationError("");
          void session
            .loadEarlier()
            .catch(() => setOperationError("无法加载更早消息，请重试。"));
        }}
        onCopy={(text) => {
          void navigator.clipboard?.writeText(text).catch(() => {});
        }}
        model={model}
        models={models}
        onModelChange={onModelChange}
        onConfigureCredentials={onConfigureCredentials}
      />
    </div>
  );
}
