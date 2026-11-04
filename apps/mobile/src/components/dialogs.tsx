import { useEffect, useRef, useState } from "react";
import { Button, Host } from "@expo/ui";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
  ScrollView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

/** 跨平台输入弹窗：空值禁止提交。 */
function CustomInputDialog({
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
      style={styles.backdrop}
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
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      {content}
    </Modal>
  );
}

/** 跨平台确认弹窗：用于删除等不可撤销操作。 */
function CustomConfirmDialog({
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
      style={styles.backdrop}
      onPress={onCancel}
    >
      <View style={styles.center} pointerEvents="box-none">
        <Pressable
          style={styles.card}
          onPress={(event) => event.stopPropagation()}
        >
          <Text style={styles.title}>{title}</Text>
          <ScrollView style={styles.messageScroll} bounces={false}>
            <Text style={styles.message}>{message}</Text>
          </ScrollView>
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
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      {content}
    </Modal>
  );
}

type InputDialogProps = Parameters<typeof CustomInputDialog>[0];
type ConfirmDialogProps = Parameters<typeof CustomConfirmDialog>[0];

/** iOS 提供带输入框的系统提示框；其他平台使用可输入的兼容实现。 */
export function InputDialog(props: InputDialogProps) {
  if (Platform.OS === "ios" && !props.embedded) return <NativeInputDialog {...props} />;
  return <CustomInputDialog {...props} />;
}

function NativeInputDialog(props: InputDialogProps) {
  const latest = useRef(props);
  latest.current = props;
  const value = useRef(props.initialValue);
  const [validationError, setValidationError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!props.visible) {
      value.current = props.initialValue;
      setValidationError("");
      return;
    }
    if (props.busy) return;
    Alert.prompt(
      props.title,
      props.error || validationError || undefined,
      [
        { text: "取消", style: "cancel", onPress: () => latest.current.onCancel() },
        {
          text: props.confirmLabel || "确定",
          onPress: (input) => {
            const next = (input || "").trim();
            value.current = input || "";
            if (!next || next.length > 200) {
              setValidationError(!next ? "请输入会话名称。" : "会话名称不能超过 200 个字符。");
              setAttempt((current) => current + 1);
              return;
            }
            setValidationError("");
            latest.current.onConfirm(next);
          },
        },
      ],
      "plain-text",
      value.current,
    );
  }, [props.visible, props.busy, props.error, props.title, props.confirmLabel, validationError, attempt]);
  return null;
}

/** 使用系统确认框，提交失败后再次显示错误和操作选项。 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  if (Platform.OS !== "web" && !props.embedded) return <NativeConfirmDialog {...props} />;
  return <CustomConfirmDialog {...props} />;
}

function NativeConfirmDialog(props: ConfirmDialogProps) {
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    if (!props.visible || props.busy) return;
    Alert.alert(
      props.title,
      props.error ? `${props.message}\n\n${props.error}` : props.message,
      [
        { text: "取消", style: "cancel", onPress: () => latest.current.onCancel() },
        { text: props.confirmLabel || "删除", style: "destructive", onPress: () => latest.current.onConfirm() },
      ],
      { cancelable: true, onDismiss: () => latest.current.onCancel() },
    );
  }, [props.visible, props.busy, props.error, props.title, props.message, props.confirmLabel]);
  return null;
}

const styles = StyleSheet.create({
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
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
    maxWidth: 400,
    maxHeight: "100%",
  },
  title: { fontSize: 16, fontWeight: "600", color: "#222" },
  messageScroll: { flexGrow: 0, flexShrink: 1 },
  message: { fontSize: 14, lineHeight: 21, color: "#555" },
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
});
