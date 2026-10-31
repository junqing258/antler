import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { AgentList, type AgentCardItem } from "@antler/ui";
import { loadNativeConfig } from "./native-storage";
import { createNativePlatform } from "./native-platform";
import type { NativeConfig } from "./native-config";

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
}: {
  onOpenAgent: (agentId?: string) => void;
  onOpenSettings: () => void;
}) {
  const [agents, setAgents] = useState<PlatformAgent[]>([]);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const config: NativeConfig = await loadNativeConfig();
        if (!config.serverUrl) throw new Error("尚未配置服务端地址。");
        const platform = createNativePlatform(config);
        const connection = await platform.connection();
        const response = await platform.request(
          `${connection.baseUrl}/api/agents`,
          { headers: connection.headers },
        );
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
  }, []);
  const toCard = (agent: PlatformAgent): AgentCardItem => ({
    id: agent.id,
    name: agent.name,
    description: agent.description ?? "",
    icon: agent.icon,
    status: agent.status ?? "draft",
    skillCount: agent._count?.skills ?? 0,
    editable: Boolean(agent.editable),
    ownerNote: !agent.builtin && agent.ownerId ? ` · 作者 ${agent.ownerId}` : "",
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
        accessibilityLabel="打开服务配置"
        onPress={onOpenSettings}
      >
        <Text style={styles.link}>服务与凭据配置</Text>
      </Pressable>
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
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
            <Pressable onPress={() => onOpenAgent(link.item.id)}>{content}</Pressable>
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
  icon: { fontSize: 16, color: "#087d61", fontWeight: "600" },
});
