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
  const isUser = message.role === "user";
  const running = message.status?.type === "running";
  const copyable =
    message.role === "assistant" && !running && !!messageText(message);
  return (
    <View
      style={[
        styles.message,
        isUser ? styles.userMessage : styles.assistantMessage,
      ]}
    >
      {!isUser && (
        <View style={styles.header}>
          <Text style={styles.label}>
            {running ? "正在工作" : "Antler"}
          </Text>
          {copyable && onCopy && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="复制回复"
              onPress={() => onCopy(messageText(message))}
              style={styles.copyButton}
            >
              <Text style={styles.action}>复制</Text>
            </Pressable>
          )}
        </View>
      )}
      {message.content.map((part, i) => {
        if (part.type === "text")
          return (
            <MessageMarkdown
              key={i}
              text={part.text}
              streaming={running || message.live}
            />
          );
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
  message: { minWidth: 0, gap: 8, marginBottom: 28 },
  userMessage: {
    alignSelf: "flex-end",
    maxWidth: "85%",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#f5f5f5",
    borderWidth: 1,
    borderColor: "#e8e8e8",
    borderRadius: 20,
  },
  assistantMessage: { alignSelf: "stretch", paddingVertical: 8 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 32,
    paddingBottom: 8,
    marginBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: "#e8e8e8",
  },
  label: { fontSize: 13, color: "#888", flex: 1 },
  copyButton: { paddingVertical: 6, paddingHorizontal: 8 },
  action: { fontSize: 12, color: "#888" },
  muted: { fontSize: 13, lineHeight: 22, color: "#888" },
  error: { fontSize: 13, lineHeight: 22, color: "#b42318" },
});
