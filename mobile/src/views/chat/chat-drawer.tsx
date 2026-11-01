import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { ConversationList } from "@antler/ui";
import type { NativeConfig } from "./native-config";
import { createNativePlatform } from "./native-platform";
import {
  deleteConversation,
  listConversations,
  renameConversation,
  subscribeConversationChanges,
  type ConversationSummary,
} from "./conversation-service";
import { ConfirmDialog, InputDialog } from "./dialogs";

const BRAND_COLOR = "#087d61";

/** 聊天页原生抽屉：品牌回首页、新建会话、按当前 Agent 的历史管理、账号与设置。 */
export function ChatDrawer({
  visible,
  activeId,
  agentId,
  config,
  getToken,
  onUnauthorized,
  isCurrent,
  email,
  onClose,
  onBackHome,
  onNewConversation,
  onSelectConversation,
  onActiveTitle,
  onActiveDeleted,
  onOpenSettings,
  onSignOut,
}: {
  visible: boolean;
  activeId: string;
  agentId?: string;
  config: NativeConfig;
  getToken: () => Promise<string>;
  onUnauthorized: () => void;
  isCurrent: () => boolean;
  email?: string;
  onClose: () => void;
  onBackHome: () => void;
  onNewConversation: () => void;
  onSelectConversation: (id: string, agentId?: string, title?: string) => void;
  onActiveTitle: (id: string, title: string) => void;
  onActiveDeleted: () => void;
  onOpenSettings: () => void;
  onSignOut?: () => void;
}) {
  const platform = useMemo(
    () => createNativePlatform(config, getToken, onUnauthorized, isCurrent),
    [config, getToken, onUnauthorized, isCurrent],
  );
  const [summaries, setSummaries] = useState<Map<string, ConversationSummary>>(
    () => new Map(),
  );
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [operationError, setOperationError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [renameTarget, setRenameTarget] = useState<ConversationSummary>();
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary>();
  const [busy, setBusy] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [changeCursor, setChangeCursor] = useState(-1);
  const tombstones = useRef(new Set<string>());
  const reportedTitle = useRef("");
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * 0.78, 320);
  const animation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      animation.setValue(0);
      return;
    }
    Animated.timing(animation, {
      toValue: 1,
      duration: 220,
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, [visible, animation]);

  // 打开时重新拉取首页，保证看到服务端最新状态（含其他端的改动）。
  useEffect(() => {
    if (!visible) {
      setError("");
      setOperationError("");
      return;
    }
    let alive = true;
    tombstones.current = new Set();
    reportedTitle.current = "";
    setLoading(true);
    setError("");
    void listConversations(platform, { agentId })
      .then((page) => {
        if (!alive) return;
        setSummaries(new Map(page.conversations.map((row) => [row.id, row])));
        setNextCursor(page.nextCursor);
        setChangeCursor(page.lastChangeId);
      })
      .catch((cause: unknown) => {
        if (alive)
          setError(
            cause instanceof Error ? cause.message : "会话列表加载失败，请重试。",
          );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [visible, platform, agentId, attempt]);

  // 打开期间订阅变更流：删除即时移除，其余刷新首页合并，避免分页重项。
  useEffect(() => {
    if (!visible || changeCursor < 0) return;
    return subscribeConversationChanges(
      platform,
      changeCursor,
      (change) => {
        if (change.type === "reset_required") {
          setChangeCursor(-1);
          setAttempt((value) => value + 1);
          return;
        }
        if (change.type === "deleted") {
          tombstones.current.add(change.conversationId);
          setSummaries((current) => {
            const next = new Map(current);
            next.delete(change.conversationId);
            return next;
          });
          return;
        }
        void listConversations(platform, { agentId })
          .then((page) => {
            setSummaries((current) => {
              const next = new Map(current);
              for (const row of page.conversations) {
                const existing = next.get(row.id);
                if (tombstones.current.has(row.id)) continue;
                if (!existing || (existing.revision ?? 0) <= (row.revision ?? 0))
                  next.set(row.id, row);
              }
              return next;
            });
            setNextCursor(page.nextCursor);
            setChangeCursor(page.lastChangeId);
          })
          .catch(() => {});
      },
      () => {},
    );
  }, [visible, platform, agentId, changeCursor]);

  const rows = useMemo(
    () =>
      [...summaries.values()].sort(
        (a, b) =>
          Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt) ||
          b.id.localeCompare(a.id),
      ),
    [summaries],
  );

  // 当前会话标题变化（重命名、服务端生成）时通知宿主更新标题栏。
  const active = summaries.get(activeId);
  useEffect(() => {
    if (!active || !visible) return;
    if (active.title === reportedTitle.current) return;
    reportedTitle.current = active.title;
    onActiveTitle(active.id, active.title);
  }, [active, visible, onActiveTitle]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    void listConversations(platform, { agentId, cursor: nextCursor })
      .then((page) => {
        setSummaries((current) => {
          const next = new Map(current);
          for (const row of page.conversations) {
            if (tombstones.current.has(row.id)) continue;
            const existing = next.get(row.id);
            if (!existing || (existing.revision ?? 0) <= (row.revision ?? 0))
              next.set(row.id, row);
          }
          return next;
        });
        setNextCursor(page.nextCursor);
      })
      .catch((cause: unknown) =>
        setOperationError(
          cause instanceof Error ? cause.message : "会话列表加载失败，请重试。",
        ),
      )
      .finally(() => setLoadingMore(false));
  }, [agentId, loadingMore, nextCursor, platform]);

  const submitRename = (title: string) => {
    if (!renameTarget) return;
    const target = renameTarget;
    setBusy(true);
    setOperationError("");
    void renameConversation(platform, target.id, title, target.revision ?? 0)
      .then((row) => {
        setSummaries((current) => {
          const next = new Map(current);
          next.set(row.id, {
            ...target,
            title: row.title,
            revision: row.revision ?? target.revision,
          });
          return next;
        });
        setRenameTarget(undefined);
      })
      .catch((cause: unknown) =>
        setOperationError(
          cause instanceof Error ? cause.message : "重命名失败，请重试。",
        ),
      )
      .finally(() => setBusy(false));
  };

  const submitDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setBusy(true);
    setOperationError("");
    void deleteConversation(platform, target.id)
      .then(() => {
        tombstones.current.add(target.id);
        setSummaries((current) => {
          const next = new Map(current);
          next.delete(target.id);
          return next;
        });
        setDeleteTarget(undefined);
        if (target.id === activeId) onActiveDeleted();
      })
      .catch((cause: unknown) =>
        setOperationError(
          cause instanceof Error ? cause.message : "删除失败，请重试。",
        ),
      )
      .finally(() => setBusy(false));
  };

  return (
    <>
      <Modal
        transparent
        visible={visible}
        animationType="none"
        onRequestClose={onClose}
      >
        <View style={styles.container}>
          <Animated.View
            style={[styles.backdrop, { opacity: animation }]}
            pointerEvents={visible ? "auto" : "none"}
          >
            <Pressable
              accessibilityLabel="关闭会话菜单"
              accessibilityRole="button"
              style={styles.backdropPress}
              onPress={onClose}
            />
          </Animated.View>
          <Animated.View
            accessibilityViewIsModal
            style={[
              styles.drawer,
              { width: drawerWidth },
              {
                transform: [
                  {
                    translateX: animation.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-drawerWidth, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <SafeAreaColumn>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="返回 Agent 首页"
                onPress={onBackHome}
                style={styles.brandButton}
              >
                <Text style={styles.brand}>Antler</Text>
              </Pressable>
              <View style={styles.divider} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="新建会话"
                onPress={onNewConversation}
                style={styles.newButton}
              >
                <Text style={styles.newText}>＋ 新建会话</Text>
              </Pressable>
              <View style={styles.divider} />
              <View style={styles.listArea}>
                {!!error && (
                  <View style={styles.status}>
                    <Text accessibilityRole="alert">{error}</Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setAttempt((value) => value + 1)}
                    >
                      <Text style={styles.link}>重试</Text>
                    </Pressable>
                  </View>
                )}
                {!error && loading && (
                  <Text style={styles.hint}>正在加载会话…</Text>
                )}
                {!error && !loading && (
                  <ScrollView keyboardShouldPersistTaps="handled">
                    <ConversationList
                      conversations={rows.map((row) => ({
                        id: row.id,
                        title: row.title || "新会话",
                      }))}
                      activeId={activeId}
                      onSelect={(id) => {
                        const row = summaries.get(id);
                        if (!row) return;
                        onSelectConversation(id, row.agentId, row.title);
                      }}
                      onRename={(item) => {
                        const row = summaries.get(item.id);
                        if (row) setRenameTarget(row);
                      }}
                      onDelete={(item) => {
                        const row = summaries.get(item.id);
                        if (row) setDeleteTarget(row);
                      }}
                    />
                    {!!nextCursor && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="加载更多会话"
                        disabled={loadingMore}
                        onPress={loadMore}
                        style={styles.loadMore}
                      >
                        <Text style={styles.link}>
                          {loadingMore ? "加载中…" : "加载更多会话"}
                        </Text>
                      </Pressable>
                    )}
                  </ScrollView>
                )}
              </View>
              {!!operationError && (
                <Text
                  accessibilityRole="alert"
                  style={styles.operationError}
                  numberOfLines={2}
                >
                  {operationError}
                </Text>
              )}
              <View style={styles.divider} />
              <View style={styles.account}>
                <View
                  accessibilityLabel={email ? `账号 ${email}` : "账号信息"}
                  style={styles.accountRow}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {email ? email.slice(0, 1).toUpperCase() : "·"}
                    </Text>
                  </View>
                  <Text numberOfLines={1} style={styles.email}>
                    {email || "本地模式"}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="打开设置"
                  onPress={onOpenSettings}
                  style={styles.accountAction}
                >
                  <Text style={styles.accountIcon}>⚙</Text>
                  <Text style={styles.accountText}>设置</Text>
                </Pressable>
                {onSignOut && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="退出登录"
                    onPress={() => setConfirmSignOut(true)}
                    style={styles.accountAction}
                  >
                    <Text style={styles.accountIcon}>↩</Text>
                    <Text style={styles.signOutText}>退出登录</Text>
                  </Pressable>
                )}
              </View>
            </SafeAreaColumn>
          </Animated.View>
        </View>
      </Modal>
      <InputDialog
        visible={Boolean(renameTarget)}
        title="重命名会话"
        initialValue={renameTarget?.title ?? ""}
        confirmLabel="重命名"
        busy={busy}
        onConfirm={submitRename}
        onCancel={() => {
          if (!busy) setRenameTarget(undefined);
        }}
      />
      <ConfirmDialog
        visible={Boolean(deleteTarget)}
        title="删除会话"
        message={`删除会话“${deleteTarget?.title || "新会话"}”？此操作无法撤销。`}
        busy={busy}
        onConfirm={submitDelete}
        onCancel={() => {
          if (!busy) setDeleteTarget(undefined);
        }}
      />
      <ConfirmDialog
        visible={confirmSignOut}
        title="退出登录"
        message="确定退出当前账号？"
        confirmLabel="退出"
        onConfirm={() => {
          setConfirmSignOut(false);
          onSignOut?.();
        }}
        onCancel={() => setConfirmSignOut(false)}
      />
    </>
  );
}

/** 抽屉占满高度：顶部/底部安全区域由各平台的 SafeAreaView 兜底。 */
function SafeAreaColumn({ children }: { children: React.ReactNode }) {
  return <SafeAreaView style={styles.safe}>{children}</SafeAreaView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: "row" },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  backdropPress: { flex: 1 },
  drawer: {
    backgroundColor: "#fbfbfa",
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 4, height: 0 },
  },
  safe: { flex: 1 },
  brandButton: { paddingHorizontal: 16, paddingVertical: 14, minHeight: 48 },
  brand: { fontSize: 20, fontWeight: "700", color: BRAND_COLOR },
  divider: { height: 1, backgroundColor: "#e7e5e0" },
  newButton: {
    marginHorizontal: 12,
    marginVertical: 10,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: "#efedea",
    alignItems: "center",
    justifyContent: "center",
  },
  newText: { fontSize: 15, fontWeight: "600", color: "#333" },
  listArea: { flex: 1, minHeight: 0 },
  status: { padding: 12, gap: 8 },
  hint: { padding: 12, color: "#888" },
  loadMore: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  link: { color: BRAND_COLOR, fontSize: 14 },
  operationError: { paddingHorizontal: 12, paddingVertical: 6, color: "#b3261e" },
  account: { paddingVertical: 8, gap: 2 },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#e2f0ec",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: BRAND_COLOR, fontWeight: "700" },
  email: { flex: 1, fontSize: 13, color: "#555" },
  accountAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 16,
  },
  accountIcon: { fontSize: 16, color: "#666", width: 20, textAlign: "center" },
  accountText: { fontSize: 14, color: "#333" },
  signOutText: { fontSize: 14, color: "#b3261e" },
});
