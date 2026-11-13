import { useEffect, useState, type ReactNode } from "react";
import { AppState, Platform } from "react-native";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";

/** A fresh cache belongs to one authenticated boot generation. */
export function QueryProvider({ children, scope }: { children: ReactNode; scope?: string }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 0, gcTime: 7 * 24 * 60 * 60 * 1000, retry: false } },
  }));
  const [persister] = useState(() => scope ? createAsyncStoragePersister({
    storage: AsyncStorage,
    key: `antler.mobile.query.v1.${scope}`,
  }) : undefined);

  useEffect(() => {
    if (Platform.OS === "web") return;
    focusManager.setFocused(AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", (state) => {
      focusManager.setFocused(state === "active");
    });
    return () => {
      subscription.remove();
      focusManager.setFocused(undefined);
    };
  }, []);

  if (!persister) return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return <PersistQueryClientProvider client={client} persistOptions={{
    persister,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    dehydrateOptions: { shouldDehydrateQuery: (query) =>
      query.state.data !== undefined && (query.queryKey[0] === "agents" || query.queryKey[0] === "drawer-conversations" || query.queryKey[0] === "conversation-messages"),
    },
  }}>{children}</PersistQueryClientProvider>;
}
