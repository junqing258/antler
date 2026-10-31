import { useLayoutEffect, useRef } from "react";
import { FlatList, Text } from "react-native";
import type { ChatMessage } from "@antler/chat-core";
import { MessageBubble } from "./message-bubble";

export function MessageList({
  messages,
  ready,
  onCopy,
}: {
  messages: ChatMessage[];
  ready: boolean;
  onCopy?: (text: string) => void;
}) {
  const list = useRef<FlatList<ChatMessage>>(null);
  const following = useRef(true);
  const previousFirst = useRef<string | undefined>(undefined);
  const suppressFollow = useRef(false);
  useLayoutEffect(() => {
    const first = previousFirst.current;
    if (
      first &&
      messages[0]?.id !== first &&
      messages.some((message) => message.id === first)
    ) {
      suppressFollow.current = true;
    }
    previousFirst.current = messages[0]?.id;
  }, [messages]);
  const follow = () => {
    if (suppressFollow.current) {
      suppressFollow.current = false;
      following.current = false;
      return;
    }
    if (following.current && messages.length)
      list.current?.scrollToEnd({ animated: false });
  };
  return (
    <FlatList
      ref={list}
      style={{ flex: 1 }}
      data={messages}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <MessageBubble message={item} onCopy={onCopy} />
      )}
      ListEmptyComponent={<Text>{ready ? "暂无消息" : "正在加载会话…"}</Text>}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      onContentSizeChange={follow}
      onLayout={follow}
      onScroll={(event) => {
        const { contentOffset, contentSize, layoutMeasurement } =
          event.nativeEvent;
        following.current =
          contentSize.height - contentOffset.y - layoutMeasurement.height <= 48;
      }}
      scrollEventThrottle={16}
    />
  );
}
