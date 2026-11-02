import { useCallback } from "react";
import { useIsRestoring, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChatMessage } from "@antler/chat-core";
import { NativeChat } from "./native-chat";

type StoredMessage = Omit<ChatMessage, "createdAt"> & { createdAt?: string };

/** Cache is a read-only preview until the live session has loaded from the server. */
export function CachedNativeChat(props: React.ComponentProps<typeof NativeChat>) {
  const client = useQueryClient();
  const restoring = useIsRestoring();
  const id = props.config.conversationId;
  const cached = useQuery<StoredMessage[]>({
    queryKey: ["conversation-messages", id],
    queryFn: async () => [],
    enabled: false,
  });
  const save = useCallback((messages: ChatMessage[], hasMore: boolean) => {
    const stored: StoredMessage[] = messages.map((message) => ({
      ...message,
      createdAt: message.createdAt instanceof Date && !Number.isNaN(message.createdAt.getTime())
        ? message.createdAt.toISOString()
        : undefined,
    }));
    client.setQueryData<StoredMessage[]>(["conversation-messages", id], (previous) => {
      const firstSeq = stored[0]?.seq;
      const older = hasMore && firstSeq !== undefined
        ? (previous ?? []).filter((message) => typeof message.seq === "number" && message.seq < firstSeq)
        : [];
      return [...older, ...stored];
    });
  }, [client, id]);
  const preview = cached.data?.map((message) => ({
    ...message,
    createdAt: message.createdAt ? new Date(message.createdAt) : undefined,
  }));
  if (restoring) return null;
  return <NativeChat {...props} cachedMessages={preview} onCacheMessages={save} />;
}
