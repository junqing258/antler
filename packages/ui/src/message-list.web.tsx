import { Component, createRef } from "react";
import type { ChatMessage } from "@antler/chat-core";
import { MessageBubble } from "./message-bubble";

type Props = {
  messages: ChatMessage[];
  ready: boolean;
  onCopy?: (text: string) => void;
  bottomInset?: number;
  sendRequest?: { id: number; knownUserIds: string[] };
};
type Anchor = { id: string; top: number } | null;

export class MessageList extends Component<Props> {
  private container = createRef<HTMLDivElement>();
  private footer = createRef<HTMLDivElement>();
  private handledRequest?: number;
  private initialized = false;
  private observer?: ResizeObserver;
  private reserving = false;

  componentDidMount() {
    if (typeof ResizeObserver !== "undefined" && this.container.current) {
      this.observer = new ResizeObserver(() => this.sizeFooter());
      this.observer.observe(this.container.current);
    }
    if (!this.positionSentMessage()) this.initializePosition();
  }
  componentWillUnmount() {
    this.observer?.disconnect();
  }
  private sizeFooter() {
    if (this.footer.current && this.container.current) {
      this.footer.current.style.height = `${this.reserving ? this.container.current.clientHeight + 12 : (this.props.bottomInset ?? 0) + 12}px`;
    }
  }
  private initializePosition() {
    const container = this.container.current;
    if (!this.initialized && container && this.props.ready && this.props.messages.length) {
      this.initialized = true;
      container.scrollTop = container.scrollHeight;
    }
  }
  private positionSentMessage() {
    const { sendRequest, messages } = this.props;
    const container = this.container.current;
    if (!sendRequest || this.handledRequest === sendRequest.id || !container) return false;
    const message = [...messages].reverse().find((item) => item.role === "user" && !sendRequest.knownUserIds.includes(item.id));
    if (!message) return false;
    const row = Array.from(container.querySelectorAll<HTMLElement>("[data-message-id]"))
      .find((element) => element.dataset.messageId === message.id);
    if (!row) return false;
    this.reserving = true;
    this.sizeFooter();
    container.scrollTop += row.getBoundingClientRect().top - container.getBoundingClientRect().top;
    this.handledRequest = sendRequest.id;
    this.initialized = true;
    return true;
  }
  getSnapshotBeforeUpdate(previous: Props): Anchor {
    const container = this.container.current;
    const previousFirst = previous.messages[0]?.id;
    const prepended = previousFirst !== undefined &&
      this.props.messages[0]?.id !== previousFirst &&
      this.props.messages.some((message) => message.id === previousFirst);
    if (!container || !prepended) return null;
    const top = container.getBoundingClientRect().top;
    const row = Array.from(container.querySelectorAll<HTMLElement>("[data-message-id]"))
      .find((element) => element.getBoundingClientRect().bottom > top);
    return row?.dataset.messageId ? { id: row.dataset.messageId, top: row.getBoundingClientRect().top } : null;
  }
  componentDidUpdate(_previous: Props, _state: unknown, anchor: Anchor) {
    if (this.positionSentMessage()) return;
    const container = this.container.current;
    if (container && anchor) {
      const row = Array.from(container.querySelectorAll<HTMLElement>("[data-message-id]"))
        .find((element) => element.dataset.messageId === anchor.id);
      if (row) container.scrollTop += row.getBoundingClientRect().top - anchor.top;
    }
    this.initializePosition();
  }
  render() {
    return (
      <div ref={this.container} aria-label="消息列表" style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowAnchor: "none", padding: "20px 20px 0" }}>
        <div style={{ width: "100%", maxWidth: 1024, minWidth: 0, margin: "0 auto" }}>
          {this.props.messages.length
            ? this.props.messages.map((message) => (
                <div key={message.id} data-message-id={message.id} style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <MessageBubble message={message} onCopy={this.props.onCopy} />
                </div>
              ))
            : this.props.ready ? "暂无消息" : "正在加载会话…"}
          <div ref={this.footer} aria-hidden="true" />
        </div>
      </div>
    );
  }
}
