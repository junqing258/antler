import type { ReactNode } from "react";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

export type AgentCardItem = {
  id: string;
  name: string;
  description: string;
  icon?: string | null;
  status: string;
  skillCount?: number;
  editable: boolean;
  /** 宿主计算的尾注（如"作者 xxx"）；空串不显示。 */
  ownerNote?: string;
};

export type AgentListLink = {
  kind: "open" | "edit";
  item: AgentCardItem;
};

/**
 * Agent 列表：分组卡片展示。导航元素由宿主经 renderLink 注入
 * （Web 用 react-router Link，原生用路由导航），图标渲染同理。
 */
export function AgentList({
  groups,
  renderLink,
  renderIcon,
  renderFooter,
}: {
  groups: { name: string; items: AgentCardItem[] }[];
  renderLink: (link: AgentListLink, content: ReactNode) => ReactNode;
  renderIcon?: (name?: string | null) => ReactNode;
  renderFooter?: (item: AgentCardItem) => ReactNode;
}) {
  return (
    <View>
      {groups.map((group) =>
        group.items.length > 0 ? (
          <View key={group.name} style={styles.group}>
            <Text accessibilityRole="header" style={styles.groupTitle}>
              {group.name}
            </Text>
            <AgentGrid
              items={group.items}
              renderLink={renderLink}
              renderIcon={renderIcon}
              renderFooter={renderFooter}
            />
          </View>
        ) : null,
      )}
      {!groups.some((group) => group.items.length > 0) && (
        <Text style={styles.empty}>
          还没有 Agent。新建一个，设置提示词并绑定技能即可开始对话。
        </Text>
      )}
    </View>
  );
}

/** 列数阈值与间距：≥880px 三列，≥560px 两列，否则单列。 */
const CARD_GAP = 16;

function AgentGrid({
  items,
  renderLink,
  renderIcon,
  renderFooter,
}: {
  items: AgentCardItem[];
  renderLink: (link: AgentListLink, content: ReactNode) => ReactNode;
  renderIcon?: (name?: string | null) => ReactNode;
  renderFooter?: (item: AgentCardItem) => ReactNode;
}) {
  const [containerWidth, setContainerWidth] = useState(0);
  const columns = containerWidth >= 880 ? 3 : containerWidth >= 560 ? 2 : 1;
  // 单列也必须显式占满整行，否则卡片按内容宽度（max-content）撑开导致横向溢出。
  const cardWidth =
    containerWidth > 0
      ? (containerWidth - CARD_GAP * (columns - 1)) / columns
      : undefined;
  return (
    <View
      style={styles.grid}
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
    >
      {items.map((agent) => (
        <View
          key={agent.id}
          style={[styles.card, cardWidth != null && { width: cardWidth }]}
        >
          <View style={styles.cardHeader}>
            <View style={styles.nameRow}>
              <View style={styles.iconBadge}>{renderIcon?.(agent.icon)}</View>
              <Text style={styles.name}>{agent.name}</Text>
            </View>
            <Text style={styles.status}>
              {agent.status === "published" ? "已发布" : "草稿"}
            </Text>
          </View>
          <Text style={styles.description}>{agent.description}</Text>
          <Text style={styles.meta}>
            {`${agent.skillCount ?? 0} 个技能${agent.ownerNote ?? ""}`}
          </Text>
          <View style={styles.actions}>
            {renderLink(
              { kind: "open", item: agent },
              <Text style={styles.openText}>开始对话 →</Text>,
            )}
            {agent.editable &&
              renderLink(
                { kind: "edit", item: agent },
                <Text style={styles.editText}>编辑</Text>,
              )}
          </View>
          {renderFooter && <View style={styles.footer}>{renderFooter(agent)}</View>}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { marginBottom: 40 },
  groupTitle: { fontSize: 18, fontWeight: "600", marginBottom: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: CARD_GAP },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e6e6e2",
    backgroundColor: "white",
    padding: 24,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: "#eef4ef",
    alignItems: "center",
    justifyContent: "center",
  },
  name: { fontSize: 18, fontWeight: "600", flexShrink: 1 },
  status: {
    fontSize: 12,
    backgroundColor: "#eef4ef",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    color: "#333",
  },
  description: {
    marginVertical: 16,
    fontSize: 14,
    lineHeight: 24,
    color: "#666",
    flexGrow: 1,
  },
  meta: { fontSize: 12, color: "#888", marginBottom: 20 },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  openText: { fontSize: 14, fontWeight: "600", color: "#087d61" },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e6e6e2", marginTop: 16, paddingTop: 12 },
  editText: { fontSize: 14, color: "#666" },
  empty: {
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    padding: 48,
    textAlign: "center",
    color: "#777",
  },
});
