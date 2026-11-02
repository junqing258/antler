import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FlatList, Text, View } from "react-native";
import type { ChatMessage } from "@antler/chat-core";
import { MessageBubble } from "./message-bubble";

export function MessageList({
  messages,
  ready,
  onCopy,
  bottomInset = 0,
  sendRequest,
}: {
  messages: ChatMessage[];
  ready: boolean;
  onCopy?: (text: string) => void;
  bottomInset?: number;
  sendRequest?: { id: number; knownUserIds: string[] };
}) {
  const list = useRef<FlatList<ChatMessage>>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [reserveSpace, setReserveSpace] = useState(false);
  const handledRequest = useRef<number | undefined>(undefined);
  const pendingIndex = useRef<number | null>(null);
  const initialPositioned = useRef(false);
  const retryFrame = useRef<number | undefined>(undefined);
  const retries = useRef(0);

  useLayoutEffect(() => {
    if (!sendRequest || handledRequest.current === sendRequest.id) return;
    const reverseIndex = [...messages].reverse().findIndex(
      (message) => message.role === "user" && !sendRequest.knownUserIds.includes(message.id),
    );
    if (reverseIndex < 0) return;
    handledRequest.current = sendRequest.id;
    retries.current = 0;
    pendingIndex.current = messages.length - 1 - reverseIndex;
    initialPositioned.current = true;
    setReserveSpace(true);
  }, [messages, sendRequest]);

  const positionPending = () => {
    if (pendingIndex.current === null || !viewportHeight) return;
    const index = pendingIndex.current;
    pendingIndex.current = null;
    list.current?.scrollToIndex({ index, animated: false, viewPosition: 0 });
  };
  useEffect(() => {
    if (!reserveSpace || !viewportHeight || pendingIndex.current === null) return;
    const frame = requestAnimationFrame(positionPending);
    return () => cancelAnimationFrame(frame);
  }, [messages, reserveSpace, viewportHeight]);
  useEffect(() => () => {
    if (retryFrame.current !== undefined) cancelAnimationFrame(retryFrame.current);
  }, []);

  return (
    <FlatList
      ref={list}
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 20 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      data={messages}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <MessageBubble message={item} onCopy={onCopy} />}
      ListEmptyComponent={<Text>{ready ? "暂无消息" : "正在加载会话…"}</Text>}
      ListFooterComponent={<View onLayout={positionPending} style={{ height: reserveSpace ? viewportHeight + 12 : bottomInset + 12 }} />}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
      onContentSizeChange={() => {
        if (pendingIndex.current === null && !initialPositioned.current && ready && messages.length) {
          initialPositioned.current = true;
          list.current?.scrollToEnd({ animated: false });
        }
      }}
      onScrollBeginDrag={() => {
        pendingIndex.current = null;
        if (retryFrame.current !== undefined) cancelAnimationFrame(retryFrame.current);
      }}
      onScrollToIndexFailed={({ index, averageItemLength }) => {
        pendingIndex.current = index;
        list.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
        if (retries.current++ < 3) retryFrame.current = requestAnimationFrame(positionPending);
      }}
    />
  );
}
