import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

export function Disclosure({
  open,
  onToggle,
  title,
  icon,
  tone = "neutral",
  children,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  icon?: ReactNode;
  tone?: "neutral" | "active" | "error";
  children: ReactNode;
}) {
  return (
    <View style={styles.root}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        style={[styles.header, tone === "error" && styles.errorHeader]}
        onPress={onToggle}
      >
        {icon && <View style={styles.icon}>{icon}</View>}
        <Text
          style={[
            styles.title,
            tone === "active" && styles.activeText,
            tone === "error" && styles.errorText,
          ]}
        >
          {title}
        </Text>
        <View style={open ? styles.chevronOpen : undefined}>
          <ChevronRight
            size={15}
            strokeWidth={1.8}
            color={tone === "error" ? "#b42318" : "#8a8a8a"}
          />
        </View>
      </Pressable>
      {open && <View style={styles.body}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    marginBottom: 6,
  },
  header: {
    alignSelf: "flex-start",
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  errorHeader: { backgroundColor: "#fff7f6" },
  icon: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  chevronOpen: { transform: [{ rotate: "90deg" }] },
  title: { fontSize: 13, fontWeight: "400", color: "#6b6b6b", lineHeight: 20 },
  activeText: { color: "#4f4f4f" },
  errorText: { color: "#b42318" },
  body: {
    marginLeft: 12,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: "#e5e5e5",
    paddingLeft: 17,
    paddingBottom: 8,
    paddingTop: 4,
  },
});
