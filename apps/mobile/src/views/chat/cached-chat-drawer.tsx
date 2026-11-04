import { useCallback, type ComponentProps } from "react";
import { useIsRestoring, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type { ConversationSummary } from "../../lib/conversation-service";
import { ChatDrawer } from "./chat-drawer";

type HomePage = { conversations: ConversationSummary[] };

export function CachedChatDrawer(props: ComponentProps<typeof ChatDrawer>) {
  const client = useQueryClient();
  const restoring = useIsRestoring();
  const agentId = props.agentId;
  const cached = useQuery<ConversationSummary[]>({
    queryKey: ["drawer-conversations", agentId ?? null],
    queryFn: async () => [],
    enabled: false,
  });
  const save = useCallback((rows: ConversationSummary[]) => {
    client.setQueryData(["drawer-conversations", agentId ?? null], rows);
  }, [client, agentId]);
  if (restoring) return null;
  const home = client.getQueryData<InfiniteData<HomePage>>(["home-conversations"]);
  const fallback = home?.pages.flatMap((page) => page.conversations)
    .filter((row) => !agentId || row.agentId === agentId);
  return <ChatDrawer key={agentId ?? ""} {...props} cachedConversations={cached.data ?? fallback} onCacheConversations={save} />;
}
