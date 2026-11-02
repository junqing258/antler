import { useState, type ReactNode } from "react";
import { ActivityIndicator, Keyboard, Platform, Pressable, StyleSheet, Text, View } from "react-native";
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
  composerBackground?: ReactNode;
  dockBackground?: ReactNode;
  showDisclaimer?: boolean;
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
  composerBackground,
  dockBackground,
  showDisclaimer = true,
}: ChatScreenProps) {
  const [dockHeight, setDockHeight] = useState(0);
  const [sendRequest, setSendRequest] = useState<{ id: number; knownUserIds: string[] }>();
  const floating = Platform.OS !== "web" && !!composerBackground;
  const sendDisabled =
    !ready || sending || Boolean(contextReason) || Boolean(credentialProblem);
  const composer = (
    <Composer
      background={composerBackground}
      value={draft}
      onChange={onDraftChange}
      onSend={() => {
        setSendRequest((previous) => ({
          id: (previous?.id ?? 0) + 1,
          knownUserIds: messages.filter((message) => message.role === "user").map((message) => message.id),
        }));
        onSend();
      }}
      onStop={onStop}
      running={running}
      sending={sending}
      disabled={sendDisabled}
      leading={
        models && onModelChange ? (
          <ModelPicker
            model={model ?? ""}
            models={models}
            onModelChange={onModelChange}
            onConfigure={onConfigureCredentials}
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
      {!!notice && (notice.includes("正在重连") ? (
        <View accessibilityLabel={notice} style={styles.connectionLoading}>
          <ActivityIndicator size="small" color="#087d61" />
        </View>
      ) : <Text accessibilityRole="alert">{notice}</Text>)}
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
        {floating ? (
          <Pressable style={styles.welcome} onPress={Keyboard.dismiss} accessible={false}>
            <Text style={styles.welcomeTitle}>{welcomeTitle}</Text>
          </Pressable>
        ) : (
          <View style={styles.welcome}>
            <Text style={styles.welcomeTitle}>{welcomeTitle}</Text>
            <View style={styles.welcomeComposer}>{composer}</View>
          </View>
        )}
        {floating && <View style={styles.composerDock}>{dockBackground}{composer}</View>}
      </View>
    );
  return (
    <View style={styles.flex}>
      {notices}
      <MessageList messages={messages} ready={ready} onCopy={onCopy} bottomInset={floating ? dockHeight : 0} sendRequest={sendRequest} />
      <View onLayout={(event) => setDockHeight(event.nativeEvent.layout.height)} style={[styles.composerDock, floating && styles.floatingDock]} pointerEvents="box-none">
        {floating && dockBackground}
        {composer}
        {showDisclaimer && <Text style={styles.disclaimer}>Antler 可能出错，请核查重要结果。</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minHeight: 0, backgroundColor: "#fff" },
  composerDock: {
    width: "100%",
    maxWidth: 1064,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  floatingDock: { position: "absolute", bottom: 0, left: 0, right: 0 },
  welcome: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  welcomeTitle: { fontSize: 24, fontWeight: "600", marginBottom: 24 },
  welcomeComposer: { width: "100%", maxWidth: 1024 },
  notices: { gap: 4, paddingHorizontal: 12, paddingTop: 4 },
  connectionLoading: {
    alignSelf: "center",
    marginTop: 8,
    padding: 8,
  },
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
    marginTop: 8,
    marginBottom: 4,
  },
});
