import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer, MessageBubble } from "@antler/ui";
import { MessageList } from "../../packages/ui/src/message-list.web";

afterEach(cleanup);

describe("shared chat UI on RNW", () => {
  it("renders reasoning, tool errors, unknown parts and incomplete status", () => {
    render(
      <MessageBubble
        message={{
          id: "assistant",
          role: "assistant",
          content: [
            { type: "reasoning", text: "思考内容" },
            {
              type: "tool-call",
              toolCallId: "1",
              toolName: "搜索",
              args: {},
              argsText: "{}",
              result: "失败",
              isError: true,
            },
            { type: "unknown", value: {} },
          ],
          status: { type: "incomplete", reason: "error", error: "运行失败" },
        }}
      />,
    );
    expect(screen.getByText("思考：思考内容")).toBeInTheDocument();
    expect(screen.getByText(/工具：搜索/)).toHaveTextContent("（错误）");
    expect(screen.getByText("[不支持的消息内容]")).toBeInTheDocument();
    expect(screen.getByText("运行失败")).toBeInTheDocument();
  });

  it("disables empty or unavailable sends while leaving stop available", () => {
    const send = vi.fn();
    const stop = vi.fn();
    const props = {
      value: "你好",
      onChange: vi.fn(),
      onSend: send,
      onStop: stop,
    };
    const { rerender } = render(
      <Composer {...props} running={false} disabled />,
    );
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    rerender(<Composer {...props} running={false} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(send).toHaveBeenCalledOnce();
    rerender(<Composer {...props} running disabled />);
    fireEvent.click(screen.getByRole("button", { name: "停止" }));
    expect(stop).toHaveBeenCalledOnce();
  });

  it("follows new content only at the bottom and keeps the visible row when history is prepended", () => {
    const message = (id: string) => ({
      id,
      role: "user" as const,
      content: [{ type: "text" as const, text: id }],
    });
    const { rerender } = render(
      <MessageList messages={[message("a"), message("b")]} ready />,
    );
    const list = screen.getByLabelText("消息列表");
    let height = 300;
    Object.defineProperty(list, "scrollHeight", {
      configurable: true,
      get: () => height,
    });
    Object.defineProperty(list, "clientHeight", {
      configurable: true,
      value: 100,
    });
    list.scrollTop = 200;
    fireEvent.scroll(list);
    height = 400;
    rerender(
      <MessageList
        messages={[message("a"), message("b"), message("c")]}
        ready
      />,
    );
    expect(list.scrollTop).toBe(400);

    list.scrollTop = 70;
    fireEvent.scroll(list);
    let shift = 0;
    const bounds = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        const id = (this as HTMLElement).dataset?.messageId;
        const top = id === "a" ? 10 + shift : id ? 110 + shift : 0;
        return {
          top,
          bottom: top + 100,
          left: 0,
          right: 100,
          width: 100,
          height: 100,
          x: 0,
          y: top,
          toJSON: () => ({}),
        };
      });
    height = 500;
    // The old DOM is measured before commit; new rows are measured afterwards.
    const previous = bounds.getMockImplementation()!;
    let measurements = 0;
    bounds.mockImplementation(function (this: Element) {
      if ((this as HTMLElement).dataset?.messageId === "a") measurements++;
      if (measurements > 2) shift = 100;
      return previous.call(this);
    });
    rerender(
      <MessageList
        messages={[message("old"), message("a"), message("b"), message("c")]}
        ready
      />,
    );
    expect(list.scrollTop).toBe(170);
    height = 600;
    rerender(
      <MessageList
        messages={[
          message("old"),
          message("a"),
          message("b"),
          message("c"),
          message("d"),
        ]}
        ready
      />,
    );
    expect(list.scrollTop).toBe(170);
    bounds.mockRestore();
  });
});

describe("shared Markdown", () => {
  const message = (text: string) => ({
    id: "markdown",
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
  });

  it("renders formatted content, tables and code without rendering HTML", () => {
    render(
      <MessageBubble
        message={message(
          "# 标题\n\n正文 **加粗** 和 `代码` [链接](https://example.com)\n\n- 一\n- 二\n\n| 名称 | 值 |\n| --- | --- |\n| 甲 | 乙 |\n\n```ts\nconst x = 1;\n```\n\n<script>alert(1)</script>",
        )}
      />,
    );
    expect(screen.getByText("标题")).toBeInTheDocument();
    expect(screen.getByText("加粗")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "链接" })).toBeInTheDocument();
    expect(screen.getByText("甲")).toBeInTheDocument();
    expect(screen.getByText("const x = 1;")).toBeInTheDocument();
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });

  it("reparses incomplete streaming input when it becomes complete", () => {
    const { rerender } = render(
      <MessageBubble message={message("正在 **生成")} />,
    );
    expect(screen.getByText("正在 **生成")).toBeInTheDocument();
    rerender(<MessageBubble message={message("正在 **生成**")} />);
    expect(screen.getByText("生成")).toBeInTheDocument();
  });
});

describe("web composer keyboard interaction", () => {
  it("sends on Enter but preserves newlines and IME confirmation", () => {
    const send = vi.fn();
    render(
      <Composer
        value="你好"
        onChange={vi.fn()}
        onSend={send}
        onStop={vi.fn()}
        running={false}
        disabled={false}
      />,
    );
    const input = screen.getByRole("textbox", { name: "消息" });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(input, { key: "Enter", repeat: true });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(send).toHaveBeenCalledOnce();
  });

  it("does not send or stop via Enter when sending is unavailable or running", () => {
    const send = vi.fn();
    const stop = vi.fn();
    const props = {
      value: "你好",
      onChange: vi.fn(),
      onSend: send,
      onStop: stop,
    };
    const { rerender } = render(
      <Composer {...props} running={false} disabled />,
    );
    const input = screen.getByRole("textbox", { name: "消息" });
    fireEvent.keyDown(input, { key: "Enter" });
    rerender(<Composer {...props} running disabled />);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(send).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "停止" }));
    expect(stop).toHaveBeenCalledOnce();
  });
});

describe("shared composer commands", () => {
  function Harness({ send = () => {} }: { send?: () => void }) {
    const [value, setValue] = useState("");
    return (
      <Composer
        value={value}
        onChange={setValue}
        onSend={send}
        onStop={() => {}}
        running={false}
        disabled={false}
      />
    );
  }

  it("selects commands with the keyboard without sending, and dismisses with Escape", () => {
    const send = vi.fn();
    render(<Harness send={send} />);
    const input = screen.getByRole("textbox", { name: "消息" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "/" } });
    expect(
      screen.getByRole("listbox", { name: "命令提示" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: /explain/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(input).toHaveValue("/");
    fireEvent.keyDown(input, { key: "Tab" });
    expect(input).toHaveValue("请用易懂的语言解释以下内容：\n");
    expect(send).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "/compact" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(send).toHaveBeenCalledOnce();
  });

  it("fills a matching command by clicking and keeps compact dismissed", () => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "消息" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "/comp" } });
    fireEvent.click(screen.getByRole("option", { name: /compact/ }));
    expect(input).toHaveValue("/compact");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "/xyz" } });
    expect(screen.getByText("没有匹配的命令")).toBeInTheDocument();
  });
});
