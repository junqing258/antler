import { useEffect, useState } from "react";
import { BottomSheet, Button, Host, RNHostView } from "@expo/ui";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

/** 跨平台输入弹窗：空值禁止提交。 */
export function InputDialog({
  visible,
  title,
  initialValue,
  confirmLabel = "确定",
  busy = false,
  error,
  onConfirm,
  onCancel,
  embedded = false,
}: {
  visible: boolean;
  title: string;
  initialValue: string;
  confirmLabel?: string;
  busy?: boolean;
  error?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
  embedded?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);
  const invalid = !value.trim() || busy;
  const submit = () => {
    if (invalid) return;
    onConfirm(value.trim());
  };
  const content = (
    <Pressable
      style={embedded ? styles.backdrop : styles.sheetContent}
      onPress={onCancel}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.center}
        pointerEvents="box-none"
      >
        <Pressable
          style={styles.card}
          onPress={(event) => event.stopPropagation()}
        >
          <Text style={styles.title}>{title}</Text>
          <TextInput
            accessibilityLabel="会话名称"
            value={value}
            onChangeText={setValue}
            onSubmitEditing={submit}
            maxLength={200}
            autoFocus
            style={styles.input}
          />
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          <View style={styles.actions}>
            <Host matchContents seedColor="#087d61">
              <Button label="取消" variant="text" onPress={onCancel} />
            </Host>
            <Host matchContents seedColor="#087d61">
              <Button
                label={busy ? "处理中…" : confirmLabel}
                disabled={invalid}
                onPress={submit}
              />
            </Host>
          </View>
        </Pressable>
      </KeyboardAvoidingView>
    </Pressable>
  );
  if (embedded)
    return visible ? (
      <View style={styles.overlay} accessibilityViewIsModal>
        {content}
      </View>
    ) : null;
  return (
    <BottomSheet
      isPresented={visible}
      onDismiss={onCancel}
      snapPoints={[{ height: 320 }]}
      contentPadding={0}
    >
      <RNHostView>
        <View style={styles.sheetFrame}>{content}</View>
      </RNHostView>
    </BottomSheet>
  );
}

/** 跨平台确认弹窗：用于删除等不可撤销操作。 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = "删除",
  busy = false,
  error,
  onConfirm,
  onCancel,
  embedded = false,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
  embedded?: boolean;
}) {
  const content = (
    <Pressable
      style={embedded ? styles.backdrop : styles.sheetContent}
      onPress={onCancel}
    >
      <View style={styles.center} pointerEvents="box-none">
        <Pressable
          style={styles.card}
          onPress={(event) => event.stopPropagation()}
        >
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          <View style={styles.actions}>
            <Host matchContents seedColor="#087d61">
              <Button label="取消" variant="text" onPress={onCancel} />
            </Host>
            <Host matchContents seedColor="#b3261e">
              <Button
                label={busy ? "处理中…" : confirmLabel}
                disabled={busy}
                onPress={onConfirm}
              />
            </Host>
          </View>
        </Pressable>
      </View>
    </Pressable>
  );
  if (embedded)
    return visible ? (
      <View style={styles.overlay} accessibilityViewIsModal>
        {content}
      </View>
    ) : null;
  return (
    <BottomSheet
      isPresented={visible}
      onDismiss={onCancel}
      snapPoints={[{ height: 320 }]}
      contentPadding={0}
    >
      <RNHostView>
        <View style={styles.sheetFrame}>{content}</View>
      </RNHostView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheetFrame: { height: 320, width: "100%" },
  sheetContent: { flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    gap: 12,
    width: "100%",
    maxWidth: 320,
  },
  title: { fontSize: 16, fontWeight: "600", color: "#222" },
  message: { fontSize: 14, color: "#555" },
  error: { fontSize: 14, color: "#b3261e" },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 44,
  },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  button: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  confirm: { backgroundColor: "#087d61" },
  destructive: { backgroundColor: "#b3261e" },
  disabled: { opacity: 0.5 },
  cancelText: { color: "#087d61", fontSize: 15, fontWeight: "600" },
  confirmText: { color: "white", fontSize: 15, fontWeight: "600" },
  disabledText: { color: "rgba(255,255,255,0.8)" },
});
