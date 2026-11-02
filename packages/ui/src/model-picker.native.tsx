import { useMemo, useState } from "react";
import { BottomSheet, RNHostView } from "@expo/ui";
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

/**
 * Native model selection is deliberately hosted in a Modal instead of the
 * composer. The composer sits in an absolutely-positioned dock, where an
 * inline popover can be clipped or lose touch events behind the keyboard.
 */
export function ModelPicker({
  model,
  models,
  onModelChange,
  onConfigure,
}: {
  model: string;
  models: string[];
  onModelChange: (model: string) => void;
  onConfigure?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { height: windowHeight } = useWindowDimensions();
  const availableModels = useMemo(
    () => [
      ...new Set(models.map((candidate) => candidate.trim()).filter(Boolean)),
    ],
    [models],
  );
  const available = availableModels.length > 0;
  const sheetHeight = Math.min(
    windowHeight * 0.8,
    180 + Math.max(availableModels.length, 2) * 60,
  );
  const close = () => setOpen(false);

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="选择模型"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          Keyboard.dismiss();
          setOpen(true);
        }}
        style={({ pressed }) => [
          styles.trigger,
          pressed && styles.triggerPressed,
        ]}
      >
        <Text style={styles.label} numberOfLines={1}>
          {model || "服务端默认模型"}
        </Text>
        <Text style={styles.chevron}>⌄</Text>
      </Pressable>
      <BottomSheet
        isPresented={open}
        onDismiss={close}
        snapPoints={[{ height: sheetHeight }]}
        contentPadding={0}
        containerColor="#f7f7f7"
      >
        <RNHostView>
          <View
            accessibilityViewIsModal
            style={[styles.sheet, { height: sheetHeight }]}
          >
            <View style={styles.header}>
              <View style={styles.headerSide} />
              <Text accessibilityRole="header" style={styles.title}>
                模型
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="完成"
                hitSlop={10}
                onPress={close}
                style={styles.doneButton}
              >
                <Text style={styles.done}>完成</Text>
              </Pressable>
            </View>
            <Text style={styles.sectionTitle}>模型</Text>
            {!available && (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>
                  当前使用服务端默认模型。配置供应商和模型后即可切换。
                </Text>
                {onConfigure && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="配置模型"
                    onPress={() => {
                      close();
                      onConfigure();
                    }}
                  >
                    <Text style={styles.configure}>配置模型</Text>
                  </Pressable>
                )}
              </View>
            )}
            <View style={styles.options}>
              <ScrollView
                bounces={false}
                keyboardShouldPersistTaps="always"
                showsVerticalScrollIndicator={false}
              >
                {availableModels.map((candidate, index) => {
                  const selected = candidate === model;
                  return (
                    <Pressable
                      key={candidate}
                      accessibilityRole="button"
                      accessibilityLabel={candidate}
                      accessibilityState={{ selected }}
                      onPress={() => {
                        close();
                        if (!selected) onModelChange(candidate);
                      }}
                      style={({ pressed }) => [
                        styles.option,
                        index > 0 && styles.optionDivider,
                        pressed && styles.optionPressed,
                      ]}
                    >
                      <Text style={styles.optionLabel} numberOfLines={1}>
                        {candidate}
                      </Text>
                      {selected && <Text style={styles.check}>✓</Text>}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </RNHostView>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { minWidth: 0, flexShrink: 1 },
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
  triggerPressed: { opacity: 0.68 },
  label: { fontSize: 13, color: "#222", flexShrink: 1 },
  chevron: { fontSize: 18, lineHeight: 18, color: "#777", marginTop: -4 },
  sheet: {
    width: "100%",
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 24,
    backgroundColor: "#f7f7f7",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
    marginTop: 8,
    marginBottom: 24,
  },
  title: { fontSize: 20, lineHeight: 28, fontWeight: "700", color: "#111" },
  headerSide: { width: 56 },
  doneButton: {
    width: 56,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "flex-end",
  },
  done: { fontSize: 17, lineHeight: 24, fontWeight: "600", color: "#111" },
  sectionTitle: {
    marginLeft: 12,
    marginBottom: 8,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    color: "#747474",
  },
  options: {
    flexShrink: 1,
    overflow: "hidden",
    borderRadius: 20,
    backgroundColor: "#fff",
  },
  empty: { padding: 20, gap: 16, borderRadius: 20, backgroundColor: "#fff" },
  emptyText: { fontSize: 16, lineHeight: 24, color: "#666" },
  configure: { fontSize: 16, fontWeight: "600", color: "#087d61" },
  option: {
    minHeight: 60,
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  optionDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e6e6e6",
  },
  optionPressed: { backgroundColor: "#f1f1f1" },
  optionLabel: {
    flex: 1,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "500",
    color: "#111",
  },
  check: {
    marginLeft: 16,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "500",
    color: "#111",
  },
});
