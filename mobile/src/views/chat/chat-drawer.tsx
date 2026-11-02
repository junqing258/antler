import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ConversationList } from "@antler/ui";
import { Plus, Settings } from "lucide-react-native";
import type { NativeConfig } from "../../lib/native-config";
import { createNativePlatform } from "../../lib/native-platform";
import {
  deleteConversation,
  listConversations,
  renameConversation,
  subscribeConversationChanges,
  type ConversationSummary,
} from "../../lib/conversation-service";
import { ConfirmDialog, InputDialog } from "../../components/dialogs";

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
  onOpenProfile,
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
  onOpenProfile: () => void;
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
  const [changeCursor, setChangeCursor] = useState(-1);
  const tombstones = useRef(new Set<string>());
  const reportedTitle = useRef("");
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * 0.78, 320);
  const animation = useRef(new Animated.Value(0)).current;

  const [modalVisible, setModalVisible] = useState(visible);
  const pendingAction = useRef<(() => void) | undefined>(undefined);
  const closing = useRef(false);

  useEffect(() => {
    if (visible) {
      closing.current = false;
      pendingAction.current = undefined;
      setModalVisible(true);
      const transition = Animated.timing(animation, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== "web",
      });
      transition.start();
      return () => transition.stop();
    }
    if (!modalVisible) return;
    const transition = Animated.timing(animation, {
      toValue: 0,
      duration: 220,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: Platform.OS !== "web",
    });
    transition.start(({ finished }) => {
      if (!finished) return;
      setModalVisible(false);
      closing.current = false;
      const action = pendingAction.current;
      pendingAction.current = undefined;
      action?.();
    });
    return () => transition.stop();
  }, [visible, modalVisible, animation]);

  const closeDrawer = (action?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    pendingAction.current = action;
    onClose();
  };

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
        visible={modalVisible}
        animationType="none"
        onRequestClose={() => closeDrawer()}
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
              onPress={() => closeDrawer()}
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
                onPress={() => closeDrawer(onBackHome)}
                style={styles.brandButton}
              >
                <Image source={require("../../../assets/antler-logo.png")} style={styles.logo} />
                <View style={styles.brandText}>
                  <Text style={styles.brand}>Antler Agent</Text>
                  <Text style={styles.version}>V0.1.0</Text>
                </View>
              </Pressable>
              <View style={styles.divider} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="新建会话"
                onPress={() => closeDrawer(onNewConversation)}
                style={styles.newButton}
              >
                <Plus size={16} color="#222" />
                <Text style={styles.newText}>新建会话</Text>
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
                        closeDrawer(() => onSelectConversation(id, row.agentId, row.title));
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
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="个人资料"
                  onPress={() => closeDrawer(onOpenProfile)}
                  style={styles.accountRow}
                >
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {email ? email.slice(0, 1).toUpperCase() : "U"}
                    </Text>
                  </View>
                  <View style={styles.accountDetails}>
                    <Text numberOfLines={1} style={styles.accountName}>
                      {email ? email.split("@")[0] : "本地模式"}
                    </Text>
                    {!!email && <Text numberOfLines={1} style={styles.email}>{email}</Text>}
                  </View>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="打开设置"
                  onPress={() => closeDrawer(onOpenSettings)}
                  style={styles.accountAction}
                >
                  <Settings size={18} color="#777" />
                </Pressable>
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
  brandButton: { paddingHorizontal: 16, minHeight: 76, flexDirection: "row", alignItems: "center", gap: 12 },
  logo: { width: 40, height: 40 },
  brandText: { gap: 2 },
  brand: { fontSize: 15, fontWeight: "700", color: BRAND_COLOR },
  version: { fontSize: 10, letterSpacing: 0.8, color: BRAND_COLOR },
  divider: { height: 1, backgroundColor: "#e7e5e0" },
  newButton: {
    marginHorizontal: 12,
    marginVertical: 10,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: "#efedea",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  newText: { fontSize: 13, color: "#222" },
  listArea: { flex: 1, minHeight: 0 },
  status: { padding: 12, gap: 8 },
  hint: { padding: 12, color: "#888" },
  loadMore: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  link: { color: BRAND_COLOR, fontSize: 14 },
  operationError: { paddingHorizontal: 12, paddingVertical: 6, color: "#b3261e" },
  account: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10 },
  accountRow: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#e8f3ef", alignItems: "center", justifyContent: "center" },
  avatarText: { color: BRAND_COLOR, fontWeight: "600", fontSize: 12 },
  accountDetails: { flex: 1, minWidth: 0 },
  accountName: { fontSize: 13, fontWeight: "600", color: "#252525" },
  email: { fontSize: 10, color: "#777" },
  accountAction: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});
