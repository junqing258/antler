import type { ChatMessage } from "@antler/chat-core";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MessageMarkdown } from "./message-markdown";
import { ReasoningBlock } from "./reasoning-block";
import { ToolCallBlock } from "./tool-call-block";

function messageText(message: ChatMessage) {
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n\n");
}

export function MessageBubble({
  message,
  onCopy,
}: {
  message: ChatMessage;
  onCopy?: (text: string) => void;
}) {
  const running = message.status?.type === "running";
  const copyable = message.role === "assistant" && !running && !!messageText(message);
  return (
    <View style={styles.message}>
      <View style={styles.header}>
        <Text style={styles.label}>
          {message.role === "user" ? "你" : "Antler"}
        </Text>
        {copyable && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="复制回复"
            onPress={() => onCopy?.(messageText(message))}
          >
            <Text style={styles.action}>复制</Text>
          </Pressable>
        )}
      </View>
      {message.content.map((part, i) => {
        if (part.type === "text")
          return <MessageMarkdown key={i} text={part.text} />;
        if (part.type === "reasoning")
          return <ReasoningBlock key={i} text={part.text} running={running} />;
        if (part.type === "tool-call")
          return (
            <ToolCallBlock
              key={i}
              toolName={part.toolName}
              args={part.args}
              result={part.result}
              isError={part.isError}
            />
          );
        return <Text key={i}>[不支持的消息内容]</Text>;
      })}
      {running && message.content.length === 0 && (
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          正在等待 Agent 回复…
        </Text>
      )}
      {message.status?.type === "incomplete" && (
        <Text
          accessibilityLiveRegion="polite"
          style={
            message.status.reason === "error" ? styles.error : styles.muted
          }
        >
          {message.status.reason === "error" ? message.status.error : "已停止"}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  message: {
    padding: 12,
    marginVertical: 5,
    backgroundColor: "#f3f6f5",
    borderRadius: 8,
    gap: 4,
  },
  header: { flexDirection: "row", alignItems: "center" },
  label: { fontWeight: "700", flex: 1 },
  action: { fontSize: 12, color: "#126b9a" },
  muted: { fontSize: 12, color: "#686868" },
  error: { fontSize: 12, color: "#b42318" },
});
