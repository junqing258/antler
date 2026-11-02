import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

export function ModelPicker({
  model,
  models,
  onModelChange,
  onConfigure: _onConfigure,
}: {
  model: string;
  models: string[];
  onModelChange: (model: string) => void;
  onConfigure?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const available = models.length > 0;
  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="选择模型"
        accessibilityState={{ expanded: open, disabled: !available }}
        disabled={!available}
        onPress={() => setOpen((value) => !value)}
        style={styles.trigger}
      >
        <Text style={styles.label} numberOfLines={1}>
          {model || "服务端默认模型"}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>
      {open && (
        <View style={styles.menu}>
          <Text style={styles.menuTitle}>选择模型</Text>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={styles.menuList}
          >
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
                <Text style={styles.optionLabel} numberOfLines={1}>
                  {candidate}
                </Text>
                {candidate === model && <Text style={styles.check}>✓</Text>}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { minWidth: 0, flexShrink: 1, zIndex: 10 },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 40,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 22,
    backgroundColor: "#f3f3f3",
    maxWidth: 220,
  },
  label: { fontSize: 13, color: "#222", flexShrink: 1 },
  chevron: { fontSize: 11, color: "#777" },
  menu: {
    position: "absolute",
    bottom: "100%",
    marginBottom: 8,
    right: 0,
    zIndex: 10,
    minWidth: 180,
    maxWidth: 260,
    maxHeight: 300,
    borderWidth: 1,
    borderColor: "#e3e3e3",
    borderRadius: 18,
    backgroundColor: "white",
  },
  menuTitle: {
    color: "#888",
    fontSize: 13,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 6,
  },
  menuList: { maxHeight: 250 },
  option: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
  },
  optionLabel: { flex: 1, fontSize: 14, color: "#222" },
  check: { color: "#555", marginLeft: 12 },
  active: { backgroundColor: "#f3f3f3" },
});
