import { Pressable, StyleSheet, Text, TextInput } from "react-native";
import type {
  FormButtonProps,
  FormChoiceProps,
  FormTextInputProps,
} from "./form-control-types";

export function FormTextInput({
  containerStyle,
  ...props
}: FormTextInputProps) {
  return <TextInput {...props} style={[styles.input, containerStyle]} />;
}

export function FormButton({
  label,
  accessibilityLabel,
  onPress,
  disabled,
  variant = "filled",
  containerStyle,
}: FormButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        variant === "filled" && styles.filled,
        variant === "text" && styles.textButton,
        disabled && styles.disabled,
        containerStyle,
      ]}
    >
      <Text
        style={
          variant === "filled"
            ? styles.filledText
            : variant === "text"
              ? styles.actionText
              : styles.buttonText
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function FormChoice({
  label,
  accessibilityLabel,
  onPress,
  disabled,
  selected,
  variant = "protocol",
  containerStyle,
}: FormChoiceProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ checked: selected, disabled }}
      aria-checked={selected}
      onPress={onPress}
      disabled={disabled}
      style={[
        variant === "protocol" ? styles.choice : styles.modelChoice,
        selected && variant === "protocol" && styles.selected,
        disabled && styles.disabled,
        containerStyle,
      ]}
    >
      {variant === "model" && (
        <Text style={selected ? styles.selectedText : styles.buttonText}>
          {selected ? "◉" : "○"}
        </Text>
      )}
      <Text
        numberOfLines={1}
        style={[styles.buttonText, selected && styles.selectedText]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    backgroundColor: "white",
    paddingHorizontal: 11,
    paddingVertical: 10,
    fontSize: 13,
    color: "#222",
  },
  button: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    backgroundColor: "white",
    paddingHorizontal: 13,
    paddingVertical: 8,
    alignItems: "center",
  },
  filled: { backgroundColor: "#087d61", borderColor: "#087d61" },
  textButton: {
    borderWidth: 0,
    paddingHorizontal: 0,
    backgroundColor: "transparent",
  },
  filledText: { color: "white", fontSize: 14, fontWeight: "500" },
  buttonText: { color: "#222", fontSize: 13, flexShrink: 1 },
  actionText: { color: "#b42318", fontSize: 12 },
  disabled: { opacity: 0.5 },
  choice: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "white",
  },
  modelChoice: { flexDirection: "row", alignItems: "center", gap: 8 },
  selected: { borderColor: "#087d61", backgroundColor: "#f2faf5" },
  selectedText: { color: "#087d61", fontSize: 13, fontWeight: "600" },
});
