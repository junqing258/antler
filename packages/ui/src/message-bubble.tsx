import type { ChatMessage } from "@antler/chat-core";
import { StyleSheet, Text, View } from "react-native";
import { MessageMarkdown } from "./message-markdown";

export function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <View style={styles.message}>
      <Text style={styles.label}>
        {message.role === "user" ? "你" : "Antler"}
      </Text>
      {message.content.map((part, i) => {
        if (part.type === "text")
          return <MessageMarkdown key={i} text={part.text} />;
        if (part.type === "reasoning")
          return (
            <Text selectable key={i}>
              {`思考：${part.text}`}
            </Text>
          );
        if (part.type === "tool-call")
          return (
            <Text selectable key={i}>
              工具：{part.toolName}
              {part.result === undefined
                ? "（运行中）"
                : `\n${JSON.stringify(part.result)}`}
              {part.isError ? "（错误）" : ""}
            </Text>
          );
        return <Text key={i}>[不支持的消息内容]</Text>;
      })}
      {message.status?.type === "incomplete" && (
        <Text>
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
  label: { fontWeight: "700" },
});
