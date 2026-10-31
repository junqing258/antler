import { Component, createRef } from "react";
import type { ChatMessage } from "@antler/chat-core";
import { MessageBubble } from "./message-bubble";

type Props = {
  messages: ChatMessage[];
  ready: boolean;
  onCopy?: (text: string) => void;
};
type Anchor = { id: string; top: number } | null;
type Snapshot = { anchor: Anchor; follow: boolean };

export class MessageList extends Component<Props> {
  private container = createRef<HTMLDivElement>();
  private content = createRef<HTMLDivElement>();
  private following = true;
  private observer?: ResizeObserver;

  componentDidMount() {
    if (typeof ResizeObserver !== "undefined" && this.content.current) {
      this.observer = new ResizeObserver(() => {
        if (this.following) this.scrollToBottom();
      });
      this.observer.observe(this.content.current);
      if (this.container.current) this.observer.observe(this.container.current);
    }
    this.scrollToBottom();
  }
  componentWillUnmount() {
    this.observer?.disconnect();
  }
  private scrollToBottom() {
    const container = this.container.current;
    if (container) container.scrollTop = container.scrollHeight;
  }
  getSnapshotBeforeUpdate(previous: Props): Snapshot {
    const container = this.container.current;
    const previousFirst = previous.messages[0]?.id;
    const prepended =
      previousFirst !== undefined &&
      this.props.messages[0]?.id !== previousFirst &&
      this.props.messages.some((message) => message.id === previousFirst);
    const follow = this.following && !prepended;
    if (!container || follow) return { anchor: null, follow };
    const top = container.getBoundingClientRect().top;
    const row = Array.from(
      container.querySelectorAll<HTMLElement>("[data-message-id]"),
    ).find((element) => element.getBoundingClientRect().bottom > top);
    return {
      anchor: row?.dataset.messageId
        ? { id: row.dataset.messageId, top: row.getBoundingClientRect().top }
        : null,
      follow,
    };
  }
  componentDidUpdate(_previous: Props, _state: unknown, snapshot: Snapshot) {
    const container = this.container.current;
    if (!container) return;
    if (snapshot.follow) {
      this.scrollToBottom();
      return;
    }
    if (snapshot.anchor) {
      const row = Array.from(
        container.querySelectorAll<HTMLElement>("[data-message-id]"),
      ).find((element) => element.dataset.messageId === snapshot.anchor?.id);
      if (row)
        container.scrollTop +=
          row.getBoundingClientRect().top - snapshot.anchor.top;
    }
    this.following =
      container.scrollHeight - container.scrollTop - container.clientHeight <=
      48;
  }
  render() {
    return (
      <div
        ref={this.container}
        aria-label="消息列表"
        onScroll={(event) => {
          const element = event.currentTarget;
          this.following =
            element.scrollHeight - element.scrollTop - element.clientHeight <=
            48;
        }}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowAnchor: "none",
        }}
      >
        <div ref={this.content}>
          {this.props.messages.length
            ? this.props.messages.map((message) => (
                <div key={message.id} data-message-id={message.id}>
                  <MessageBubble
                    message={message}
                    onCopy={this.props.onCopy}
                  />
                </div>
              ))
            : this.props.ready
              ? "暂无消息"
              : "正在加载会话…"}
        </div>
      </div>
    );
  }
}
