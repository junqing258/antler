import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

export type SkillItem = {
  id: string;
  name: string;
  state: string;
  bindable: boolean;
  unbindableReason?: string;
  description: string;
  fileCount: number;
  /** 已格式化的体积（如 "12.3 KiB"）与更新时间文本。 */
  sizeLabel: string;
  updatedAtLabel: string;
  editable: boolean;
};

/**
 * 平台技能列表：展示与删除意图；文件上传是平台能力，
 * 覆盖更新入口经 renderUpload 插槽注入（Web 传文件选择元素）。
 */
export function SkillList({
  skills,
  onRemove,
  renderUpload,
  emptyText = "还没有平台技能。",
}: {
  skills: SkillItem[];
  onRemove: (skill: SkillItem) => void;
  renderUpload?: (skill: SkillItem, label: string) => ReactNode;
  emptyText?: string;
}) {
  return (
    <View style={styles.list}>
      {skills.map((skill) => (
        <View key={skill.id} style={styles.card}>
          <View style={styles.info}>
            <View style={styles.nameRow}>
              <Text accessibilityRole="header" style={styles.name}>
                {skill.name}
              </Text>
              <Text style={styles.state}>
                {skill.state}
                {!skill.bindable && ` · 不可绑定 (${skill.unbindableReason})`}
              </Text>
            </View>
            <Text style={styles.description}>{skill.description}</Text>
            <Text style={styles.meta}>
              {`${skill.fileCount} 个文件 · ${skill.sizeLabel} · ${skill.updatedAtLabel}`}
            </Text>
          </View>
          {skill.editable && (
            <View style={styles.actions}>
              {renderUpload?.(skill, "覆盖更新")}
              <Text
                accessibilityRole="button"
                accessibilityLabel={`删除 ${skill.name}`}
                onPress={() => onRemove(skill)}
                style={styles.remove}
              >
                删除
              </Text>
            </View>
          )}
        </View>
      ))}
      {skills.length === 0 && (
        <Text style={styles.empty}>{emptyText}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  card: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e6e6e2",
    backgroundColor: "white",
    padding: 20,
  },
  info: { flex: 1, minWidth: 0 },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  name: { fontSize: 15, fontWeight: "600", color: "#222" },
  state: { fontSize: 12, color: "#777" },
  description: { marginVertical: 8, fontSize: 14, color: "#666" },
  meta: { fontSize: 12, color: "#888" },
  actions: { flexDirection: "row", alignItems: "center", gap: 12 },
  remove: { fontSize: 14, color: "#b42318" },
  empty: { padding: 48, textAlign: "center", color: "#888" },
});
