import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
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
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Antler</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="直接开始对话"
        style={styles.primaryButton}
        onPress={() => onOpenAgent(undefined)}
      >
        <Text style={styles.primaryText}>直接开始对话</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="打开设置"
        onPress={onOpenSettings}
      >
        <Text style={styles.link}>设置</Text>
      </Pressable>
      {!!error && (
        <>
          <Text accessibilityRole="alert">{error}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setAttempt((n) => n + 1)}
          >
            <Text style={styles.link}>重试</Text>
          </Pressable>
        </>
      )}
      {!ready && (
        <Text accessibilityRole="status">正在加载 Agent 和历史会话…</Text>
      )}
      <Text style={styles.section}>历史会话</Text>
      {ready && !error && conversations.length === 0 && (
        <Text>暂无历史会话</Text>
      )}
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
        <Pressable
          accessibilityRole="button"
          disabled={loadingMore}
          onPress={() => void loadMore()}
        >
          <Text style={styles.link}>
            {loadingMore ? "加载中…" : "加载更多历史"}
          </Text>
        </Pressable>
      )}
      {ready && (
        <AgentList
          groups={[
            {
              name: "我的 Agent",
              items: agents.filter((a) => a.editable).map(toCard),
            },
            {
              name: "已发布 Agent",
              items: agents.filter((a) => !a.editable).map(toCard),
            },
          ]}
          renderLink={(link, content) => (
            <Pressable onPress={() => onOpenAgent(link.item.id)}>
              {content}
            </Pressable>
          )}
          renderIcon={(name) => (
            <Text style={styles.icon}>
              {name ? String(name).slice(0, 1) : "A"}
            </Text>
          )}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#fafaf9" },
  content: { padding: 16, paddingTop: 56, gap: 12 },
  title: { fontSize: 24, fontWeight: "700", color: "#222" },
  primaryButton: {
    backgroundColor: "#087d61",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryText: { color: "white", fontSize: 15, fontWeight: "600" },
  link: { color: "#087d61", fontSize: 13, alignSelf: "center" },
  section: { fontSize: 16, fontWeight: "600", marginTop: 10 },
  history: {
    padding: 12,
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 8,
  },
  icon: { fontSize: 16, color: "#087d61", fontWeight: "600" },
});
