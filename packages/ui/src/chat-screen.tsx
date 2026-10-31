import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ChatMessage } from "@antler/chat-core";
import { Composer } from "./composer";
import { MessageList } from "./message-list";
import { ModelPicker } from "./model-picker";

export type ChatScreenProps = {
  messages: ChatMessage[];
  ready: boolean;
  running: boolean;
  sending: boolean;
  hasMore?: boolean;
  notice?: string;
  operationError?: string;
  contextReason?: string;
  credentialProblem?: string;
  draft: string;
  onDraftChange: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  onLoadEarlier?: () => void;
  onCopy?: (text: string) => void;
  onConfigureCredentials?: () => void;
  model?: string;
  models?: string[];
  onModelChange?: (model: string) => void;
  welcomeTitle?: string;
};

export function ChatScreen({
  messages,
  ready,
  running,
  sending,
  hasMore,
  notice,
  operationError,
  contextReason,
  credentialProblem,
  draft,
  onDraftChange,
  onSend,
  onStop,
  onLoadEarlier,
  onCopy,
  onConfigureCredentials,
  model,
  models,
  onModelChange,
  welcomeTitle = "今天我能帮你做什么？",
}: ChatScreenProps) {
  const sendDisabled =
    !ready || sending || Boolean(contextReason) || Boolean(credentialProblem);
  const composer = (
    <Composer
      value={draft}
      onChange={onDraftChange}
      onSend={onSend}
      onStop={onStop}
      running={running}
      disabled={sendDisabled}
      leading={
        models && onModelChange ? (
          <ModelPicker
            model={model ?? ""}
            models={models}
            onModelChange={onModelChange}
          />
        ) : undefined
      }
    />
  );
  const notices = (
    <View style={styles.notices}>
      {hasMore && onLoadEarlier && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="加载更早消息"
          onPress={onLoadEarlier}
          style={styles.loadEarlier}
        >
          <Text>加载更早消息</Text>
        </Pressable>
      )}
      {!!notice && <Text accessibilityRole="alert">{notice}</Text>}
      {!!operationError && (
        <Text accessibilityRole="alert">{operationError}</Text>
      )}
      {!!contextReason && (
        <Text accessibilityRole="alert">{contextReason}</Text>
      )}
      {!!credentialProblem && (
        <View style={styles.warning}>
          <Text>{credentialProblem}</Text>
          {onConfigureCredentials && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="配置凭据"
              onPress={onConfigureCredentials}
            >
              <Text style={styles.link}>配置凭据</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
  if (ready && messages.length === 0)
    return (
      <View style={styles.flex}>
        {notices}
        <View style={styles.welcome}>
          <Text style={styles.welcomeTitle}>{welcomeTitle}</Text>
          <View style={styles.welcomeComposer}>{composer}</View>
        </View>
      </View>
    );
  return (
    <View style={styles.flex}>
      {notices}
      <MessageList messages={messages} ready={ready} onCopy={onCopy} />
      <View>
        {composer}
        <Text style={styles.disclaimer}>
          Antler 可能出错，请核查重要结果。
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minHeight: 0 },
  welcome: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  welcomeTitle: { fontSize: 24, fontWeight: "600", marginBottom: 24 },
  welcomeComposer: { width: "100%", maxWidth: 700 },
  notices: { gap: 4, paddingHorizontal: 12, paddingTop: 4 },
  loadEarlier: { alignSelf: "center", padding: 8 },
  warning: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 8,
    borderRadius: 8,
    backgroundColor: "#fdf3e7",
  },
  link: { color: "#126b9a" },
  disclaimer: {
    textAlign: "center",
    fontSize: 12,
    color: "#8a8a8a",
    marginVertical: 6,
  },
});
