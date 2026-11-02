import { useContext, type ReactNode } from "react";
import { View } from "react-native";
import { KeyboardAvoidingView, KeyboardEffects, KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

export function ChatKeyboardAvoidingView({ children }: { children: ReactNode }) {
  const insets = useContext(SafeAreaInsetsContext);
  return (
    <KeyboardProvider>
      <KeyboardEffects
        rounded={false}
        pointerEvents="none"
        style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}
      >
        <View style={{ flex: 1, backgroundColor: "#fff" }} />
      </KeyboardEffects>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: "#fff" }}
        behavior="padding"
        keyboardVerticalOffset={(insets?.top ?? 0) + 8}
      >
        {children}
      </KeyboardAvoidingView>
    </KeyboardProvider>
  );
}
