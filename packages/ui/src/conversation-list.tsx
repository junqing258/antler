import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export type ConversationItem = { id: string; title: string };

export function ConversationList({
  conversations,
  activeId,
  onSelect,
  onRename,
  renameIcon,
  onDelete,
  label = "会话历史",
  emptyText = "暂无会话",
  onLoadMore,
}: {
  conversations: ConversationItem[];
  activeId?: string;
  onSelect: (id: string) => void;
  onRename?: (item: ConversationItem) => void;
  renameIcon?: ReactNode;
  onDelete?: (item: ConversationItem) => void;
  label?: string;
  emptyText?: string;
  onLoadMore?: () => void;
}) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      {conversations.length === 0 && (
        <Text style={styles.empty}>{emptyText}</Text>
      )}
      {onLoadMore && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="加载更多会话"
          onPress={onLoadMore}
          style={styles.loadMore}
        >
          <Text>加载更多会话</Text>
        </Pressable>
      )}
      {conversations.map((conversation) => (
        <View key={conversation.id} style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={conversation.title}
            accessibilityState={{
              selected: conversation.id === activeId,
            }}
            onPress={() => onSelect(conversation.id)}
            style={styles.titleButton}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.title,
                conversation.id === activeId && styles.active,
              ]}
            >
              {conversation.title}
            </Text>
          </Pressable>
          {(onRename || onDelete) && (
            <View style={styles.actions}>
              {onRename && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`重命名 ${conversation.title}`}
                  onPress={() => onRename(conversation)}
                  style={styles.action}
                >
                  {renameIcon ?? <Text style={styles.actionText}>✎</Text>}
                </Pressable>
              )}
              {onDelete && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`删除 ${conversation.title}`}
                  onPress={() => onDelete(conversation)}
                  style={styles.action}
                >
                  <Text style={styles.actionText}>✕</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, color: "#858585", paddingHorizontal: 12, paddingVertical: 6 },
  empty: { fontSize: 12, color: "#999", paddingHorizontal: 12, paddingVertical: 6 },
  loadMore: { paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", borderRadius: 8 },
  titleButton: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: "center", paddingHorizontal: 10, paddingVertical: 10 },
  title: { fontSize: 13, lineHeight: 24, color: "#222" },
  active: { fontWeight: "600" },
  actions: { flexDirection: "row", gap: 2, paddingRight: 4 },
  action: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  actionText: { fontSize: 14, color: "#777" },
});
