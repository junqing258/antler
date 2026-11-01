import { useState } from "react";
import { View, StyleSheet } from "react-native";
import * as Crypto from "expo-crypto";
import { NativeChat } from "../../views/chat/native-chat";
import { ChatDrawer } from "../../views/chat/chat-drawer";
import type { NativeConfig } from "../../lib/native-config";
import { useRoot } from "../../views/root/root-context";

/** `/chat/[id]` 会话路由：解析会话参数并组装聊天页与抽屉。 */
export function ChatRoute() {
  const root = useRoot();
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const id = root.routeParams.id;
  if (!root.boot || !id) return null;
  const { boot } = root;
  const agentId = root.routeParams.agentId || undefined;
  const pending =
    root.pendingAuto && root.pendingAuto.id === id ? root.pendingAuto : undefined;
  const title = titles[id] ?? root.routeParams.title ?? "";
  const chatConfig: NativeConfig = {
    ...boot.config,
    conversationId: id,
    agentId: agentId ?? "",
  };
  return (
    <View style={styles.flex}>
      <NativeChat
        key={id}
        config={chatConfig}
        provider={root.provider}
        getToken={root.getToken}
        onUnauthorized={root.onUnauthorized}
        isCurrent={root.isCurrent}
        autoMessage={pending?.message}
        cancelAfter={pending?.cancelAfter ?? 0}
        title={title}
        onOpenDrawer={() => setDrawerOpen(true)}
        onConfigure={root.openSettings}
        onModelSelected={(model, startNew) => {
          void root.saveProviderModel(model).then((saved) => {
            if (saved && startNew)
              root.openChat(
                { id: Crypto.randomUUID(), agentId, title: "新对话" },
                "replace",
              );
          });
        }}
      />
      <ChatDrawer
        visible={drawerOpen}
        activeId={id}
        agentId={agentId}
        config={boot.config}
        getToken={root.getToken}
        onUnauthorized={root.onUnauthorized}
        isCurrent={root.isCurrent}
        email={root.accountEmail || undefined}
        onClose={() => setDrawerOpen(false)}
        onBackHome={() => {
          setDrawerOpen(false);
          root.goHome();
        }}
        onNewConversation={() => {
          setDrawerOpen(false);
          root.openChat(
            { id: Crypto.randomUUID(), agentId, title: "新对话" },
            "replace",
          );
        }}
        onSelectConversation={(nextId, nextAgentId, nextTitle) => {
          setDrawerOpen(false);
          root.openChat(
            { id: nextId, agentId: nextAgentId, title: nextTitle },
            "replace",
          );
        }}
        onActiveTitle={(changedId, changedTitle) =>
          setTitles((current) => ({ ...current, [changedId]: changedTitle }))
        }
        onActiveDeleted={() =>
          root.openChat(
            { id: Crypto.randomUUID(), agentId, title: "新对话" },
            "replace",
          )
        }
        onOpenSettings={() => root.openSettings()}
        onSignOut={boot.backend.mode === "supabase" ? root.signOut : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});

export default ChatRoute;
