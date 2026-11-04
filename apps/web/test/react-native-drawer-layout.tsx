import { useEffect, type ReactNode } from "react";
// react-native 运行时由 vite alias(react-native-web)提供,web 包未安装其类型。
// @ts-expect-error tsc 不识别 vite alias
import { Pressable, View } from "react-native";

type DrawerProps = {
  open: boolean;
  children: ReactNode;
  renderDrawerContent: () => ReactNode;
  onClose: () => void;
  onTransitionEnd?: (closing: boolean) => void;
};

/** Mirrors the controlled transition contract without loading native ESM in jsdom. */
export function Drawer({
  open,
  children,
  renderDrawerContent,
  onClose,
  onTransitionEnd,
}: DrawerProps) {
  useEffect(() => {
    if (!open) onTransitionEnd?.(true);
  }, [open, onTransitionEnd]);
  return (
    <View>
      {children}
      {open && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭会话菜单"
          onPress={onClose}
        />
      )}
      {open && <View>{renderDrawerContent()}</View>}
    </View>
  );
}
