import { useEffect, type ReactNode } from "react";
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
