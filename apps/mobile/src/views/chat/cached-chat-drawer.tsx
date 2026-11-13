import { useCallback, type ComponentProps } from "react";
import { useIsRestoring, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConversationSummary } from "../../lib/conversation-service";
import { ChatDrawer } from "./chat-drawer";

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
  return <ChatDrawer key={agentId ?? ""} {...props} cachedConversations={cached.data} onCacheConversations={save} />;
}
