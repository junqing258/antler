import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { BlurView } from "expo-blur";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { ChatScreen, type ProviderConfigDraft } from "@antler/ui";
import {
  ChatSession,
  createHttpSessionDependencies,
  getBoundCredential,
  getModelPickerConfig,
  type BoundCredential,
} from "@antler/client-runtime";
import type { NativeConfig } from "../../lib/native-config";
import { createNativePlatform } from "../../lib/native-platform";

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
}) {
  const insets = useContext(SafeAreaInsetsContext);
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
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? (insets?.top ?? 0) : 0}
    >
      <View style={styles.row}>
        {onOpenDrawer && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="打开会话菜单"
            onPress={onOpenDrawer}
            hitSlop={8}
            style={styles.menuButton}
          >
            <Text style={styles.menuIcon}>☰</Text>
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
      <ChatScreen
        composerBackground={<BlurView tint="light" intensity={65} style={StyleSheet.absoluteFill} />}
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
        model={shownModel}
        models={models}
        onModelChange={(picked) => {
          if (picked === shownModel) return;
          onModelSelected(picked, Boolean(state.executionConfig));
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { flex: 1, minWidth: 0 },
  heading: { fontSize: 18, fontWeight: "700" },
  subtitle: { fontSize: 12, color: "#777" },
  menuButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  menuIcon: { fontSize: 22, color: "#333" },
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
