import { useCallback, useState } from "react";
import { View, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import { CachedNativeChat } from "../../views/chat/cached-native-chat";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { CachedChatDrawer } from "../../views/chat/cached-chat-drawer";
import type { ConversationSummary } from "../../lib/conversation-service";
import type { NativeConfig } from "../../lib/native-config";
import { useRoot } from "../../views/root/root-context";

/** `/chat/[id]` 会话路由：解析会话参数并组装聊天页与抽屉。 */
export function ChatRoute() {
  const root = useRoot();
  const queryClient = useQueryClient();
  const onConversationDeleted = useCallback((deletedId: string) => {
    queryClient.removeQueries({ queryKey: ["conversation-messages", deletedId], exact: true });
    queryClient.setQueriesData<ConversationSummary[]>({ queryKey: ["drawer-conversations"] },
      (rows) => rows?.filter((row) => row.id !== deletedId));
    queryClient.setQueryData<InfiniteData<{ conversations: { id: string }[]; nextCursor: string | null }>>(
      ["home-conversations"],
      (data) => data && ({ ...data, pages: data.pages.map((page) => ({
        ...page, conversations: page.conversations.filter((row) => row.id !== deletedId),
      })) }),
    );
    void queryClient.invalidateQueries({ queryKey: ["home-conversations"] });
  }, [queryClient]);
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
      <CachedChatDrawer
        visible={drawerOpen}
        activeId={id}
        agentId={agentId}
        config={boot.config}
        getToken={root.getToken}
        onUnauthorized={root.onUnauthorized}
        isCurrent={root.isCurrent}
        email={root.accountEmail || undefined}
        onOpen={() => setDrawerOpen(true)}
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
        onConversationDeleted={onConversationDeleted}
        onOpenSettings={() => root.openSettings()}
        onOpenProfile={() => root.openSettings(undefined, "profile")}
      >
        <SafeAreaView style={[styles.flex, styles.page]} edges={["top", "bottom"]}>
          <CachedNativeChat
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
            onStartNewConversation={() =>
              root.openChat(
                { id: Crypto.randomUUID(), agentId, title: "新对话" },
                "replace",
              )
            }
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
        </SafeAreaView>
      </CachedChatDrawer>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { backgroundColor: "#fff" },
});

export default ChatRoute;
