import { useRef, type ElementRef } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSlashCommands } from "./use-slash-commands";

import type { ComposerProps } from "./composer-types";

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  running,
  disabled,
  leading,
  background,
}: ComposerProps) {
  const input = useRef<ElementRef<typeof TextInput>>(null);
  const commands = useSlashCommands(value, onChange);
  const unavailable = !running && (disabled || !value.trim());
  return (
    <View style={styles.container}>
      {commands.open && (
        <ScrollView
          style={styles.menu}
          keyboardShouldPersistTaps="always"
          accessibilityLabel="命令提示"
        >
          {commands.matches.map((command) => (
            <Pressable
              key={command.name}
              accessibilityRole="button"
              onPress={() => {
                commands.fill(command);
                input.current?.focus();
              }}
              style={styles.option}
            >
              <Text>
                /{command.name} · {command.label}
              </Text>
              <Text>{command.description}</Text>
            </Pressable>
          ))}
          {!commands.matches.length && (
            <Text style={styles.option}>没有匹配的命令</Text>
          )}
        </ScrollView>
      )}
      <View style={[styles.card, !background && styles.opaqueCard]}>
        {background && <View pointerEvents="none" style={styles.background}>{background}</View>}
        <TextInput
          ref={input}
          accessibilityLabel="消息"
          onFocus={() => commands.setFocused(true)}
          onBlur={() => commands.setFocused(false)}
          multiline
          value={value}
          onChangeText={onChange}
          style={styles.input}
          placeholder="随心输入，/ 使用命令"
          placeholderTextColor="#999"
        />
        <View style={styles.row}>
          <View style={styles.leading}>{leading}</View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={running ? "停止" : "发送"}
            accessibilityState={{ disabled: unavailable }}
            disabled={unavailable}
            style={[styles.button, unavailable && styles.disabled]}
            onPress={running ? onStop : onSend}
          >
            <Text style={styles.buttonText}>{running ? "■" : "↑"}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { zIndex: 10 },
  card: {
    borderWidth: 1,
    borderColor: "#e3e3e3",
    borderRadius: 20,
    padding: 10,
    gap: 2,
  },
  opaqueCard: { backgroundColor: "#fff" },
  background: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, borderRadius: 20, overflow: "hidden" },
  menu: {
    position: "absolute",
    bottom: "100%",
    marginBottom: 8,
    width: "100%",
    maxHeight: 200,
    zIndex: 20,
    borderWidth: 1,
    borderColor: "#e3e3e3",
    borderRadius: 14,
    backgroundColor: "white",
  },
  option: { padding: 12 },
  leading: { flex: 1, minWidth: 0, alignItems: "flex-end" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, zIndex: 10 },
  input: {
    maxHeight: 120,
    minHeight: 32,
    paddingHorizontal: 4,
    paddingVertical: 2,
    fontSize: 15,
    lineHeight: 24,
    color: "#292929",
    textAlignVertical: "top",
  },
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#292929",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "white", fontSize: 24, lineHeight: 28 },
  disabled: { backgroundColor: "#999" },
});
