import { fetch as expoFetch } from "expo/fetch";
import * as Crypto from "expo-crypto";
import { AppState } from "react-native";
import type { ClientPlatform } from "@antler/platform";
import type { NativeConfig } from "./native-config";

export function createNativePlatform(config: NativeConfig): ClientPlatform {
  return {
    initialize: async () => {},
    connection: async () => {
      const headers: Record<string, string> =
        config.authMode === "supabase"
          ? { authorization: `Bearer ${config.accessToken}` }
          : { "x-antler-token": config.accessToken };
      return { baseUrl: config.serverUrl, headers };
    },
    request: (url, init) => expoFetch(url, init),
    abortController: () => new AbortController(),
    decoder: () => new TextDecoder(),
    schedule: (callback, ms) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    },
    createId: Crypto.randomUUID,
    onForeground: (callback) => {
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") callback();
      });
      return () => subscription.remove();
    },
  };
}
