import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactElement,
} from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewProps,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import { Menu } from "lucide-react-native";
import { ChatKeyboardAvoidingView } from "./chat-keyboard-avoiding-view";
import { ChatScreen, type ProviderConfigDraft } from "@antler/ui";
import {
  ChatSession,
  createHttpSessionDependencies,
  getBoundCredential,
  getModelPickerConfig,
  type BoundCredential,
} from "@antler/client-runtime";
import type { NativeConfig } from "../../lib/native-config";
import type { ChatMessage } from "@antler/chat-core";
import { createNativePlatform } from "../../lib/native-platform";

// The library’s class declaration targets older React Native types.
const GradientMask = MaskedView as unknown as ComponentType<ViewProps & { maskElement: ReactElement }>;


export function NativeChat({
  config,
  provider,
  onConfigure,
  onModelSelected,
  getToken,
  onUnauthorized,
  isCurrent,
  autoMessage = "",
  cancelAfter = 0,
  title = "",
  onOpenDrawer,
  cachedMessages,
  onCacheMessages,
}: {
  config: NativeConfig;
  provider: ProviderConfigDraft;
  onConfigure: (binding?: BoundCredential) => void;
  onModelSelected: (model: string, startNewConversation: boolean) => void;
  getToken: () => Promise<string>;
  onUnauthorized: () => void;
  isCurrent?: () => boolean;
  autoMessage?: string;
  cancelAfter?: number;
  title?: string;
  onOpenDrawer?: () => void;
  cachedMessages?: ChatMessage[];
  onCacheMessages?: (messages: ChatMessage[], hasMore: boolean) => void;
}) {
  const providerRef = useRef(provider);
  providerRef.current = provider;
  const platform = useMemo(
    () => createNativePlatform(config, getToken, onUnauthorized, isCurrent),
    [config.serverUrl, config.authMode, getToken, onUnauthorized, isCurrent],
  );
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
            apiKey: providerRef.current.apiKey,
            protocol: providerRef.current.protocol,
            baseUrl: providerRef.current.baseUrl,
            model: providerRef.current.model,
          }),
          () => {},
        ),
      ),
    [config.conversationId, config.agentId, platform],
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
    if (!state.ready || state.running || state.sending || !onCacheMessages) return;
    // Only persist messages that have a server sequence, never pending optimistic sends.
    onCacheMessages(state.messages.filter((message) => typeof message.seq === "number"), state.hasMore);
  }, [state.ready, state.running, state.sending, state.messages, state.hasMore, onCacheMessages]);
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
  useEffect(() => {
    session.providerChanged();
  }, [session, provider.apiKey, provider.baseUrl, provider.protocol]);
  const [serverModel, setServerModel] = useState("");
  useEffect(() => {
    let alive = true;
    void platform
      .connection()
      .then(async (connection) => {
        const response = await platform.request(
          `${connection.baseUrl}/api/config/provider`,
          { headers: connection.headers },
        );
        if (!response.ok) return;
        const result = (await response.json()) as { model?: unknown };
        if (alive && typeof result.model === "string")
          setServerModel(result.model.trim());
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [platform]);
  const problem = session.credentialProblem();
  const boundModel =
    typeof state.executionConfig?.model === "string"
      ? state.executionConfig.model
      : undefined;
  const { model: shownModel, models } = getModelPickerConfig(
    {
      apiKey: provider.apiKey,
      model: provider.model,
      models: provider.models,
    },
    serverModel,
    boundModel,
  );
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
    const timer = setTimeout(
      () => void session.cancel().catch(() => {}),
      cancelAfter,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelAfter, state.running]);
  return (
    <View style={styles.flex}>
    <ChatKeyboardAvoidingView>
      <View style={styles.row}>
        {onOpenDrawer && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="打开会话菜单"
            onPress={onOpenDrawer}
            hitSlop={8}
            style={styles.menuButton}
          >
            <Menu size={22} color="#333" />
          </Pressable>
        )}
        <View style={styles.title}>
          <Text numberOfLines={1} style={styles.heading}>
            {title || "对话"}
          </Text>
          {!!boundModel && (
            <Text numberOfLines={1} style={styles.subtitle}>
              {`${state.executionConfig?.protocol ?? "服务端配置"} · ${state.executionConfig?.baseUrl || "默认地址"} · ${boundModel}`}
            </Text>
          )}
        </View>
      </View>
      {!state.ready && !cachedMessages?.length ? (
        <View style={styles.loading} accessibilityState={{ busy: true }}>
          <View style={styles.loadingLogo}>
            <Image source={require("../../../assets/antler-logo.png")} style={styles.logo} accessibilityIgnoresInvertColors />
          </View>
          <View style={styles.loadingLabel} accessibilityRole="progressbar" accessibilityLabel={state.notice.includes("正在重连") ? state.notice : "正在加载会话"}>
            <ActivityIndicator size="small" color="#087d61" />
            <Text style={styles.loadingText}>正在加载会话…</Text>
          </View>
          {!!state.notice && !state.notice.includes("正在重连") && <Text accessibilityRole="alert" style={styles.loadingNotice}>{state.notice}</Text>}
        </View>
      ) : <View style={styles.chatContent}>
      <ChatScreen
        showDisclaimer={false}
        dockBackground={
          <GradientMask pointerEvents="none" style={StyleSheet.absoluteFill} maskElement={
            <LinearGradient colors={["transparent", "rgba(0,0,0,0.65)", "#000"]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
          }>
            <BlurView tint="light" intensity={90} style={StyleSheet.absoluteFill} />
            <View style={styles.dockTint} />
            <LinearGradient colors={["rgba(255,255,255,0)", "#fff"]} style={styles.safeAreaFade} />
          </GradientMask>
        }
        composerBackground={<BlurView tint="light" intensity={65} style={StyleSheet.absoluteFill} />}
        messages={state.ready ? state.messages : cachedMessages ?? []}
        ready={state.ready}
        running={state.running}
        sending={state.sending}
        hasMore={state.hasMore}
        notice={state.ready ? state.notice : `显示本地缓存，${state.notice || "正在连接服务端…"}`}
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
        model={shownModel}
        models={models}
        onModelChange={(picked) => {
          if (picked === shownModel) return;
          onModelSelected(picked, Boolean(state.executionConfig));
        }}
      />
      </View>}
    </ChatKeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  chatContent: { flex: 1, minHeight: 0 },
  dockTint: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(255,255,255,0.7)" },
  safeAreaFade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 32 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, backgroundColor: "#fff" },
  loadingLogo: { width: 64, height: 64, borderRadius: 16, backgroundColor: "#f0f8f5", alignItems: "center", justifyContent: "center", marginBottom: 20 },
  logo: { width: 40, height: 40, resizeMode: "contain" },
  loadingLabel: { flexDirection: "row", alignItems: "center", gap: 8 },
  loadingText: { fontSize: 14, fontWeight: "500", color: "#404b47" },
  loadingNotice: { marginTop: 12, textAlign: "center", fontSize: 14, color: "#747d79" },
  title: { flex: 1, minWidth: 0 },
  heading: { fontSize: 18, fontWeight: "700" },
  subtitle: { fontSize: 12, color: "#777" },
  menuButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingRight: 16,
    backgroundColor: "#fff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e8e8e8",
  },
});
