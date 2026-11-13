import type { StyleProp, TextInputProps, ViewStyle } from "react-native";

export type FormTextInputProps = Pick<
  TextInputProps,
  | "placeholder"
  | "accessibilityLabel"
  | "autoCapitalize"
  | "autoCorrect"
  | "secureTextEntry"
  | "keyboardType"
  | "editable"
> & {
  value: string;
  onChangeText: (text: string) => void;
  onSubmitEditing?: () => void;
  containerStyle?: StyleProp<ViewStyle>;
};

export type FormButtonProps = {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "filled" | "outlined" | "text";
  containerStyle?: StyleProp<ViewStyle>;
};

export type FormChoiceProps = Omit<FormButtonProps, "variant"> & {
  selected: boolean;
  variant?: "protocol" | "model";
};
