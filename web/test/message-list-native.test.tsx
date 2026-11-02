import { act, render } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { describe, expect, it, vi } from "vitest";

const { scrollToEnd, scrollToIndex, getListProps, setListProps } = vi.hoisted(() => {
  let props: Record<string, any> = {};
  return {
    scrollToEnd: vi.fn(),
    scrollToIndex: vi.fn(),
    getListProps: () => props,
    setListProps: (value: Record<string, any>) => { props = value; },
  };
});
vi.mock("react-native", () => ({
  FlatList: forwardRef((props: Record<string, unknown>, ref) => {
    setListProps(props);
    useImperativeHandle(ref, () => ({ scrollToEnd, scrollToIndex, scrollToOffset: vi.fn() }));
    return null;
  }),
  Text: () => null,
  View: () => null,
}));
vi.mock("../../packages/ui/src/message-bubble", () => ({ MessageBubble: () => null }));

import { MessageList } from "../../packages/ui/src/message-list.native";

describe("native message list", () => {
  it("positions the new user message once, leaving streaming replies and history alone", () => {
    const old = { id: "old", role: "user" as const, content: [] };
    const sent = { id: "new", role: "user" as const, content: [] };
    const request = { id: 1, knownUserIds: ["old"] };
    const { rerender } = render(<MessageList messages={[old]} ready bottomInset={80} />);
    act(() => getListProps().onLayout({ nativeEvent: { layout: { height: 500 } } }));
    expect(getListProps().ListFooterComponent.props.style.height).toBe(92);
    rerender(<MessageList messages={[old]} ready bottomInset={80} sendRequest={request} />);
    expect(scrollToIndex).not.toHaveBeenCalled();
    rerender(<MessageList messages={[old, sent]} ready bottomInset={80} sendRequest={request} />);
    expect(getListProps().ListFooterComponent.props.style.height).toBe(512);
    act(() => getListProps().ListFooterComponent.props.onLayout());
    expect(scrollToIndex).toHaveBeenCalledOnce();
    expect(scrollToIndex).toHaveBeenCalledWith({ index: 1, animated: false, viewPosition: 0 });
    rerender(<MessageList messages={[old, sent, { id: "reply", role: "assistant", content: [] }]} ready bottomInset={80} sendRequest={request} />);
    act(() => getListProps().onContentSizeChange());
    expect(scrollToIndex).toHaveBeenCalledOnce();
  });
});
