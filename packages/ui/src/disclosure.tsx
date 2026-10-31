import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export function Disclosure({
  open,
  onToggle,
  title,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.root}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        style={styles.header}
        onPress={onToggle}
      >
        <Text style={[styles.chevron, open && styles.chevronOpen]}>›</Text>
        <Text style={styles.title}>{title}</Text>
      </Pressable>
      {open && <View style={styles.body}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e9e9e9",
    backgroundColor: "#fcfcfc",
    marginBottom: 10,
    overflow: "hidden",
  },
  header: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  chevron: { color: "#777", fontSize: 14 },
  chevronOpen: { transform: [{ rotate: "90deg" }] },
  title: { fontSize: 13, fontWeight: "500", color: "#4c4c4c" },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#eee",
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 10,
  },
});
