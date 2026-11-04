import type { ReactNode } from "react";
// react-native 运行时由 vite alias(react-native-web)提供,web 包未安装其类型。
// @ts-expect-error tsc 不识别 vite alias
import { View } from "react-native";

type Props = { children: ReactNode } & Record<string, unknown>;

export function KeyboardProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function KeyboardAvoidingView({ children, ...props }: Props) {
  return <View {...props}>{children}</View>;
}
