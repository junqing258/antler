import {
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
import { ChatScreen, type ProviderConfigDraft } from "@antler/ui";
import {
  ChatSession,
  createHttpSessionDependencies,
  getBoundCredential,
  getModelPickerConfig,
  type BoundCredential,
} from "@antler/client-runtime";
import type { NativeConfig } from "./native-config";
import { createNativePlatform } from "./native-platform";

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      style={styles.button}
      onPress={onPress}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}
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
    >
      <View style={styles.row}>
        <View style={styles.title}>
          <Text style={styles.heading}>对话</Text>
          {!!boundModel && (
            <Text>{`${state.executionConfig?.protocol ?? "服务端配置"} · ${state.executionConfig?.baseUrl || "默认地址"} · ${boundModel}`}</Text>
          )}
        </View>
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
  title: { flex: 1 },
  heading: { fontSize: 18, fontWeight: "700" },
  button: { borderRadius: 8, backgroundColor: "#087d61", padding: 10 },
  buttonText: { color: "white", fontWeight: "600" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginVertical: 8,
  },
});
