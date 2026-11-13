import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { Button, Host, TextInput, useNativeState } from "@expo/ui";
import {
  accessibilityLabel,
  textFieldStyle,
} from "@expo/ui/swift-ui/modifiers";
import { semantics } from "@expo/ui/jetpack-compose/modifiers";
import type {
  FormButtonProps,
  FormChoiceProps,
  FormTextInputProps,
} from "./form-control-types";

/** Bridge React form drafts to Expo's observable input state without echoing keystrokes. */
export function FormTextInput({
  value,
  onChangeText,
  containerStyle,
  ...props
}: FormTextInputProps) {
  const text = useNativeState(value);
  const lastValue = useRef(value);
  useEffect(() => {
    if (lastValue.current === value) return;
    lastValue.current = value;
    text.set(value);
  }, [value, text]);
  return (
    <Host
      matchContents={{ vertical: true }}
      style={[{ width: "100%" }, containerStyle]}
      colorScheme="light"
      seedColor="#087d61"
      ignoreSafeArea="all"
    >
      <TextInput
        {...props}
        value={text}
        onChangeText={(next) => {
          if (lastValue.current === next) return;
          lastValue.current = next;
          onChangeText(next);
        }}
        modifiers={
          Platform.OS === "ios" ? [textFieldStyle("roundedBorder")] : undefined
        }
        style={
          Platform.OS === "android"
            ? {
                width: "100%",
                borderWidth: 1,
                borderColor: "#ddd",
                borderRadius: 8,
                padding: 12,
              }
            : { width: "100%" }
        }
        textStyle={{ fontSize: 14, color: "#222" }}
      />
    </Host>
  );
}

export function FormButton({
  label,
  accessibilityLabel: accessibleLabel,
  onPress,
  disabled,
  variant = "filled",
  containerStyle,
}: FormButtonProps) {
  const name = accessibleLabel || label;
  return (
    <Host
      matchContents={containerStyle ? { vertical: true } : true}
      style={containerStyle}
      colorScheme="light"
      seedColor="#087d61"
      ignoreSafeArea="all"
    >
      <Button
        label={label}
        onPress={onPress}
        disabled={disabled}
        variant={variant}
        style={containerStyle ? { width: "100%" } : undefined}
        modifiers={
          Platform.OS === "ios"
            ? [accessibilityLabel(name)]
            : [semantics({ contentDescription: name })]
        }
      />
    </Host>
  );
}

export function FormChoice({
  selected,
  variant: _variant,
  ...props
}: FormChoiceProps) {
  return (
    <FormButton
      {...props}
      accessibilityLabel={`${props.accessibilityLabel || props.label}，${selected ? "已选择" : "未选择"}`}
      variant={selected ? "filled" : "outlined"}
    />
  );
}
