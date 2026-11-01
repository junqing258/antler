import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Crypto from "expo-crypto";
import { fetch as expoFetch } from "expo/fetch";
import { Probe } from "./probe";
import {
  AuthForm,
  ProviderConfigForm,
  type ProviderConfigDraft,
} from "@antler/ui";
import type { BoundCredential } from "@antler/client-runtime";
import { HomePage } from "./home-page";
import { NativeChat } from "./native-chat";
import { ChatDrawer } from "./chat-drawer";
import { KnowledgeSettings } from "./knowledge-settings";
import { readAppConfig } from "./app-config";
import {
  defaultNativeConfig,
  legacyLocalToken,
  type NativeConfig,
} from "./native-config";
import { loadNativeConfig } from "./native-storage";
import {
  defaultProvider,
  loadProviderConfig,
  saveProviderConfig,
  subscribeProviderConfig,
} from "./provider-storage";
import {
  currentAccessToken,
  currentAccountEmail,
  loadAuthBackendConfig,
  createNativeAuthActions,
  disposeNativeAuth,
  onNativeSignedOut,
  signIn,
  signOut,
  type AuthBackendConfig,
} from "./native-auth";
import { createNativePlatform } from "./native-platform";

type Boot = {
  config: NativeConfig;
  backend: AuthBackendConfig;
  automationEnabled: boolean;
  generation: number;
};

export function App() {
  const [boot, setBoot] = useState<Boot>();
  const bootGeneration = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] =
    useState<ProviderConfigDraft>(defaultProvider);
  const [draftProvider, setDraftProvider] =
    useState<ProviderConfigDraft>(defaultProvider);
  const [settings, setSettings] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [settingsTab, setSettingsTab] = useState<"provider" | "knowledge">(
    "provider",
  );
  const [binding, setBinding] = useState<BoundCredential>();
  const [showProbe, setShowProbe] = useState(false);
  const autoLoginStarted = useRef(false);
  const pendingAutoUrl = useRef<string | null>(null);
  const [chat, setChat] = useState<{
    id: string;
    agentId?: string;
    title?: string;
    message?: string;
    cancelAfter?: number;
  }>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [accountEmail, setAccountEmail] = useState("");

  useEffect(() => {
    let alive = true;
    const generation = ++bootGeneration.current;
    disposeNativeAuth();
    const startupRequest = new AbortController();
    setLoading(true);
    setError("");
    setBoot(undefined);
    setAuthenticated(false);
    void (async () => {
      try {
        const application = readAppConfig();
        const [legacy, backend, savedProvider] = await Promise.all([
          loadNativeConfig(),
          loadAuthBackendConfig(application.serverUrl),
          loadProviderConfig(),
        ]);
        if (!alive || generation !== bootGeneration.current) return;
        const token =
          backend.mode === "local" && backend.requiresAccessToken
            ? legacyLocalToken(legacy, application.serverUrl)
            : "";
        if (backend.mode === "local" && backend.requiresAccessToken && !token)
          throw new Error(
            "此部署需要访问令牌，新设备暂不支持。请联系管理员使用 Supabase 或受信任的访问控制。",
          );
        const config: NativeConfig = {
          ...defaultNativeConfig,
          serverUrl: application.serverUrl,
          authMode: backend.mode,
          accessToken: token,
        };
        const getToken = async () => {
          if (!alive || generation !== bootGeneration.current)
            throw new Error("认证配置已更改，请重试。");
          const value =
            backend.mode === "supabase" && backend.url && backend.publishableKey
              ? await currentAccessToken(backend.url, backend.publishableKey)
              : token;
          if (!alive || generation !== bootGeneration.current)
            throw new Error("认证配置已更改，请重试。");
          return value;
        };
        const accessToken = await getToken();
        if (!alive || generation !== bootGeneration.current) return;
        if (backend.mode === "local" || accessToken) {
          const platform = createNativePlatform(
            config,
            getToken,
            undefined,
            () => alive && generation === bootGeneration.current,
          );
          const connection = await platform.connection();
          const timeout = setTimeout(() => startupRequest.abort(), 10_000);
          let response: Response;
          try {
            response = await platform.request(
              `${connection.baseUrl}/api/agents`,
              {
                headers: connection.headers,
                signal: startupRequest.signal,
              },
            );
          } catch {
            throw new Error("无法连接服务，请检查网络后重试。");
          } finally {
            clearTimeout(timeout);
          }
          if (response.status === 401 && backend.mode === "supabase") {
            if (alive) {
              setError("登录已过期，请重新登录。");
              setProvider(savedProvider);
              setBoot({
                config,
                backend,
                automationEnabled: application.automationEnabled,
                generation,
              });
            }
            return;
          }
          if (response.status === 401 && backend.requiresAccessToken)
            throw new Error(
              "旧访问令牌已被拒绝，请联系管理员改用受支持的认证方式。",
            );
          if (!response.ok) throw new Error("无法连接服务，请检查网络后重试。");
        }
        if (alive) {
          setProvider(savedProvider);
          setBoot({
            config,
            backend,
            automationEnabled: application.automationEnabled,
            generation,
          });
          setAuthenticated(backend.mode === "local" || Boolean(accessToken));
        }
      } catch (cause) {
        if (alive)
          setError(
            cause instanceof Error ? cause.message : "无法连接服务，请重试。",
          );
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      if (bootGeneration.current === generation) bootGeneration.current++;
      startupRequest.abort();
    };
  }, [attempt]);

  useEffect(
    () =>
      subscribeProviderConfig(() => {
        void loadProviderConfig()
          .then(setProvider)
          .catch(() => {});
      }),
    [],
  );
  useEffect(() => {
    if (
      !authenticated ||
      !boot ||
      boot.backend.mode !== "supabase" ||
      !boot.backend.url ||
      !boot.backend.publishableKey
    )
      return;
    let alive = true;
    void currentAccountEmail(boot.backend.url, boot.backend.publishableKey)
      .then((email) => {
        if (alive) setAccountEmail(email);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [boot, authenticated]);
  useEffect(() => {
    if (!boot?.automationEnabled || !authenticated) return;
    const handle = (value: string | null | undefined) => {
      if (!value) return;
      try {
        const url = new URL(value);
        if (url.hostname !== "autostart") return;
        pendingAutoUrl.current = null;
        setChat({
          id: url.searchParams.get("conversationId") || Crypto.randomUUID(),
          agentId: url.searchParams.get("agentId") || undefined,
          message: url.searchParams.get("message") || undefined,
          cancelAfter: Number(url.searchParams.get("cancelAfter") || 0),
        });
      } catch {
        /* ignore invalid links */
      }
    };
    if (pendingAutoUrl.current) handle(pendingAutoUrl.current);
    else
      void Linking.getInitialURL()
        .then(handle)
        .catch(() => {});
    const subscription = Linking.addEventListener("url", ({ url }) =>
      handle(url),
    );
    return () => subscription.remove();
  }, [boot, authenticated]);

  useEffect(() => {
    if (
      !boot?.automationEnabled ||
      authenticated ||
      boot.backend.mode !== "supabase" ||
      !boot.backend.url ||
      !boot.backend.publishableKey
    )
      return;
    const url = boot.backend.url;
    const key = boot.backend.publishableKey;
    const handle = (value: string | null | undefined) => {
      if (!value || autoLoginStarted.current) return;
      try {
        const link = new URL(value);
        const email = link.searchParams.get("email");
        const password = link.searchParams.get("password");
        if (link.hostname !== "autostart" || !email || !password) return;
        autoLoginStarted.current = true;
        pendingAutoUrl.current = value;
        void signIn(url, key, email, password)
          .then(() => setAttempt((n) => n + 1))
          .catch((cause) => {
            autoLoginStarted.current = false;
            setError(cause instanceof Error ? cause.message : "自动登录失败。");
          });
      } catch {
        /* ignore malformed automation links */
      }
    };
    void Linking.getInitialURL()
      .then(handle)
      .catch(() => {});
    const subscription = Linking.addEventListener("url", ({ url: link }) =>
      handle(link),
    );
    return () => subscription.remove();
  }, [boot, authenticated]);

  const invalidateBoot = useCallback(() => {
    if (!boot || boot.generation !== bootGeneration.current) return false;
    bootGeneration.current++;
    disposeNativeAuth();
    return true;
  }, [boot]);
  const isCurrent = useCallback(
    () => !!boot && boot.generation === bootGeneration.current,
    [boot],
  );
  const getToken = useCallback(async () => {
    if (!boot || boot.generation !== bootGeneration.current)
      throw new Error("认证配置已更改，请重试。");
    if (
      boot.backend.mode === "supabase" &&
      boot.backend.url &&
      boot.backend.publishableKey
    ) {
      const token = await currentAccessToken(
        boot.backend.url,
        boot.backend.publishableKey,
      );
      if (boot.generation !== bootGeneration.current)
        throw new Error("认证配置已更改，请重试。");
      if (!token) {
        invalidateBoot();
        setError("登录已过期，请重新登录。");
        setChat(undefined);
        setDrawerOpen(false);
        setAuthenticated(false);
        throw new Error("登录已过期，请重新登录。");
      }
      return token;
    }
    return boot.config.accessToken;
  }, [boot, invalidateBoot]);
  useEffect(() => {
    if (
      !boot ||
      boot.backend.mode !== "supabase" ||
      !boot.backend.url ||
      !boot.backend.publishableKey
    )
      return;
    return onNativeSignedOut(
      boot.backend.url,
      boot.backend.publishableKey,
      () => {
        if (!invalidateBoot()) return;
        setError("请登录后继续使用。");
        setChat(undefined);
        setDrawerOpen(false);
        setAccountEmail("");
        setAuthenticated(false);
      },
    );
  }, [boot, invalidateBoot]);
  const onUnauthorized = useCallback(() => {
    if (!boot || !invalidateBoot()) return;
    setDrawerOpen(false);
    if (boot.backend.mode === "supabase") {
      setError("登录已过期，请重新登录。");
      setAccountEmail("");
      setChat(undefined);
      setAuthenticated(false);
    } else {
      setError("服务端拒绝了访问，请联系管理员检查认证配置。");
      setBoot(undefined);
    }
  }, [boot, invalidateBoot]);
  const openSettings = (value?: BoundCredential) => {
    setBinding(value);
    setDraftProvider(provider);
    setSettingsError("");
    setSettingsTab("provider");
    setSettings(true);
  };
  const save = async (value: ProviderConfigDraft) => {
    setBusy(true);
    setSettingsError("");
    try {
      await saveProviderConfig(value);
      setProvider(value);
      setSettings(false);
    } catch {
      setSettingsError("保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  };
  if (loading)
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator />
        <Text>正在连接…</Text>
      </SafeAreaView>
    );
  if (!boot)
    return (
      <SafeAreaView style={styles.center}>
        <Text accessibilityRole="alert">{error}</Text>
        <Button label="重试" onPress={() => setAttempt((n) => n + 1)} />
      </SafeAreaView>
    );
  if (!authenticated && boot.backend.url && boot.backend.publishableKey)
    return (
      <Login
        url={boot.backend.url}
        publishableKey={boot.backend.publishableKey}
        error={error}
        onSignedIn={() => setAttempt((n) => n + 1)}
      />
    );
  const chatConfig: NativeConfig = {
    ...boot.config,
    conversationId: chat?.id ?? "",
    agentId: chat?.agentId ?? "",
  };
  const handleSignOut = () => {
    if (!boot.backend.url || !boot.backend.publishableKey) return;
    void signOut(boot.backend.url, boot.backend.publishableKey)
      .then(() => {
        invalidateBoot();
        setDrawerOpen(false);
        setAccountEmail("");
        setAuthenticated(false);
        setChat(undefined);
      })
      .catch(() => setError("退出登录失败，请重试。"));
  };
  return (
    <SafeAreaView style={styles.flex}>
      {boot.automationEnabled && !chat && (
        <Button
          label={showProbe ? "返回主页" : "流式诊断"}
          onPress={() => setShowProbe((value) => !value)}
        />
      )}
      {showProbe && boot.automationEnabled && !chat ? (
        <Probe streamFetch={expoFetch} />
      ) : chat ? (
        <View style={styles.flex}>
          <NativeChat
            key={chat.id}
            config={chatConfig}
            provider={provider}
            getToken={getToken}
            onUnauthorized={onUnauthorized}
            isCurrent={isCurrent}
            autoMessage={chat.message}
            cancelAfter={chat.cancelAfter}
            title={chat.title}
            onOpenDrawer={() => setDrawerOpen(true)}
            onConfigure={openSettings}
            onModelSelected={(model, startNew) => {
              const next = { ...provider, model };
              void saveProviderConfig(next)
                .then(() => {
                  setProvider(next);
                  if (startNew)
                    setChat({
                      id: Crypto.randomUUID(),
                      agentId: chat.agentId,
                      title: "新对话",
                    });
                })
                .catch(() => {
                  openSettings();
                  setSettingsError("保存模型失败，请重试。");
                });
            }}
          />
          <ChatDrawer
            visible={drawerOpen}
            activeId={chat.id}
            agentId={chat.agentId}
            config={boot.config}
            getToken={getToken}
            onUnauthorized={onUnauthorized}
            isCurrent={isCurrent}
            email={accountEmail || undefined}
            onClose={() => setDrawerOpen(false)}
            onBackHome={() => {
              setDrawerOpen(false);
              setChat(undefined);
            }}
            onNewConversation={() => {
              setDrawerOpen(false);
              setChat({
                id: Crypto.randomUUID(),
                agentId: chat.agentId,
                title: "新对话",
              });
            }}
            onSelectConversation={(id, agentId, title) => {
              setDrawerOpen(false);
              setChat({ id, agentId, title });
            }}
            onActiveTitle={(id, title) =>
              setChat((current) =>
                current && current.id === id ? { ...current, title } : current,
              )
            }
            onActiveDeleted={() =>
              setChat((current) =>
                current
                  ? {
                      id: Crypto.randomUUID(),
                      agentId: current.agentId,
                      title: "新对话",
                    }
                  : current,
              )
            }
            onOpenSettings={() => openSettings()}
            onSignOut={
              boot.backend.mode === "supabase" ? handleSignOut : undefined
            }
          />
        </View>
      ) : (
        <HomePage
          config={boot.config}
          getToken={getToken}
          onUnauthorized={onUnauthorized}
          isCurrent={isCurrent}
          onOpenSettings={() => openSettings()}
          onOpenAgent={(agentId) =>
            setChat({ id: Crypto.randomUUID(), agentId, title: "新对话" })
          }
          onOpenConversation={(id, agentId, title) => setChat({ id, agentId, title })}
        />
      )}
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
      {boot.backend.mode === "supabase" && !chat && (
        <Button label="退出登录" onPress={handleSignOut} />
      )}
      {settings && (
        <View style={styles.overlay}>
          <Button label="关闭设置" onPress={() => setSettings(false)} />
          <View style={styles.tabRow}>
            <Button
              label={settingsTab === "provider" ? "模型供应商 ●" : "模型供应商"}
              onPress={() => setSettingsTab("provider")}
            />
            <Button
              label={settingsTab === "knowledge" ? "知识库 ●" : "知识库"}
              onPress={() => setSettingsTab("knowledge")}
            />
          </View>
          {settingsTab === "provider" ? (
            <ProviderConfigForm
              value={draftProvider}
              onChange={setDraftProvider}
              onSubmit={(value) => void save(value)}
              busy={busy}
              error={settingsError}
              credentialBinding={binding}
              onReset={() => setDraftProvider(defaultProvider)}
              description="配置只保存在当前设备，账号不会同步 API Key。"
            />
          ) : (
            <KnowledgeSettings
              config={boot.config}
              getToken={getToken}
              onUnauthorized={onUnauthorized}
              isCurrent={isCurrent}
            />
          )}
        </View>
      )}
    </SafeAreaView>
  );
}
function Login({
  url,
  publishableKey,
  error,
  onSignedIn,
}: {
  url: string;
  publishableKey: string;
  error: string;
  onSignedIn: () => void;
}) {
  const flow = useMemo(
    () => createNativeAuthActions(url, publishableKey, onSignedIn),
    [url, publishableKey],
  );
  useEffect(() => () => flow.clear(), [flow]);
  return (
    <SafeAreaView style={styles.flex}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.loginContent}
          keyboardShouldPersistTaps="handled"
        >
          {!!error && <Text accessibilityRole="alert">{error}</Text>}
          <AuthForm actions={flow.actions} onModeChange={() => flow.clear()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.button}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  loginContent: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 12 },
  button: { padding: 12, alignSelf: "flex-start" },
  buttonText: { color: "#087d61", fontWeight: "600" },
  overlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "white",
    padding: 16,
    paddingTop: 48,
  },
  tabRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 8,
  },
});
