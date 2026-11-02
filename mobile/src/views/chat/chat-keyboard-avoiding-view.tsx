import type { ReactNode } from "react";
import { View } from "react-native";

export function ChatKeyboardAvoidingView({ children }: { children: ReactNode }) {
  return <View style={{ flex: 1 }}>{children}</View>;
}
