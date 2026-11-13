import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BackHandler,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Drawer } from "react-native-drawer-layout";
import { ConversationList } from "@antler/ui";
import { Pencil, Plus, Settings } from "lucide-react-native";
import type { NativeConfig } from "../../lib/native-config";
import { createNativePlatform } from "../../lib/native-platform";
import { useDelayedPending } from "../../lib/use-delayed-pending";
import { bundleVersion } from "../../lib/bundle-version";
import {
  deleteConversation,
  listConversations,
  renameConversation,
  subscribeConversationChanges,
  type ConversationSummary,
} from "../../lib/conversation-service";
import { ConfirmDialog, InputDialog } from "../../components/dialogs";

const BRAND_COLOR = "#087d61";

/** 聊天页抽屉：使用原生手势与 UI 线程动画管理会话、账号和设置。 */
export function ChatDrawer({
  visible,
  activeId,
  agentId,
  config,
  getToken,
  onUnauthorized,
  isCurrent,
  email,
  children,
  onOpen,
  onClose,
  onBackHome,
  onNewConversation,
  onSelectConversation,
  onActiveTitle,
  onActiveDeleted,
  onConversationDeleted,
  cachedConversations,
  onCacheConversations,
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
  children?: ReactNode;
  onOpen?: () => void;
  onClose: () => void;
  onBackHome: () => void;
  onNewConversation: () => void;
  onSelectConversation: (id: string, agentId?: string, title?: string) => void;
  onActiveTitle: (id: string, title: string) => void;
  onActiveDeleted: () => void;
  onConversationDeleted?: (id: string) => void;
  cachedConversations?: ConversationSummary[];
  onCacheConversations?: (rows: ConversationSummary[]) => void;
  onOpenSettings: () => void;
  onOpenProfile: () => void;
}) {
  const platform = useMemo(
    () => createNativePlatform(config, getToken, onUnauthorized, isCurrent),
    [config, getToken, onUnauthorized, isCurrent],
  );
  const [summaries, setSummaries] = useState<Map<string, ConversationSummary>>(
    () => new Map(cachedConversations?.map((row) => [row.id, row]) ?? []),
  );
  const cachedRef = useRef(cachedConversations);
  cachedRef.current = cachedConversations;
  const [cacheReady, setCacheReady] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const showLoading = useDelayedPending(visible && loading);
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
  const pendingAction = useRef<(() => void) | undefined>(undefined);
  const closing = useRef(false);

  const closeDrawer = (action?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    pendingAction.current = action;
    onClose();
  };

  // Drawer Layout does not own Android's hardware-back event as Modal did.
  useEffect(() => {
    if (!visible || Platform.OS !== "android") return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (busy) return true;
      if (deleteTarget) {
        setDeleteTarget(undefined);
        setOperationError("");
      } else if (renameTarget) {
        setRenameTarget(undefined);
        setOperationError("");
      } else {
        closeDrawer();
      }
      return true;
    });
    return () => listener.remove();
  }, [busy, deleteTarget, renameTarget, visible]);

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
    setCacheReady(false);
    setChangeCursor(-1);
    setNextCursor(null);
    if (cachedRef.current)
      setSummaries(new Map(cachedRef.current.map((row) => [row.id, row])));
    setLoading(true);
    setError("");
    void listConversations(platform, { agentId })
      .then((page) => {
        if (!alive) return;
        setSummaries(new Map(page.conversations.map((row) => [row.id, row])));
        setNextCursor(page.nextCursor);
        setChangeCursor(page.lastChangeId);
        setCacheReady(true);
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
          onConversationDeleted?.(change.conversationId);
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
  }, [visible, platform, agentId, changeCursor, onConversationDeleted]);

  const rows = useMemo(
    () =>
      [...summaries.values()].sort(
        (a, b) =>
          Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt) ||
          b.id.localeCompare(a.id),
      ),
    [summaries],
  );

  useEffect(() => {
    if (cacheReady && !loading) onCacheConversations?.(rows);
  }, [cacheReady, loading, rows, onCacheConversations]);

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
        onConversationDeleted?.(target.id);
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
      <Drawer
        open={visible}
        drawerType="front"
        drawerPosition="left"
        drawerStyle={[styles.drawer, { width: drawerWidth }]}
        overlayStyle={styles.backdrop}
        overlayAccessibilityLabel="关闭会话菜单"
        onOpen={onOpen ?? (() => {})}
        onClose={() => {
          if (busy) return;
          if (deleteTarget) { setDeleteTarget(undefined); setOperationError(""); }
          else if (renameTarget) { setRenameTarget(undefined); setOperationError(""); }
          else onClose();
        }}
        onTransitionEnd={(isClosing) => {
          if (!isClosing) return;
          closing.current = false;
          const action = pendingAction.current;
          pendingAction.current = undefined;
          action?.();
        }}
        renderDrawerContent={() => (
          <SafeAreaColumn>
            <View style={styles.brandHeader}>
              <Pressable
              accessibilityRole="button"
              accessibilityLabel="返回 Agent 首页"
              onPress={() => closeDrawer(onBackHome)}
              style={styles.brandButton}
              >
                <View style={styles.logoBadge}>
                  <Image source={require("../../../assets/antler-logo.png")} style={styles.logo} />
                </View>
                <View style={styles.brandText}>
                  <Text style={styles.brand}>Antler Agent</Text>
                  <Text style={styles.version}>V{bundleVersion} · YOUR AI WORKSPACE</Text>
                </View>
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="新建会话"
              onPress={() => closeDrawer(onNewConversation)}
              style={styles.newButton}
            >
              <Plus size={17} color="#fff" />
              <Text style={styles.newText}>新建会话</Text>
            </Pressable>
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
              {showLoading && rows.length === 0 && (
                <Text style={styles.hint}>正在加载会话…</Text>
              )}
              {(rows.length > 0 || (!error && !loading)) && (
                <ScrollView keyboardShouldPersistTaps="handled">
                  <ConversationList
                    renameIcon={<Pencil size={17} color="#777" strokeWidth={1.8} />}
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
                      if (row) { setOperationError(""); setRenameTarget(row); }
                    }}
                    onDelete={(item) => {
                      const row = summaries.get(item.id);
                      if (row) { setOperationError(""); setDeleteTarget(row); }
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
            {!!operationError && !deleteTarget && !renameTarget && (
              <Text
                accessibilityRole="alert"
                style={styles.operationError}
                numberOfLines={2}
              >
                {operationError}
              </Text>
            )}
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
                <Settings size={18} color={BRAND_COLOR} />
              </Pressable>
            </View>
          </SafeAreaColumn>
        )}
      >
        {children ?? <View style={styles.content} />}
      </Drawer>
      <InputDialog
        visible={Boolean(renameTarget)}
        title="重命名会话"
        initialValue={renameTarget?.title ?? ""}
        confirmLabel="重命名"
        busy={busy}
        error={operationError}
        onConfirm={submitRename}
        onCancel={() => {
          if (!busy) { setRenameTarget(undefined); setOperationError(""); }
        }}
      />
      <ConfirmDialog
        visible={Boolean(deleteTarget)}
        title="删除会话"
        message={`删除会话“${deleteTarget?.title || "新会话"}”？此操作无法撤销。`}
        busy={busy}
        error={operationError}
        onConfirm={submitDelete}
        onCancel={() => {
          if (!busy) { setDeleteTarget(undefined); setOperationError(""); }
        }}
      />
    </>
  );
}

/** Keep the panel surface full-screen while its controls respect device cutouts. */
function SafeAreaColumn({ children }: { children: ReactNode }) {
  return <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>{children}</SafeAreaView>;
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  backdrop: { backgroundColor: "rgba(0,0,0,0.35)" },
  drawer: {
    backgroundColor: "#ffffff",
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 4, height: 0 },
  },
  safe: { flex: 1 },
  brandHeader: { paddingHorizontal: 12, paddingTop: 14, paddingBottom: 10 },
  brandButton: { minHeight: 72, paddingHorizontal: 12, borderRadius: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  logoBadge: { width: 44, height: 44, borderRadius: 14, backgroundColor: "#dff3eb", alignItems: "center", justifyContent: "center" },
  logo: { width: 30, height: 30 },
  brandText: { gap: 3 },
  brand: { fontSize: 17, fontWeight: "700", color: BRAND_COLOR },
  version: { fontSize: 9, fontWeight: "700", letterSpacing: 1.1, color: "#4e8f7c" },
  newButton: {
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 10,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: BRAND_COLOR,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  newText: { fontSize: 14, fontWeight: "600", color: "#fff" },
  listArea: { flex: 1, minHeight: 0, paddingTop: 2 },
  status: { padding: 12, gap: 8 },
  hint: { padding: 12, color: "#888" },
  loadMore: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  link: { color: BRAND_COLOR, fontSize: 14 },
  operationError: { paddingHorizontal: 12, paddingVertical: 6, color: "#b3261e" },
  account: { flexDirection: "row", alignItems: "center", margin: 12, padding: 10, borderRadius: 16, backgroundColor: "#f3f8f6" },
  accountRow: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10, minHeight: 46 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#dff3eb", alignItems: "center", justifyContent: "center" },
  avatarText: { color: BRAND_COLOR, fontWeight: "600", fontSize: 12 },
  accountDetails: { flex: 1, minWidth: 0 },
  accountName: { fontSize: 14, fontWeight: "700", color: "#252525" },
  email: { fontSize: 11, color: "#6f7a76" },
  accountAction: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
});
