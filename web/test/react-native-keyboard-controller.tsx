import type { ReactNode } from "react";
import { View } from "react-native";

type Props = { children: ReactNode } & Record<string, unknown>;

export function KeyboardProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function KeyboardAvoidingView({ children, ...props }: Props) {
  return <View {...props}>{children}</View>;
}
