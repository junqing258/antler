import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer, ChatScreen, MessageBubble, ModelPicker } from "@antler/ui";
import { MessageList } from "../../../packages/ui/src/message-list.web";
const { Keyboard, Platform } = await vi.importActual<{
  Keyboard: { dismiss: () => void };
  Platform: { OS: string };
}>("react-native");

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
    fireEvent.click(screen.getByRole("button", { name: "思考过程" }));
    expect(screen.getByText("思考内容")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "搜索 调用失败" }));
    expect(screen.getByText("失败")).toBeInTheDocument();
    expect(screen.getByText("[不支持的消息内容]")).toBeInTheDocument();
    expect(screen.getByText("运行失败")).toBeInTheDocument();
  });

  it("auto-opens reasoning and tool calls while running and shows the waiting state", () => {
    const { rerender } = render(
      <MessageBubble
        message={{
          id: "assistant",
          role: "assistant",
          content: [],
          status: { type: "running" },
        }}
      />,
    );
    expect(screen.getByText("正在等待 Agent 回复…")).toBeInTheDocument();
    rerender(
      <MessageBubble
        message={{
          id: "assistant",
          role: "assistant",
          content: [
            { type: "reasoning", text: "推理中" },
            {
              type: "tool-call",
              toolCallId: "1",
              toolName: "检索",
              args: { query: "迁移计划" },
              argsText: '{"query":"迁移计划"}',
            },
          ],
          status: { type: "running" },
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "正在思考" })).toBeEnabled();
    expect(screen.getByText("推理中")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "正在调用 检索" }),
    ).toBeInTheDocument();
    expect(screen.getByText("查询：迁移计划")).toBeInTheDocument();
  });

  it("offers copying the assistant text parts through the injected handler", () => {
    const onCopy = vi.fn();
    render(
      <MessageBubble
        onCopy={onCopy}
        message={{
          id: "assistant",
          role: "assistant",
          content: [
            { type: "text", text: "第一段" },
            { type: "reasoning", text: "不应被复制" },
            { type: "text", text: "第二段" },
          ],
          status: { type: "complete", reason: "stop" },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "复制回复" }));
    expect(onCopy).toHaveBeenCalledOnce();
    expect(onCopy).toHaveBeenCalledWith("第一段\n\n第二段");
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

  it("keeps position during replies and when history is prepended", () => {
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
    expect(list.scrollTop).toBe(200);

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
    // 代码按语法高亮分段渲染，完整文本不再作为单一节点出现
    expect(screen.getByText("const")).toBeInTheDocument();
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

  it("parses CJK emphasis, footnotes and highlights code tokens", () => {
    render(
      <MessageBubble
        message={message(
          "中文**加粗**测试，以及句子结尾的**强调**。\n\n这是一个脚注[^1]。\n\n[^1]: 脚注内容说明。\n\n```ts\nconst done = true; // 完成\n```",
        )}
      />,
    );
    // CJK 友好强调：加粗与中文相邻时仍解析
    expect(screen.getByText("加粗")).toBeInTheDocument();
    expect(screen.getByText("强调")).toBeInTheDocument();
    // 脚注引用与文末脚注块
    expect(screen.getByText("[1]")).toBeInTheDocument();
    expect(screen.getByText(/脚注内容说明/)).toBeInTheDocument();
    // 代码高亮：关键字与注释渲染为分段着色文本
    expect(screen.getByText("const")).toBeInTheDocument();
    expect(screen.getByText("// 完成")).toBeInTheDocument();
  });

  it("falls back to plain text for unknown code languages", () => {
    render(
      <MessageBubble
        message={message("```unknown-lang\nplain content here\n```")}
      />,
    );
    expect(screen.getByText("plain content here")).toBeInTheDocument();
  });

  it("completes unclosed emphasis while the message is live, without touching the stored text", () => {
    const live = { ...message("正在 **加粗"), live: true };
    render(<MessageBubble message={live} />);
    expect(screen.getByText("加粗")).toBeInTheDocument();
    expect(screen.queryByText("**加粗**")).not.toBeInTheDocument();
    // 展示层补全不回写消息文本：live 标记移除后按原文解析
    cleanup();
    render(<MessageBubble message={message("正在 **加粗")} />);
    expect(screen.getByText("正在 **加粗")).toBeInTheDocument();
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

describe("shared chat screen", () => {
  const base = {
    ready: true,
    running: false,
    sending: false,
    draft: "",
    onDraftChange: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
  };

  it("positions the sent user message at the top and leaves replies in place", () => {
    const onSend = vi.fn();
    const messages = [{ id: "old", role: "user" as const, content: [{ type: "text" as const, text: "旧消息" }] }];
    const { rerender } = render(<ChatScreen {...base} messages={messages} draft="你好" onSend={onSend} />);
    const list = screen.getByLabelText("消息列表");
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 500 });
    list.scrollTop = 50;
    const bounds = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const top = (this as HTMLElement).dataset?.messageId === "new" ? 300 : 0;
      return { top, bottom: top + 50, left: 0, right: 100, width: 100, height: 50, x: 0, y: top, toJSON: () => ({}) };
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(onSend).toHaveBeenCalledOnce();
    expect(list.scrollTop).toBe(50);
    const sent = [...messages, { id: "new", role: "user" as const, content: [{ type: "text" as const, text: "你好" }] }];
    rerender(<ChatScreen {...base} messages={sent} draft="" onSend={onSend} />);
    expect(list.scrollTop).toBe(350);
    expect(list.querySelector('[aria-hidden="true"]')).toHaveStyle({ height: "512px" });
    rerender(<ChatScreen {...base} messages={[...sent, { id: "reply", role: "assistant", content: [{ type: "text", text: "回复" }] }]} draft="" onSend={onSend} />);
    expect(list.scrollTop).toBe(350);
    bounds.mockRestore();
  });

  it("dismisses the native keyboard when the welcome area is tapped", () => {
    const originalOS = Platform.OS;
    const dismiss = vi.spyOn(Keyboard, "dismiss").mockImplementation(() => {});
    Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
    try {
      render(<ChatScreen {...base} messages={[]} composerBackground={<span />} />);
      fireEvent.click(screen.getByText("今天我能帮你做什么？"));
      expect(dismiss).toHaveBeenCalledOnce();
      expect(screen.getByRole("textbox", { name: "消息" })).toBeInTheDocument();
    } finally {
      Object.defineProperty(Platform, "OS", { configurable: true, value: originalOS });
      dismiss.mockRestore();
    }
  });

  it("shows the welcome state with the composer when ready and empty, and the loading list otherwise", () => {
    const { rerender } = render(
      <ChatScreen
        {...base}
        messages={[]}
        model="m-a"
        models={["m-a", "m-b"]}
        onModelChange={vi.fn()}
      />,
    );
    expect(screen.getByText("今天我能帮你做什么？")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "消息" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择模型" })).toBeInTheDocument();
    rerender(<ChatScreen {...base} ready={false} messages={[]} />);
    expect(screen.getByText("正在加载会话…")).toBeInTheDocument();
    expect(
      screen.queryByText("今天我能帮你做什么？"),
    ).not.toBeInTheDocument();
  });

  it("surfaces pagination, notices and the credential config entry", () => {
    const onLoadEarlier = vi.fn();
    const onConfigureCredentials = vi.fn();
    render(
      <ChatScreen
        {...base}
        messages={[
          {
            id: "a",
            role: "user",
            content: [{ type: "text", text: "旧消息" }],
          },
        ]}
        hasMore
        notice="连接失败"
        credentialProblem="需要匹配的 API Key"
        onLoadEarlier={onLoadEarlier}
        onConfigureCredentials={onConfigureCredentials}
      />,
    );
    expect(screen.getByText("旧消息")).toBeInTheDocument();
    expect(screen.getByText("连接失败")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "加载更早消息" }));
    expect(onLoadEarlier).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "配置凭据" }));
    expect(onConfigureCredentials).toHaveBeenCalledOnce();
  });

  it("disables sending while the session is not ready or blocked", () => {
    const { rerender } = render(
      <ChatScreen
        {...base}
        ready={false}
        messages={[
          {
            id: "a",
            role: "user",
            content: [{ type: "text", text: "旧消息" }],
          },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    rerender(<ChatScreen {...base} messages={[]} sending />);
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "发送" })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("发送中…")).not.toBeInTheDocument();
    rerender(
      <ChatScreen
        {...base}
        messages={[
          {
            id: "a",
            role: "user",
            content: [{ type: "text", text: "旧消息" }],
          },
        ]}
        contextReason="上下文不可恢复"
      />,
    );
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  });
});

describe("shared model picker", () => {
  it("opens the menu and reports a new selection, closing afterwards", () => {
    const onModelChange = vi.fn();
    render(
      <ModelPicker
        model="m-a"
        models={["m-a", "m-b"]}
        onModelChange={onModelChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "选择模型" }));
    fireEvent.click(screen.getByRole("button", { name: "m-b" }));
    expect(onModelChange).toHaveBeenCalledOnce();
    expect(onModelChange).toHaveBeenCalledWith("m-b");
    expect(screen.queryByRole("button", { name: "m-b" })).not.toBeInTheDocument();
  });

  it("falls back to the server default label and hides the menu without models", () => {
    const onModelChange = vi.fn();
    render(
      <ModelPicker model="" models={[]} onModelChange={onModelChange} />,
    );
    expect(screen.getByText("服务端默认模型")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择模型" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "选择模型" }));
    expect(screen.queryByRole("button", { name: "m-a" })).not.toBeInTheDocument();
    expect(onModelChange).not.toHaveBeenCalled();
  });
});
