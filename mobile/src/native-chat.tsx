import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Crypto from "expo-crypto";
import { Composer, MessageList } from "@antler/ui";
import {
  ChatSession,
  createHttpSessionDependencies,
  getBoundCredential,
  type BoundCredential,
} from "@antler/client-runtime";
import {
  defaultNativeConfig,
  type NativeConfig,
  validateServerUrl,
} from "./native-config";
import { loadNativeConfig, saveNativeConfig } from "./native-storage";
import { createNativePlatform } from "./native-platform";

type DraftKey = keyof NativeConfig;
function Field({
  label,
  value,
  onChange,
  secure = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  secure?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={styles.input}
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secure}
      />
    </View>
  );
}
function Action({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={[styles.button, disabled && styles.disabled]}
      onPress={onPress}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}
function ChatProbe({
  config,
  onConfigure,
}: {
  config: NativeConfig;
  onConfigure: (binding?: BoundCredential) => void;
}) {
  const platform = useMemo(() => createNativePlatform(config), [config]);
  const session = useMemo(
    () =>
      new ChatSession(
        {
          conversationId: config.conversationId,
          agentId: config.agentId || undefined,
          workingDirectory: "",
          initialMessages: [],
        },
        createHttpSessionDependencies(
          platform,
          () => ({
            apiKey: config.providerKey,
            protocol: config.providerProtocol,
            baseUrl: config.providerBaseUrl,
            model: config.providerModel,
          }),
          () => {},
        ),
      ),
    [config, platform],
  );
  const state = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const [draft, setDraft] = useState("");
  const pendingDraft = useRef<string | null>(null);
  const [operationError, setOperationError] = useState("");
  useEffect(() => {
    session.start();
    const stopForeground = platform.onForeground(() => {
      void session.refresh().catch(() => {});
    });
    return () => {
      stopForeground();
      session.stop();
    };
  }, [session, platform]);
  useEffect(() => {
    if (!state.running || pendingDraft.current === null) return;
    const submitted = pendingDraft.current;
    pendingDraft.current = null;
    setDraft((current) => (current === submitted ? "" : current));
  }, [state.running]);
  const problem = session.credentialProblem();
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const current = session.getSnapshot();
    if (
      !current.ready ||
      current.running ||
      current.sending ||
      current.contextReason ||
      session.credentialProblem()
    )
      return;
    pendingDraft.current = draft;
    void session.send(text).finally(() => {
      if (!session.getSnapshot().running) pendingDraft.current = null;
    });
  };
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.row}>
        <Text selectable style={styles.title}>
          会话：{config.conversationId}
        </Text>
        <Action
          label="配置"
          onPress={() => onConfigure(getBoundCredential(state.executionConfig))}
        />
      </View>
      {!!state.notice && <Text accessibilityRole="alert">{state.notice}</Text>}
      {!!operationError && (
        <Text accessibilityRole="alert">{operationError}</Text>
      )}
      {!!state.contextReason && (
        <Text accessibilityRole="alert">{state.contextReason}</Text>
      )}
      {!!problem && (
        <View style={styles.warning}>
          <Text>{problem}</Text>
          <Action
            label="配置凭据"
            onPress={() =>
              onConfigure(getBoundCredential(state.executionConfig))
            }
          />
        </View>
      )}
      {state.hasMore && (
        <Action
          label="加载更早消息"
          onPress={() => {
            setOperationError("");
            void session
              .loadEarlier()
              .catch(() => setOperationError("无法加载更早消息，请重试。"));
          }}
        />
      )}
      <MessageList
        messages={state.messages}
        ready={state.ready}
        onCopy={
          Platform.OS === "web"
            ? (text) => {
                void navigator.clipboard?.writeText(text).catch(() => {});
              }
            : undefined
        }
      />
      <Composer
        value={draft}
        onChange={setDraft}
        onSend={send}
        onStop={() => {
          setOperationError("");
          void session
            .cancel()
            .catch(() => setOperationError("停止请求失败，请重试。"));
        }}
        running={state.running}
        disabled={
          !state.ready ||
          state.sending ||
          Boolean(state.contextReason) ||
          Boolean(problem)
        }
      />
    </KeyboardAvoidingView>
  );
}
export function NativeChatProbe() {
  const [config, setConfig] = useState<NativeConfig>(defaultNativeConfig);
  const [loading, setLoading] = useState(true);
  const [hydrationFailed, setHydrationFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState("");
  const [active, setActive] = useState<NativeConfig>();
  const [binding, setBinding] = useState<BoundCredential>();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setHydrationFailed(false);
    setError("");
    void loadNativeConfig()
      .then((value) => {
        if (alive) setConfig(value);
      })
      .catch(() => {
        if (alive) {
          setHydrationFailed(true);
          setError("无法读取设备配置，请重试。");
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [loadAttempt]);
  const update = (key: DraftKey, value: string) =>
    setConfig((current) => ({ ...current, [key]: value }));
  const connect = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      setError("");
      const serverUrl = validateServerUrl(config.serverUrl, __DEV__);
      if (config.authMode === "supabase" && !config.accessToken.trim())
        throw new Error("请提供当前设备的登录访问令牌。");
      const next = {
        ...config,
        serverUrl,
        conversationId: config.conversationId.trim() || Crypto.randomUUID(),
        agentId: config.agentId.trim(),
        accessToken: config.accessToken.trim(),
        providerBaseUrl: config.providerBaseUrl.trim().replace(/\/+$/, ""),
        providerModel: config.providerModel.trim(),
        providerKey: config.providerKey.trim(),
      };
      await saveNativeConfig(next);
      setConfig(next);
      setActive(next);
      setBinding(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法保存配置");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  if (loading)
    return <ActivityIndicator accessibilityLabel="正在读取设备配置" />;
  if (hydrationFailed)
    return (
      <SafeAreaView style={styles.page}>
        <Text accessibilityRole="alert">{error}</Text>
        <Action
          label="重新读取配置"
          onPress={() => setLoadAttempt((value) => value + 1)}
        />
      </SafeAreaView>
    );
  if (active)
    return (
      <SafeAreaView style={styles.page}>
        <ChatProbe
          config={active}
          onConfigure={(value) => {
            setBinding(value);
            setActive(undefined);
          }}
        />
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={styles.page}>
      <ScrollView
        contentContainerStyle={styles.form}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>原生聊天验证</Text>
        <Text>
          手动填写后端地址和访问令牌。此验证入口不包含登录或令牌自动刷新。
        </Text>
        {Platform.OS === "web" && (
          <Text>
            Web 验证入口使用本地存储；原生设备的令牌与 API Key
            使用系统安全存储。
          </Text>
        )}
        {!!error && <Text accessibilityRole="alert">{error}</Text>}
        {binding && (
          <View style={styles.warning}>
            <Text>
              会话绑定：{binding.protocol} / {binding.baseUrl || "默认地址"} /{" "}
              {binding.model}
            </Text>
            <Text>
              请填写匹配的协议、地址与 API Key；继续时保留此会话和模型。
            </Text>
          </View>
        )}
        <Field
          label="后端地址"
          value={config.serverUrl}
          onChange={(v) =>
            setConfig((current) => ({
              ...current,
              serverUrl: v,
              accessToken: v === current.serverUrl ? current.accessToken : "",
            }))
          }
        />
        <Action
          label={`认证方式：${config.authMode === "local" ? "本地令牌" : "Supabase 访问令牌"}`}
          onPress={() =>
            setConfig((c) => ({
              ...c,
              authMode: c.authMode === "local" ? "supabase" : "local",
              accessToken: "",
            }))
          }
        />
        <Field
          label="访问令牌"
          value={config.accessToken}
          onChange={(v) => update("accessToken", v)}
          secure
        />
        <Field
          label="会话 ID（留空时创建）"
          value={config.conversationId}
          onChange={(v) => update("conversationId", v)}
        />
        <Action
          label="新建会话 ID"
          onPress={() => {
            setBinding(undefined);
            update("conversationId", Crypto.randomUUID());
          }}
        />
        <Field
          label="Agent ID（可选）"
          value={config.agentId}
          onChange={(v) => update("agentId", v)}
        />
        <Action
          label={`模型协议：${config.providerProtocol}`}
          onPress={() =>
            setConfig((c) => ({
              ...c,
              providerProtocol:
                c.providerProtocol === "openai-responses"
                  ? "anthropic-messages"
                  : "openai-responses",
              providerKey: "",
            }))
          }
        />
        <Field
          label="模型服务地址（可选）"
          value={config.providerBaseUrl}
          onChange={(v) =>
            setConfig((current) => ({
              ...current,
              providerBaseUrl: v,
              providerKey:
                v === current.providerBaseUrl ? current.providerKey : "",
            }))
          }
        />
        <Field
          label="模型 ID（可选）"
          value={config.providerModel}
          onChange={(v) => update("providerModel", v)}
        />
        <Field
          label="模型 API Key（可选）"
          value={config.providerKey}
          onChange={(v) => update("providerKey", v)}
          secure
        />
        <Action
          label="保存并进入会话"
          disabled={saving}
          onPress={() => {
            void connect();
          }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { flex: 1, padding: 16, backgroundColor: "#fff" },
  form: { gap: 12, paddingBottom: 32 },
  title: { fontSize: 18, fontWeight: "700", flexShrink: 1 },
  field: { gap: 5 },
  input: {
    borderWidth: 1,
    borderColor: "#aaa",
    borderRadius: 8,
    padding: 10,
    minHeight: 44,
  },
  button: {
    borderRadius: 8,
    backgroundColor: "#087d61",
    padding: 10,
    alignSelf: "flex-start",
  },
  buttonText: { color: "white", fontWeight: "600" },
  disabled: { opacity: 0.45 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginVertical: 8,
  },
  warning: { padding: 10, backgroundColor: "#fff5db", borderRadius: 8, gap: 6 },
});
