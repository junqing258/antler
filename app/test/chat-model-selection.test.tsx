import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { Chat } from "@/views/chat/chat";
import type { ProviderConfig } from "@/lib/provider-config";

const state = vi.hoisted(() => ({
  boundModel: "old-model" as string | undefined,
}));
vi.mock("@assistant-ui/react", () => ({
  AssistantRuntimeProvider: ({ children }: any) => children,
}));
vi.mock("@/components/assistant-ui/use-antler-runtime", () => ({
  useAntlerRuntime: () => ({ runtime: {}, boundModel: state.boundModel }),
}));
vi.mock("@/components/assistant-ui/thread", () => ({
  AssistantThread: ({
    model,
    models,
    onModelChange,
    modelChangeStartsNewThread,
  }: any) => (
    <div>
      <output data-testid="selected-model">{model}</output>
      {modelChangeStartsNewThread && <p>切换模型会新建会话</p>}
      {models.map((item: string) => (
        <button key={item} onClick={() => onModelChange(item)}>
          {item}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("@/components/knowledge-configuration-link", () => ({
  KnowledgeConfigurationLink: () => null,
}));
vi.mock("@/lib/auth", () => ({ currentUserProfile: async () => undefined }));
const config: ProviderConfig = {
  name: "custom",
  protocol: "openai-responses",
  baseUrl: "",
  apiKey: "test-key",
  model: "new-model",
  models: ["new-model", "other-model"],
};
afterEach(() => {
  cleanup();
  state.boundModel = "old-model";
});
function mount() {
  const onModelChange = vi.fn();
  const onNewThread = vi.fn();
  render(
    <MemoryRouter>
      <Chat
        agentId="agent"
        conversationId="thread"
        initialMessages={[]}
        title="thread"
        conversations={[]}
        workingDirectory="/workspace"
        providerConfig={config}
        serverModel="server-model"
        onModelChange={onModelChange}
        onNewThread={onNewThread}
        onSelectThread={vi.fn()}
        onRenameThread={vi.fn()}
        onDeleteThread={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenScheduler={vi.fn()}
        onConversationSaved={vi.fn()}
      />
    </MemoryRouter>,
  );
  return { onModelChange, onNewThread };
}
it("offers configured models in a bound conversation and starts a new thread on switching", () => {
  const { onModelChange, onNewThread } = mount();
  expect(screen.getByTestId("selected-model")).toHaveTextContent("old-model");
  expect(
    screen.getByRole("button", { name: "other-model" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "old-model" }));
  expect(onNewThread).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "new-model" }));
  expect(onModelChange).toHaveBeenCalledWith("new-model");
  expect(onNewThread).toHaveBeenCalledOnce();
});
it("changes models in an empty conversation without replacing the thread", () => {
  state.boundModel = undefined;
  const { onModelChange, onNewThread } = mount();
  fireEvent.click(screen.getByRole("button", { name: "other-model" }));
  expect(onModelChange).toHaveBeenCalledWith("other-model");
  expect(onNewThread).not.toHaveBeenCalled();
});
