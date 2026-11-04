import { useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type StreamFetch = (input: string, init: RequestInit) => Promise<Response>;

/** Temporary P0 diagnostic. Credentials stay in component memory only. */
export function Probe({ streamFetch }: { streamFetch: StreamFetch }) {
  const [baseUrl, setBaseUrl] = useState("");
  const [runId, setRunId] = useState("");
  const [token, setToken] = useState("");
  const [authMode, setAuthMode] = useState<"supabase" | "local">("supabase");
  const [cursor, setCursor] = useState("0");
  const [status, setStatus] = useState("未连接");
  const [output, setOutput] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );

  async function connect() {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setOutput("");
    try {
      const url = new URL(
        `${baseUrl.replace(/\/+$/, "")}/api/runs/${encodeURIComponent(runId)}/events`,
      );
      if (Platform.OS !== "web" && !__DEV__ && url.protocol !== "https:") {
        throw new Error("发布构建只允许 HTTPS");
      }
      url.searchParams.set("afterEventId", cursor || "0");
      setStatus("连接中");
      const response = await streamFetch(url.toString(), {
        headers: token
          ? authMode === "supabase"
            ? { Authorization: `Bearer ${token}` }
            : { "x-antler-token": token }
          : {},
        signal: controller.signal,
      });
      if (active.current !== controller) return;
      if (!response.ok || !response.body)
        throw new Error(`HTTP ${response.status}`);
      setStatus("已连接，等待数据");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (active.current !== controller) return;
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          setOutput((current) => current + chunk);
          setStatus("收到流式数据");
        }
        const tail = decoder.decode();
        if (tail) setOutput((current) => current + tail);
        if (!controller.signal.aborted) setStatus("流已结束");
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      if (active.current === controller)
        setStatus(
          controller.signal.aborted ? "已中止" : `连接失败：${String(error)}`,
        );
    } finally {
      if (active.current === controller) active.current = null;
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Antler P0 流式诊断</Text>
      <Text>
        输入 HTTPS 后端、Run ID 和当前设备的访问令牌。令牌只保留在本次页面内。
      </Text>
      <TextInput
        accessibilityLabel="服务地址"
        placeholder="https://example.com"
        autoCapitalize="none"
        value={baseUrl}
        onChangeText={setBaseUrl}
        style={styles.input}
      />
      <TextInput
        accessibilityLabel="Run ID"
        placeholder="Run ID"
        autoCapitalize="none"
        value={runId}
        onChangeText={setRunId}
        style={styles.input}
      />
      <TextInput
        accessibilityLabel="访问令牌"
        placeholder="访问令牌"
        secureTextEntry
        autoComplete="off"
        autoCorrect={false}
        autoCapitalize="none"
        value={token}
        onChangeText={setToken}
        style={styles.input}
      />
      <TextInput
        accessibilityLabel="事件游标"
        placeholder="事件游标"
        keyboardType="numeric"
        value={cursor}
        onChangeText={setCursor}
        style={styles.input}
      />
      <Pressable
        accessibilityRole="button"
        onPress={() =>
          setAuthMode((mode) => (mode === "supabase" ? "local" : "supabase"))
        }
      >
        <Text>
          鉴权方式：
          {authMode === "supabase" ? "Supabase Bearer" : "本地共享令牌"}
          （点击切换）
        </Text>
      </Pressable>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => void connect()}
          style={styles.button}
        >
          <Text style={styles.buttonText}>连接</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            active.current?.abort();
            setStatus("已中止");
          }}
          style={styles.button}
        >
          <Text style={styles.buttonText}>中止</Text>
        </Pressable>
      </View>
      <Text accessibilityRole="summary">状态：{status}</Text>
      <Text selectable style={styles.output}>
        {output || "尚无数据"}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: 24,
    paddingTop: 64,
    gap: 12,
    maxWidth: 720,
    width: "100%",
    alignSelf: "center",
  },
  title: { fontSize: 22, fontWeight: "700" },
  input: {
    borderWidth: 1,
    borderColor: "#aaa",
    borderRadius: 8,
    padding: 10,
    minHeight: 44,
  },
  actions: { flexDirection: "row", gap: 12 },
  button: { backgroundColor: "#087d61", borderRadius: 8, padding: 12 },
  buttonText: { color: "white", fontWeight: "600" },
  output: {
    fontFamily: "monospace",
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 12,
    minHeight: 120,
  },
});
