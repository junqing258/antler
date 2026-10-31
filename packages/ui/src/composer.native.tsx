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
}: ComposerProps) {
  const input = useRef<ElementRef<typeof TextInput>>(null);
  const commands = useSlashCommands(value, onChange);
  const unavailable = !running && (disabled || !value.trim());
  return (
    <View>
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
      <View style={styles.row}>
        <TextInput
          ref={input}
          accessibilityLabel="消息"
          onFocus={() => commands.setFocused(true)}
          onBlur={() => commands.setFocused(false)}
          multiline
          value={value}
          onChangeText={onChange}
          style={styles.input}
          placeholder="输入消息"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: unavailable }}
          disabled={unavailable}
          style={[styles.button, unavailable && styles.disabled]}
          onPress={running ? onStop : onSend}
        >
          <Text style={styles.buttonText}>{running ? "停止" : "发送"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  menu: {
    maxHeight: 200,
    borderWidth: 1,
    borderColor: "#aaa",
    borderRadius: 8,
    backgroundColor: "white",
  },
  option: { padding: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginVertical: 8,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    borderWidth: 1,
    borderColor: "#aaa",
    borderRadius: 8,
    padding: 10,
  },
  button: {
    borderRadius: 8,
    backgroundColor: "#087d61",
    padding: 10,
    alignSelf: "flex-start",
  },
  buttonText: { color: "white", fontWeight: "600" },
  disabled: { opacity: 0.45 },
});
