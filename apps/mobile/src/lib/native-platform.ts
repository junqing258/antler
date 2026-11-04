import { fetch as expoFetch } from "expo/fetch";
import * as Crypto from "expo-crypto";
import { AppState } from "react-native";
import type { ClientPlatform } from "@antler/platform";
import type { NativeConfig } from "./native-config";

export function createNativePlatform(
  config: NativeConfig,
  getToken: () => Promise<string> = async () => config.accessToken,
  onUnauthorized?: () => void,
  isCurrent: () => boolean = () => true,
): ClientPlatform {
  const assertCurrent = () => {
    if (!isCurrent()) throw new Error("认证配置已更改，请重试。");
  };
  return {
    initialize: async () => {},
    connection: async () => {
      assertCurrent();
      const token = await getToken();
      assertCurrent();
      const headers: Record<string, string> =
        config.authMode === "supabase"
          ? { authorization: `Bearer ${token}` }
          : { "x-antler-token": token };
      return { baseUrl: config.serverUrl, headers };
    },
    request: async (url, init) => {
      assertCurrent();
      const response = await expoFetch(url, init);
      assertCurrent();
      if (response.status === 401) onUnauthorized?.();
      return response;
    },
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
