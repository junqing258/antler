import { Pressable, Text, StyleSheet } from "react-native";

/** 主品牌色按钮：自动化探针切换、退出登录等通用文字按钮。 */
export function Button({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.button}
    >
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { padding: 12, alignSelf: "flex-start" },
  text: { color: "#087d61", fontWeight: "600" },
});
