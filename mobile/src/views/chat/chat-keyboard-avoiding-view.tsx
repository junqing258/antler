import type { ReactNode } from "react";
import { KeyboardAvoidingView, KeyboardProvider } from "react-native-keyboard-controller";

// Android edge-to-edge 下 adjustResize 不生效，用 keyboard-controller 按键盘高度做 padding 避让。
// keyboardVerticalOffset 让输入框与键盘顶部保留少量间距（仅键盘弹起时生效）。
export function ChatKeyboardAvoidingView({ children }: { children: ReactNode }) {
  return (
    <KeyboardProvider>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={8}>
        {children}
      </KeyboardAvoidingView>
    </KeyboardProvider>
  );
}
