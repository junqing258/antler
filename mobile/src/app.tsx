import { useEffect, useState } from "react";
import { fetch as expoFetch } from "expo/fetch";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Probe } from "./probe";
import { NativeChatProbe } from "./native-chat";
import { HomePage } from "./home-page";

/**
 * P5 导航：主页（共享 AgentList）⇄ 聊天/配置（NativeChatProbe）。
 * 状态驱动导航（Expo Router 因 SDK 58 版本矩阵运行时不兼容暂缓，见验证记录）。
 * autostart 深链由本层统一收集并经 prop 传入聊天视图。
 */
export function App() {
  const [view, setView] = useState<"home" | "chat">("home");
  const [agentId, setAgentId] = useState<string | undefined>(undefined);
  const [showStream, setShowStream] = useState(false);
  const [autostartUrl, setAutostartUrl] = useState<string | null>(null);
  useEffect(() => {
    const handler = (url: string | null) => {
      if (url?.includes("autostart")) {
        setAutostartUrl(url);
        setView("chat");
      }
    };
    void Linking.getInitialURL()
      .then((value) => handler(value ?? null))
      .catch(() => {});
    const subscription = Linking.addEventListener("url", ({ url }) =>
      handler(url),
    );
    return () => subscription.remove();
  }, []);
  if (view === "home")
    return (
      <View style={styles.flex}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowStream((value) => !value)}
          style={{ padding: 12, paddingTop: 48, alignItems: "flex-end" }}
        >
          <Text style={styles.debugLink}>
            {showStream ? "打开聊天验证" : "打开流式诊断"}
          </Text>
        </Pressable>
        {showStream ? (
          <Probe streamFetch={expoFetch} />
        ) : (
          <HomePage
            onOpenAgent={(id) => {
              setAgentId(id);
              setView("chat");
            }}
            onOpenSettings={() => {
              setAgentId(undefined);
              setView("chat");
            }}
          />
        )}
      </View>
    );
  return (
    <View style={styles.flex}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="返回主页"
        onPress={() => setView("home")}
        style={{ paddingTop: 48, paddingHorizontal: 12 }}
      >
        <Text style={styles.back}>← 主页</Text>
      </Pressable>
      <NativeChatProbe
        initialAgentId={agentId}
        autostartUrl={view === "chat" ? autostartUrl : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  back: { color: "#087d61", fontSize: 15, fontWeight: "600" },
  debugLink: { color: "#999", fontSize: 12 },
});
