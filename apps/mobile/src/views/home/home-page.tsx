import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Bot, ChevronRight, Settings } from "lucide-react-native";
import { AgentList, type AgentCardItem } from "@antler/ui";
import { createNativePlatform } from "../../lib/native-platform";
import type { NativeConfig } from "../../lib/native-config";
import { useDelayedPending } from "../../lib/use-delayed-pending";

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
  recentConversation?: { id: string; title: string; lastMessageAt: string } | null;
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
  onOpenConversation: (id: string, agentId: string, title: string) => void;
  config: NativeConfig;
  getToken: () => Promise<string>;
  onUnauthorized: () => void;
  isCurrent: () => boolean;
}) {
  const agentsQuery = useQuery({
    queryKey: ["agents"],
    queryFn: async ({ signal }) => {
      const platform = createNativePlatform(config, getToken, onUnauthorized, isCurrent);
      const connection = await platform.connection();
      const response = await platform.request(`${connection.baseUrl}/api/agents?includeRecentConversation=1`, {
        headers: connection.headers,
        signal,
      });
      if (!response.ok) throw new Error("Agent 列表加载失败。");
      const data = (await response.json()) as { agents?: PlatformAgent[] };
      if (!Array.isArray(data.agents)) throw new Error("Agent 列表加载失败。");
      return data.agents;
    },
  });
  useFocusEffect(useCallback(() => {
    void agentsQuery.refetch();
  }, [agentsQuery.refetch]));
  const agents = agentsQuery.data ?? [];
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const showAgentsLoading = useDelayedPending(agentsQuery.isPending);
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
      <SafeAreaView style={styles.headerSafeArea} edges={["top"]}>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <Image source={require("../../../assets/antler-logo.png")} style={styles.logo} />
            <Text style={styles.brand}>Antler</Text>
          </View>
          <Text style={styles.navActive}>Agent</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="打开设置" onPress={onOpenSettings} style={styles.settings}>
            <Settings size={18} color="#777" />
          </Pressable>
        </View>
      </SafeAreaView>
      <SafeAreaView style={styles.bodySafeArea} edges={["bottom"]}>
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
          {showAgentsLoading && <Text>正在加载 Agent…</Text>}
          {agentsQuery.isError && (
            <View style={styles.error}>
              <Text accessibilityRole="alert">Agent 列表加载失败。</Text>
              <Pressable accessibilityRole="button" onPress={() => void agentsQuery.refetch()}>
                <Text style={styles.link}>重试</Text>
              </Pressable>
            </View>
          )}
          {agentsQuery.data && (
            <AgentList
              groups={[
                { name: "我的 Agent", items: agents.filter((a) => a.editable).map(toCard) },
                { name: "已发布 Agent", items: agents.filter((a) => !a.editable).map(toCard) },
              ]}
              renderLink={(link, content) => link.kind === "open" ? (
                <Pressable accessibilityRole="button" onPress={() => onOpenAgent(link.item.id)}>{content}</Pressable>
              ) : null}
              renderIcon={() => (
                <Bot size={24} color="#222" />
              )}
              renderFooter={(agent) => {
                const recent = agentsById.get(agent.id)?.recentConversation;
                return recent ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`继续与${agent.name}的最近对话：${recent.title || "新会话"}`}
                    onPress={() => onOpenConversation(recent.id, agent.id, recent.title || "新会话")}
                    style={styles.recentRow}
                  >
                    <View style={styles.recentContent}>
                      <Text style={styles.recentLabel}>最近对话</Text>
                      <Text numberOfLines={1} style={styles.recentTitle}>{recent.title || "新会话"}</Text>
                    </View>
                    <ChevronRight size={16} color="#777" />
                  </Pressable>
                ) : (
                  <View style={styles.recentRow}>
                    <Text style={styles.recentLabel}>最近对话</Text>
                    <Text style={styles.recentEmpty}>暂无对话</Text>
                  </View>
                );
              }}
            />
          )}
          </ScrollView>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#fafaf9" },
  headerSafeArea: { backgroundColor: "#fff" },
  header: { backgroundColor: "white", borderBottomWidth: 1, borderBottomColor: "#e8e8e5", paddingHorizontal: 20, paddingVertical: 16, flexDirection: "row", alignItems: "center", gap: 20 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  logo: { width: 32, height: 32 },
  brand: { color: "#43a887", fontSize: 16, fontWeight: "700" },
  navActive: { fontSize: 14, color: "#222" },
  settings: { marginLeft: "auto", width: 32, height: 32, borderRadius: 16, backgroundColor: "#f3f4f4", alignItems: "center", justifyContent: "center" },
  bodySafeArea: { flex: 1, backgroundColor: "#fafaf9" },
  body: { flex: 1, overflow: "hidden" },
  content: { paddingHorizontal: 24, paddingTop: 40, paddingBottom: 32 },
  title: { fontSize: 30, fontWeight: "600", letterSpacing: -0.5, color: "#222", marginBottom: 32 },
  subtitle: { fontSize: 16, lineHeight: 24, color: "#666", marginBottom: 16 },
  primaryButton: { backgroundColor: "#43a887", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, alignSelf: "flex-start", marginBottom: 40 },
  primaryText: { color: "white", fontSize: 14 },
  link: { color: "#087d61", fontSize: 14 },
  error: { marginBottom: 16, gap: 8 },
  recentRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 },
  recentContent: { flex: 1, minWidth: 0 },
  recentLabel: { fontSize: 12, color: "#888" },
  recentTitle: { fontSize: 14, color: "#333", marginTop: 4 },
  recentEmpty: { fontSize: 12, color: "#999" },
  redShape: { position: "absolute", top: "20%", left: -10, width: 100, height: 100, borderRadius: 50, backgroundColor: "rgba(239,83,80,0.1)" },
  blueShape: { position: "absolute", top: "22%", right: -40, width: 100, height: 100, borderRadius: 16, backgroundColor: "rgba(66,133,244,0.1)", transform: [{ rotate: "45deg" }] },
});
