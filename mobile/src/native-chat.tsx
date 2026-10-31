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
import * as Clipboard from "expo-clipboard";
import { ChatScreen } from "@antler/ui";
import {
  ChatSession,
  createHttpSessionDependencies,
  getBoundCredential,
  type BoundCredential,
} from "@antler/client-runtime";
import { defaultNativeConfig, parseProviderModels, type NativeConfig, validateServerUrl } from "./native-config";
import { loadNativeConfig, saveNativeConfig } from "./native-storage";
import { createNativePlatform } from "./native-platform";
import {
  currentAccessToken,
  loadAuthBackendConfig,
  signIn,
  signOut,
  type AuthBackendConfig,
} from "./native-auth";

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
  onModelSelected,
  autoMessage = "",
  cancelAfter = 0,
}: {
  config: NativeConfig;
  onConfigure: (binding?: BoundCredential) => void;
  onModelSelected: (model: string, startNewConversation: boolean) => void;
  autoMessage?: string;
  cancelAfter?: number;
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
  const boundModel = getBoundCredential(state.executionConfig)?.model;
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
  // P0 自动化验证：深链携带 message 时，会话就绪后自动发送一次以验证流式 SSE。
  const autoSentRef = useRef(false);
  useEffect(() => {
    if (!autoMessage || autoSentRef.current) return;
    const current = session.getSnapshot();
    if (!current.ready || current.running || current.sending) return;
    autoSentRef.current = true;
    pendingDraft.current = autoMessage;
    void session.send(autoMessage).finally(() => {
      if (!session.getSnapshot().running) pendingDraft.current = null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoMessage, state.ready, state.running, state.sending]);
  // P0 自动化验证：cancelAfter>0 时在运行开始后定时请求停止，验证取消链路。
  const cancelScheduledRef = useRef(false);
  useEffect(() => {
    if (!cancelAfter || cancelScheduledRef.current || !state.running) return;
    cancelScheduledRef.current = true;
    const timer = setTimeout(() => void session.cancel().catch(() => {}), cancelAfter);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelAfter, state.running]);
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
      <ChatScreen
        messages={state.messages}
        ready={state.ready}
        running={state.running}
        sending={state.sending}
        hasMore={state.hasMore}
        notice={state.notice}
        operationError={operationError}
        contextReason={state.contextReason}
        credentialProblem={problem}
        draft={draft}
        onDraftChange={setDraft}
        onSend={send}
        onStop={() => {
          setOperationError("");
          void session
            .cancel()
            .catch(() => setOperationError("停止请求失败，请重试。"));
        }}
        onLoadEarlier={() => {
          setOperationError("");
          void session
            .loadEarlier()
            .catch(() => setOperationError("无法加载更早消息，请重试。"));
        }}
        onCopy={(text) => {
          void Clipboard.setStringAsync(text).catch(() => {});
        }}
        onConfigureCredentials={() =>
          onConfigure(getBoundCredential(state.executionConfig))
        }
        model={boundModel ?? config.providerModel}
        models={parseProviderModels(config.providerModels)}
        onModelChange={(picked) => {
          if (picked === (boundModel ?? config.providerModel)) return;
          onModelSelected(picked, Boolean(boundModel));
        }}
      />
    </KeyboardAvoidingView>
  );
}
export function NativeChatProbe({
  initialAgentId,
  autostartUrl,
}: {
  initialAgentId?: string;
  autostartUrl?: string | null;
}) {
  const [config, setConfig] = useState<NativeConfig>(defaultNativeConfig);
  const [loading, setLoading] = useState(true);
  const [hydrationFailed, setHydrationFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState("");
  const [active, setActive] = useState<NativeConfig>();
  const [autoMessage, setAutoMessage] = useState("");
  const [cancelAfter, setCancelAfter] = useState(0);
  const [binding, setBinding] = useState<BoundCredential>();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [authBackend, setAuthBackend] = useState<AuthBackendConfig>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
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
  // P0 自动化验证钩子：经深链 com.antler.p0probe://autostart?serverUrl=...&
  // P0 自动化验证钩子：autostart 路由参数（serverUrl/accessToken/conversationId/
  // message/cancelAfter/email/password）预填并自动连接，正常启动不受影响。
  const autostartedRef = useRef(false);
  const autostart = async (url: string | null) => {
    if (autostartedRef.current || !url) return;
    let params: URL;
    try {
      params = new URL(url);
    } catch {
      return;
    }
    if (!params.host.endsWith("autostart")) return;
    autostartedRef.current = true;
    setAutoMessage(params.searchParams.get("message") ?? "");
    setCancelAfter(Number(params.searchParams.get("cancelAfter") ?? 0));
    const email = params.searchParams.get("email");
    if (email) {
      // P0 自动化验证：Supabase 登录流程（登录 → 会话令牌 → 连接）。
      try {
        const serverUrl = validateServerUrl(
          params.searchParams.get("serverUrl") ?? "",
          __DEV__,
        );
        const backend = await resolveAuthBackend(serverUrl);
        if (!backend.url || !backend.publishableKey)
          throw new Error("服务端未启用 Supabase 登录。");
        await signIn(
          backend.url,
          backend.publishableKey,
          email,
          params.searchParams.get("password") ?? "",
        );
        const token = await currentAccessToken(backend.url, backend.publishableKey);
        void connect({
          serverUrl,
          accessToken: token,
          conversationId: params.searchParams.get("conversationId") ?? "",
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "自动登录失败");
      }
      return;
    }
    void connect({
      serverUrl: params.searchParams.get("serverUrl") ?? "",
      accessToken: params.searchParams.get("accessToken") ?? "",
      conversationId: params.searchParams.get("conversationId") ?? "",
    });
  };
  useEffect(() => {
    void autostart(autostartUrl ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autostartUrl]);
  const resolveAuthBackend = async (serverUrl: string) => {
    const backend = await loadAuthBackendConfig(serverUrl);
    setAuthBackend(backend);
    return backend;
  };
  const login = async () => {
    if (authBusy) return;
    setAuthBusy(true);
    try {
      setError("");
      setAuthMessage("");
      const serverUrl = validateServerUrl(config.serverUrl, __DEV__);
      const backend = await resolveAuthBackend(serverUrl);
      if (backend.mode !== "supabase" || !backend.url || !backend.publishableKey)
        throw new Error("服务端未启用 Supabase 登录。");
      await signIn(backend.url, backend.publishableKey, email, password);
      const token = await currentAccessToken(backend.url, backend.publishableKey);
      setConfig((current) => ({ ...current, serverUrl, accessToken: token }));
      setPassword("");
      setAuthMessage("登录成功，可以连接会话。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "登录失败");
    } finally {
      setAuthBusy(false);
    }
  };
  const logout = async () => {
    if (authBackend?.url && authBackend.publishableKey)
      await signOut(authBackend.url, authBackend.publishableKey).catch(() => {});
    setConfig((current) => ({ ...current, accessToken: "" }));
    setAuthMessage("已退出登录。");
  };
  const connect = async (override?: Partial<NativeConfig>) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      setError("");
      const base = { ...config, ...override };
      const serverUrl = validateServerUrl(base.serverUrl, __DEV__);
      let token = base.accessToken.trim();
      if (base.authMode === "supabase") {
        const backend = await resolveAuthBackend(serverUrl);
        if (backend.mode !== "supabase" || !backend.url || !backend.publishableKey)
          throw new Error("服务端未启用 Supabase 登录，请改用本地令牌。");
        token = (await currentAccessToken(backend.url, backend.publishableKey)) || token;
        if (!token) throw new Error("请先登录后再连接。");
      }
      const next = {
        ...base,
        serverUrl,
        conversationId: base.conversationId.trim() || Crypto.randomUUID(),
        agentId: base.agentId.trim() || initialAgentId || "",
        accessToken: token,
        providerBaseUrl: base.providerBaseUrl.trim().replace(/\/+$/, ""),
        providerModel: base.providerModel.trim(),
        providerKey: base.providerKey.trim(),
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
          autoMessage={autoMessage}
          cancelAfter={cancelAfter}
          onConfigure={(value) => {
            setBinding(value);
            setActive(undefined);
          }}
          onModelSelected={(model, startNewConversation) => {
            const next: NativeConfig = {
              ...active,
              providerModel: model,
              conversationId: startNewConversation
                ? Crypto.randomUUID()
                : active.conversationId,
            };
            setConfig(next);
            setActive(next);
            void saveNativeConfig(next).catch(() => {});
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
          手动填写后端地址。此入口使用设备安全存储保存令牌与模型 Key。
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
        {config.authMode === "supabase" ? (
          <>
            <Text>
              通过服务端下发的 Supabase 配置登录；令牌由登录会话提供并自动刷新。
            </Text>
            <Field
              label="邮箱"
              value={email}
              onChange={setEmail}
            />
            <Field
              label="密码"
              value={password}
              onChange={setPassword}
              secure
            />
            <Action
              label={authBusy ? "登录中…" : "登录"}
              disabled={authBusy}
              onPress={() => {
                void login();
              }}
            />
            {!!authMessage && <Text accessibilityRole="status">{authMessage}</Text>}
            <Action
              label="退出登录"
              disabled={!config.accessToken}
              onPress={() => {
                void logout();
              }}
            />
          </>
        ) : (
          <Field
            label="访问令牌"
            value={config.accessToken}
            onChange={(v) => update("accessToken", v)}
            secure
          />
        )}
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
          label="模型列表（逗号分隔）"
          value={config.providerModels}
          onChange={(v) => update("providerModels", v)}
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
