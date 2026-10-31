import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export function ModelPicker({
  model,
  models,
  onModelChange,
}: {
  model: string;
  models: string[];
  onModelChange: (model: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const available = models.length > 0;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="选择模型"
        accessibilityState={{ expanded: open, disabled: !available }}
        disabled={!available}
        onPress={() => setOpen((value) => !value)}
        style={styles.trigger}
      >
        <Text style={styles.label} numberOfLines={1}>
          {model || "服务端默认"}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>
      {open && (
        <View style={styles.menu}>
          {models.map((candidate) => (
            <Pressable
              key={candidate}
              accessibilityRole="button"
              accessibilityLabel={candidate}
              accessibilityState={{ selected: candidate === model }}
              onPress={() => {
                setOpen(false);
                if (candidate !== model) onModelChange(candidate);
              }}
              style={[styles.option, candidate === model && styles.active]}
            >
              <Text numberOfLines={1}>{candidate}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 4,
    maxWidth: 220,
  },
  label: { fontSize: 13, color: "#222", flexShrink: 1 },
  chevron: { fontSize: 11, color: "#777" },
  menu: {
    position: "absolute",
    top: "100%",
    left: 0,
    zIndex: 10,
    minWidth: 180,
    maxWidth: 260,
    maxHeight: 220,
    borderWidth: 1,
    borderColor: "#aaa",
    borderRadius: 8,
    backgroundColor: "white",
  },
  option: { padding: 8 },
  active: { backgroundColor: "#e4e9e7" },
});
