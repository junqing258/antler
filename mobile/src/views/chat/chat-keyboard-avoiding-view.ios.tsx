import { useContext, type ReactNode } from "react";
import { KeyboardAvoidingView, KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

export function ChatKeyboardAvoidingView({ children }: { children: ReactNode }) {
  const insets = useContext(SafeAreaInsetsContext);
  return (
    <KeyboardProvider>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={insets?.top ?? 0}
      >
        {children}
      </KeyboardAvoidingView>
    </KeyboardProvider>
  );
}
