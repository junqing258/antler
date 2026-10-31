import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { Disclosure } from "./disclosure";

export function ToolCallBlock({
  toolName,
  args,
  result,
  isError = false,
}: {
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
}) {
  const running = result === undefined;
  const [open, setOpen] = useState(running);
  useEffect(() => {
    if (!running) setOpen(false);
  }, [running]);
  const query = "query" in args ? String(args.query ?? "") : "";
  return (
    <Disclosure
      open={open}
      onToggle={() => setOpen((value) => !value)}
      title={
        running
          ? `正在调用 ${toolName}`
          : isError
            ? `${toolName} 调用失败`
            : `${toolName} 调用完成`
      }
    >
      <ScrollView style={styles.scroll} nestedScrollEnabled>
        {query ? (
          <Text selectable style={styles.text}>
            {`查询：${query}`}
          </Text>
        ) : (
          <Text selectable style={[styles.text, styles.code]}>
            {JSON.stringify(args, null, 2)}
          </Text>
        )}
        {result !== undefined && (
          <Text
            selectable
            style={[styles.text, styles.code, isError && styles.error]}
          >
            {typeof result === "string"
              ? result
              : JSON.stringify(result, null, 2)}
          </Text>
        )}
      </ScrollView>
    </Disclosure>
  );
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 260 },
  text: { fontSize: 12, lineHeight: 20, color: "#686868" },
  code: { fontFamily: "monospace" },
  error: { color: "#b42318" },
});
