import { Button as ExpoButton, Host } from "@expo/ui";

/** 主品牌色按钮：自动化探针切换、退出登录等通用文字按钮。 */
export function Button({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Host matchContents>
      <ExpoButton label={label} onPress={onPress} variant="text" />
    </Host>
  );
}
