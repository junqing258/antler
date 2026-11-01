import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { NativeConfig } from "../../lib/native-config";
import { createNativePlatform } from "../../lib/native-platform";
import { Toggle } from "../../components/ui/toggle";
import {
  getRagConfig,
  resetRagConfig,
  updateRagConfig,
  type RagConfig,
} from "../../lib/rag-config-service";

/** 知识库配置：读取、保存、恢复默认与外部管理页入口；语义对齐 Web 版。 */
export function KnowledgeSettings({
  config,
  getToken,
  onUnauthorized,
  isCurrent,
}: {
  config: NativeConfig;
  getToken: () => Promise<string>;
  onUnauthorized: () => void;
  isCurrent: () => boolean;
}) {
  const platform = useMemo(
    () => createNativePlatform(config, getToken, onUnauthorized, isCurrent),
    [config, getToken, onUnauthorized, isCurrent],
  );
  const [config_, setConfig] = useState<RagConfig>();
  const [ragUrl, setRagUrl] = useState("");
  const [ragKey, setRagKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [attempt, setAttempt] = useState(0);

  const apply = useCallback((next: RagConfig) => {
    setConfig(next);
    setRagUrl(next.ragUrl ?? "");
    setRagKey("");
    setClearKey(false);
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    void getRagConfig(platform)
      .then((next) => {
        if (alive) apply(next);
      })
      .catch((cause: unknown) => {
        if (alive)
          setError(
            cause instanceof Error ? cause.message : "无法读取知识库配置。",
          );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [platform, attempt, apply]);

  const save = async (reset = false) => {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const next = reset
        ? await resetRagConfig(platform)
        : await updateRagConfig(platform, {
            ragUrl: ragUrl.trim(),
            ...(clearKey || ragKey.trim()
              ? { ragKey: clearKey ? "" : ragKey.trim() }
              : {}),
          });
      apply(next);
      setStatus(reset ? "已恢复环境默认值。" : "知识库配置已保存，即时生效。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法保存知识库配置。");
    } finally {
      setSaving(false);
    }
  };

  // 后端已把 ragUrl 归一化为 HTTP/HTTPS origin；此处再次校验协议再外链。
  const canOpenRagUrl = Boolean(
    config_?.ragUrl && /^https?:\/\//i.test(config_.ragUrl),
  );
  const openRagUrl = () => {
    if (!config_?.ragUrl) return;
    void Linking.openURL(config_.ragUrl).catch(() =>
      setError("无法打开知识库页面，请在浏览器中访问服务地址。"),
    );
  };

  return (
    <ScrollView style={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={styles.sectionTitle}>知识库配置</Text>
      {loading && <Text role="status">正在读取配置…</Text>}
      <View
        pointerEvents={loading || saving || !config_ ? "none" : "auto"}
        style={styles.form}
      >
        <Text style={styles.label}>RAG 服务地址</Text>
        <TextInput
          accessibilityLabel="RAG 服务地址"
          value={ragUrl}
          onChangeText={setRagUrl}
          placeholder="https://rag.example.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={styles.input}
        />
        <Text style={styles.hint}>
          填写 HTTP 或 HTTPS 服务地址，例如 http://localhost:8001。
        </Text>
        <Text style={styles.label}>RAG API Key</Text>
        <TextInput
          accessibilityLabel="RAG API Key"
          value={ragKey}
          onChangeText={(value) => {
            setRagKey(value);
            setClearKey(false);
          }}
          secureTextEntry
          autoComplete="off"
          placeholder={
            clearKey
              ? "保存后清除密钥"
              : config_?.ragKeyConfigured
                ? "已配置，留空保留现有密钥"
                : "请输入 API Key"
          }
          style={styles.input}
        />
        <Text style={styles.hint}>
          {clearKey
            ? "保存后将清除现有密钥。"
            : config_?.ragKeyConfigured
              ? "密钥已配置；输入新密钥可替换，留空则保留。"
              : "尚未配置密钥。"}
        </Text>
        {!!config_?.ragKeyConfigured && (
          <Toggle
            value={clearKey}
            onChange={(value) => {
              setClearKey(value);
              setRagKey("");
            }}
            label={clearKey ? "取消清除密钥" : "清除密钥"}
          />
        )}
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="恢复环境默认值"
            disabled={!config_?.ragConfigOverridden || saving}
            onPress={() => void save(true)}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>恢复环境默认值</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="保存知识库配置"
            disabled={loading || saving || !config_}
            onPress={() => void save()}
            style={styles.primary}
          >
            <Text style={styles.primaryText}>
              {saving ? "保存中…" : "保存配置"}
            </Text>
          </Pressable>
        </View>
      </View>
      {!!error && <Text role="alert" style={styles.danger}>{error}</Text>}
      {!loading && !config_ && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="重试读取知识库配置"
          onPress={() => setAttempt((value) => value + 1)}
          style={styles.secondary}
        >
          <Text style={styles.secondaryText}>重试</Text>
        </Pressable>
      )}
      {!!status && <Text role="status" style={styles.status}>{status}</Text>}
      {canOpenRagUrl && (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="打开知识库管理页面"
          onPress={openRagUrl}
        >
          <Text style={styles.link}>打开知识库管理页面 ↗</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: "#222" },
  form: { gap: 6 },
  label: { fontSize: 13, fontWeight: "600", color: "#4b4b4b", marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    minHeight: 44,
    fontSize: 14,
    color: "#222",
  },
  hint: { fontSize: 12, color: "#777" },
  danger: { fontSize: 13, color: "#b42318" },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  primary: {
    backgroundColor: "#087d61",
    borderRadius: 8,
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "white", fontSize: 14, fontWeight: "600" },
  secondary: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    marginTop: 8,
  },
  secondaryText: { color: "#4b4b4b", fontSize: 14 },
  status: { fontSize: 13, color: "#087d61" },
  link: { fontSize: 14, color: "#087d61", marginTop: 8 },
});
