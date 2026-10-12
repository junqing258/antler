import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SlashCommandInput } from "../../../src/components/assistant-ui/slash-command-input";

afterEach(cleanup);

function setup() {
  const run = vi.fn<ChatModelAdapter["run"]>(async function* () {
    yield { content: [{ type: "text", text: "完成" }] };
  });
  function Harness() {
    const runtime = useLocalRuntime({ run });
    return (
      <AssistantRuntimeProvider runtime={runtime}>
        <ComposerPrimitive.Root>
          <SlashCommandInput />
          <ComposerPrimitive.Send>发送</ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </AssistantRuntimeProvider>
    );
  }
  render(<Harness />);
  const input = screen.getByRole("combobox", { name: "消息" });
  fireEvent.focus(input);
  const type = (value: string) =>
    fireEvent.change(input, { target: { value } });
  return { input, type, run };
}

describe("SlashCommandInput", () => {
  it("shows commands only for a leading slash token and filters by English or Chinese", () => {
    const { input, type } = setup();
    for (const value of [
      "普通消息",
      "https://example.com",
      "/tmp/file",
      "请解释 /review",
      "/review 内容",
    ]) {
      type(value);
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    }
    type("/");
    expect(screen.getAllByRole("option")).toHaveLength(7);
    expect(input).toHaveAttribute("aria-expanded", "true");
    type("/REV");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("/review");
    type("/翻译");
    expect(screen.getByRole("option")).toHaveTextContent("/translate");
    type("/unknown");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(screen.getByText("没有匹配的命令")).toBeVisible();
  });

  it("fills a clicked prompt, keeps focus and sends only after an explicit send", async () => {
    const { input, type, run } = setup();
    type("/review");
    const option = screen.getByRole("option");
    fireEvent.mouseDown(option);
    fireEvent.click(option);
    expect(input).toHaveValue("请审查以下代码，指出潜在问题并给出改进建议：\n");
    expect(input).toHaveFocus();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
    await waitFor(() =>
      expect((input as HTMLTextAreaElement).selectionStart).toBe(
        (input as HTMLTextAreaElement).value.length,
      ),
    );
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    await waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(run.mock.calls[0][0].messages.at(-1)?.content).toEqual([
      { type: "text", text: "请审查以下代码，指出潜在问题并给出改进建议：\n" },
    ]);
  });

  it.each(["Enter", "Tab"])(
    "uses arrow navigation and %s to fill without sending",
    (key) => {
      const { input, type, run } = setup();
      type("/");
      fireEvent.keyDown(input, { key: "ArrowUp" });
      expect(screen.getByRole("option", { selected: true })).toHaveTextContent(
        "/compact",
      );
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(screen.getByRole("option", { selected: true })).toHaveTextContent(
        "/explain",
      );
      fireEvent.keyDown(input, { key });
      expect(input).toHaveValue("请用易懂的语言解释以下内容：\n");
      expect(run).not.toHaveBeenCalled();
    },
  );

  it("resets selection when filtering, dismisses on Escape and reopens after editing", () => {
    const { input, type } = setup();
    type("/");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    type("/rev");
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent(
      "/review",
    );
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveValue("/rev");
    type("/revi");
    expect(screen.getByRole("listbox")).toBeVisible();
    fireEvent.blur(input);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.focus(input);
    expect(screen.getByRole("listbox")).toBeVisible();
  });

  it("leaves IME confirmation and Shift+Enter to the input", () => {
    const { input, type, run } = setup();
    type("/");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(input).toHaveValue("/");
    expect(screen.getByRole("listbox")).toBeVisible();
    expect(run).not.toHaveBeenCalled();
  });

  it("fills /compact as a command and sends it on the next Enter", async () => {
    const { input, type, run } = setup();
    type("/压缩");
    expect(screen.getByRole("option")).toHaveTextContent("/compact");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("/compact");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    await waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(run.mock.calls[0][0].messages.at(-1)?.content).toEqual([
      { type: "text", text: "/compact" },
    ]);
  });
});
