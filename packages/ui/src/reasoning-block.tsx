import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { Disclosure } from "./disclosure";

export function ReasoningBlock({
  text,
  running = false,
}: {
  text: string;
  running?: boolean;
}) {
  const [open, setOpen] = useState(running);
  useEffect(() => {
    setOpen(running);
  }, [running]);
  return (
    <Disclosure
      open={open}
      onToggle={() => setOpen((value) => !value)}
      title={running ? "正在思考" : "思考过程"}
    >
      <ScrollView style={styles.scroll} nestedScrollEnabled>
        <Text selectable style={styles.text}>
          {text}
        </Text>
      </ScrollView>
    </Disclosure>
  );
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 260 },
  text: { fontSize: 12, lineHeight: 20, color: "#686868" },
});
