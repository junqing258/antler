import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AgentList, type AgentCardItem } from "@antler/ui";
import { createNativePlatform } from "../../lib/native-platform";
import type { NativeConfig } from "../../lib/native-config";

type PlatformAgent = {
  id: string;
  name: string;
  description?: string;
  icon?: string | null;
  status?: string;
  editable?: boolean;
  builtin?: boolean;
  ownerId?: string;
  _count?: { skills?: number };
};

/** 主页：共享 AgentList 组成的导航起点；经意图回调进入聊天。 */
export function HomePage({
  onOpenAgent,
  onOpenSettings,
  onOpenConversation,
  config,
  getToken,
  onUnauthorized,
  isCurrent,
}: {
  onOpenAgent: (agentId?: string) => void;
  onOpenSettings: () => void;
  onOpenConversation: (id: string, agentId?: string, title?: string) => void;
  config: NativeConfig;
  getToken: () => Promise<string>;
  onUnauthorized: () => void;
  isCurrent: () => boolean;
}) {
  const [conversations, setConversations] = useState<
    { id: string; title?: string; agentId?: string }[]
  >([]);
  const [attempt, setAttempt] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [agents, setAgents] = useState<PlatformAgent[]>([]);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    setReady(false);
    setError("");
    void (async () => {
      try {
        const platform = createNativePlatform(
          config,
          getToken,
          onUnauthorized,
          isCurrent,
        );
        const connection = await platform.connection();
        const response = await platform.request(
          `${connection.baseUrl}/api/agents`,
          { headers: connection.headers },
        );
        const historyResponse = await platform.request(
          `${connection.baseUrl}/api/conversations?limit=50`,
          { headers: connection.headers },
        );
        if (!historyResponse.ok) throw new Error("历史会话加载失败。");
        const history = (await historyResponse.json()) as {
          conversations?: { id: string; title?: string; agentId?: string }[];
          nextCursor?: string | null;
        };
        if (!Array.isArray(history.conversations))
          throw new Error("历史会话加载失败。");
        if (alive) {
          setConversations(history.conversations);
          setNextCursor(history.nextCursor ?? null);
        }
        const data = (await response.json()) as { agents?: PlatformAgent[] };
        if (alive && response.ok && Array.isArray(data.agents))
          setAgents(data.agents);
        else if (alive) setError("Agent 列表加载失败。");
      } catch (cause) {
        if (alive)
          setError(
            cause instanceof Error ? cause.message : "Agent 列表加载失败。",
          );
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [config, getToken, onUnauthorized, isCurrent, attempt]);
  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const platform = createNativePlatform(
        config,
        getToken,
        onUnauthorized,
        isCurrent,
      );
      const connection = await platform.connection();
      const response = await platform.request(
        `${connection.baseUrl}/api/conversations?limit=50&cursor=${encodeURIComponent(nextCursor)}`,
        { headers: connection.headers },
      );
      if (!response.ok) throw new Error();
      const page = (await response.json()) as {
        conversations?: typeof conversations;
        nextCursor?: string | null;
      };
      if (!Array.isArray(page.conversations)) throw new Error();
      setConversations((current) => [
        ...new Map(
          [...current, ...page.conversations!].map((row) => [row.id, row]),
        ).values(),
      ]);
      setNextCursor(page.nextCursor ?? null);
    } catch {
      setError("历史会话加载失败，请重试。");
    } finally {
      setLoadingMore(false);
    }
  };
  const toCard = (agent: PlatformAgent): AgentCardItem => ({
    id: agent.id,
    name: agent.name,
    description: agent.description ?? "",
    icon: agent.icon,
    status: agent.status ?? "draft",
    skillCount: agent._count?.skills ?? 0,
    editable: Boolean(agent.editable),
    ownerNote:
      !agent.builtin && agent.ownerId ? ` · 作者 ${agent.ownerId}` : "",
  });
  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Image source={require("../../../assets/antler-logo.png")} style={styles.logo} />
          <Text style={styles.brand}>Antler</Text>
        </View>
        <Text style={styles.navActive}>Agent</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="打开设置" onPress={onOpenSettings} style={styles.settings}>
          <Text style={styles.settingsIcon}>⚙</Text>
        </Pressable>
      </View>
      <View style={styles.body}>
        <View pointerEvents="none" style={styles.redShape} />
        <View pointerEvents="none" style={styles.blueShape} />
        <ScrollView contentContainerStyle={styles.content}>
          <Text accessibilityRole="header" style={styles.title}>选择你的 Agent</Text>
          <Text style={styles.subtitle}>选择专注于任务的 Agent，开始对话。</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="直接开始对话"
            style={styles.primaryButton}
            onPress={() => onOpenAgent(undefined)}
          >
            <Text style={styles.primaryText}>直接开始对话</Text>
          </Pressable>
          {!!error && (
            <View style={styles.error}>
              <Text accessibilityRole="alert">{error}</Text>
              <Pressable accessibilityRole="button" onPress={() => setAttempt((n) => n + 1)}>
                <Text style={styles.link}>重试</Text>
              </Pressable>
            </View>
          )}
          {!ready && <Text accessibilityRole="status">正在加载 Agent 和历史会话…</Text>}
          {ready && !error && (
            <AgentList
              groups={[
                { name: "我的 Agent", items: agents.filter((a) => a.editable).map(toCard) },
                { name: "已发布 Agent", items: agents.filter((a) => !a.editable).map(toCard) },
              ]}
              renderLink={(link, content) => link.kind === "open" ? (
                <Pressable accessibilityRole="button" onPress={() => onOpenAgent(link.item.id)}>{content}</Pressable>
              ) : null}
              renderIcon={() => (
                <View style={styles.bot}>
                  <View style={styles.botAntenna} />
                  <Text style={styles.botFace}>••</Text>
                </View>
              )}
            />
          )}
          <Text accessibilityRole="header" style={styles.section}>历史会话</Text>
          {ready && !error && conversations.length === 0 && <Text style={styles.historyEmpty}>暂无历史会话</Text>}
          {conversations.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              onPress={() => onOpenConversation(item.id, item.agentId, item.title || "新会话")}
              style={styles.history}
            >
              <Text numberOfLines={1}>{item.title || "新会话"}</Text>
            </Pressable>
          ))}
          {!!nextCursor && (
            <Pressable accessibilityRole="button" disabled={loadingMore} onPress={() => void loadMore()}>
              <Text style={styles.link}>{loadingMore ? "加载中…" : "加载更多历史"}</Text>
            </Pressable>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#fafaf9" },
  header: { backgroundColor: "white", borderBottomWidth: 1, borderBottomColor: "#e8e8e5", paddingHorizontal: 20, paddingVertical: 16, flexDirection: "row", alignItems: "center", gap: 20 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  logo: { width: 32, height: 32 },
  brand: { color: "#43a887", fontSize: 16, fontWeight: "700" },
  navActive: { fontSize: 14, color: "#222" },
  settings: { marginLeft: "auto", width: 32, height: 32, borderRadius: 16, backgroundColor: "#f3f4f4", alignItems: "center", justifyContent: "center" },
  settingsIcon: { fontSize: 20, color: "#777" },
  body: { flex: 1, overflow: "hidden" },
  content: { paddingHorizontal: 24, paddingTop: 40, paddingBottom: 32 },
  title: { fontSize: 30, fontWeight: "600", letterSpacing: -0.5, color: "#222", marginBottom: 32 },
  subtitle: { fontSize: 16, lineHeight: 24, color: "#666", marginBottom: 16 },
  primaryButton: { backgroundColor: "#43a887", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, alignSelf: "flex-start", marginBottom: 40 },
  primaryText: { color: "white", fontSize: 14 },
  link: { color: "#087d61", fontSize: 14 },
  error: { marginBottom: 16, gap: 8 },
  section: { fontSize: 18, fontWeight: "600", marginBottom: 16, color: "#222" },
  historyEmpty: { color: "#888" },
  history: { padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#e6e6e2", backgroundColor: "white", borderRadius: 12 },
  redShape: { position: "absolute", top: "20%", left: -10, width: 100, height: 100, borderRadius: 50, backgroundColor: "rgba(239,83,80,0.1)" },
  blueShape: { position: "absolute", top: "22%", right: -40, width: 100, height: 100, borderRadius: 16, backgroundColor: "rgba(66,133,244,0.1)", transform: [{ rotate: "45deg" }] },
  bot: { width: 21, height: 16, borderWidth: 2, borderColor: "#222", borderRadius: 4, alignItems: "center", justifyContent: "center" },
  botAntenna: { position: "absolute", top: -6, width: 6, height: 4, borderTopWidth: 2, borderRightWidth: 2, borderColor: "#222" },
  botFace: { color: "#222", fontSize: 12, lineHeight: 14, letterSpacing: 2 },
});
