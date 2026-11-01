import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Crypto from "expo-crypto";
import { useRouter, useGlobalSearchParams, Stack } from "expo-router";
import { AuthForm, ProviderConfigForm } from "@antler/ui";
import type { BoundCredential } from "@antler/client-runtime";
import { Button } from "../../components/button";
import { KnowledgeSettings } from "../settings/knowledge-settings";
import { readAppConfig } from "../../lib/app-config";
import { createNativePlatform } from "../../lib/native-platform";
import {
  defaultNativeConfig,
  legacyLocalToken,
  type NativeConfig,
} from "../../lib/native-config";
import { loadNativeConfig } from "../../lib/native-storage";
import {
  defaultProvider,
  loadProviderConfig,
  saveProviderConfig,
  subscribeProviderConfig,
} from "../../lib/provider-storage";
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
} from "../../lib/native-auth";
import {
  RootContext,
  type ChatRouteParams,
  type PendingAuto,
  type RootContextValue,
} from "./root-context";

type Boot = {
  config: NativeConfig;
  backend: AuthBackendConfig;
  automationEnabled: boolean;
  generation: number;
};

/**
 * 根容器：启动、认证边界、自动化深链分发与全局设置。
 * 路由栈由 Expo Router 接管；本组件只决定是否渲染路由（认证门禁）
 * 以及持有跨页面共享状态。antler://autostart 不作为普通页面路由：
 * 由这里的 Linking 监听解析后经 openChat 进入 /chat/[id]。
 */
export function AppContainer() {
  const [boot, setBoot] = useState<Boot>();
  const bootGeneration = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState(defaultProvider);
  const [draftProvider, setDraftProvider] = useState(defaultProvider);
  const [settings, setSettings] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [settingsTab, setSettingsTab] = useState<"provider" | "knowledge">(
    "provider",
  );
  const [binding, setBinding] = useState<BoundCredential>();
  const [pendingAuto, setPendingAuto] = useState<PendingAuto>();
  const autoLoginStarted = useRef(false);
  const pendingAutoUrl = useRef<string | null>(null);
  const initialUrlTaken = useRef(false);
  const [accountEmail, setAccountEmail] = useState("");
  const router = useRouter();
  const routeParams = useChatParams();

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

  // 自动化深链：唯一入口。antler://autostart 仅在 automationEnabled 构建中生效；
  // 会话参数转入 pendingAuto（内存），登录信息仅用于自动登录，绝不进入路由历史。
  useEffect(() => {
    if (!boot?.automationEnabled) return;
    const handle = (value: string | null | undefined) => {
      if (!value) return;
      try {
        const url = new URL(value);
        if (url.hostname !== "autostart") return;
        const parseAuto = (): PendingAuto => ({
          id: url.searchParams.get("conversationId") || Crypto.randomUUID(),
          agentId: url.searchParams.get("agentId") || undefined,
          message: url.searchParams.get("message") || undefined,
          cancelAfter: Number(url.searchParams.get("cancelAfter") || 0),
        });
        if (!authenticated) {
          const email = url.searchParams.get("email");
          const password = url.searchParams.get("password");
          if (
            !email ||
            !password ||
            autoLoginStarted.current ||
            boot.backend.mode !== "supabase" ||
            !boot.backend.url ||
            !boot.backend.publishableKey
          )
            return;
          autoLoginStarted.current = true;
          pendingAutoUrl.current = value;
          void signIn(
            boot.backend.url,
            boot.backend.publishableKey,
            email,
            password,
          )
            .then(() => setAttempt((n) => n + 1))
            .catch((cause) => {
              autoLoginStarted.current = false;
              setError(cause instanceof Error ? cause.message : "自动登录失败。");
            });
          return;
        }
        pendingAutoUrl.current = null;
        setPendingAuto(parseAuto());
      } catch {
        /* ignore invalid links */
      }
    };
    if (!initialUrlTaken.current) {
      initialUrlTaken.current = true;
      if (pendingAutoUrl.current) {
        const value = pendingAutoUrl.current;
        pendingAutoUrl.current = null;
        handle(value);
      } else
        void Linking.getInitialURL()
          .then(handle)
          .catch(() => {});
    }
    const subscription = Linking.addEventListener("url", ({ url }) =>
      handle(url),
    );
    return () => subscription.remove();
  }, [boot, authenticated]);

  // pendingAuto 变化即导航到对应会话（replace，避免历史栈堆积）。
  useEffect(() => {
    if (!authenticated || !boot || !pendingAuto) return;
    router.replace({
      pathname: "/chat/[id]",
      params: { id: pendingAuto.id, agentId: pendingAuto.agentId ?? "" },
    });
  }, [authenticated, boot, pendingAuto, router]);

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
  const dropSession = useCallback(() => {
    setPendingAuto(undefined);
    setAccountEmail("");
    router.replace("/");
  }, [router]);
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
        setAuthenticated(false);
        dropSession();
        throw new Error("登录已过期，请重新登录。");
      }
      return token;
    }
    return boot.config.accessToken;
  }, [boot, dropSession, invalidateBoot]);
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
        setAuthenticated(false);
        dropSession();
      },
    );
  }, [boot, dropSession, invalidateBoot]);
  const onUnauthorized = useCallback(() => {
    if (!boot || !invalidateBoot()) return;
    if (boot.backend.mode === "supabase") {
      setError("登录已过期，请重新登录。");
      setAuthenticated(false);
      dropSession();
    } else {
      setError("服务端拒绝了访问，请联系管理员检查认证配置。");
      setPendingAuto(undefined);
      setBoot(undefined);
    }
  }, [boot, dropSession, invalidateBoot]);
  const openSettings = (value?: BoundCredential) => {
    setBinding(value);
    setDraftProvider(provider);
    setSettingsError("");
    setSettingsTab("provider");
    setSettings(true);
  };
  const saveProviderModel = async (model: string) => {
    const next = { ...provider, model };
    try {
      await saveProviderConfig(next);
      setProvider(next);
      return true;
    } catch {
      openSettings();
      setSettingsError("保存模型失败，请重试。");
      return false;
    }
  };
  const save = async (value: Parameters<typeof saveProviderConfig>[0]) => {
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
  const handleSignOut = () => {
    if (!boot || !boot.backend.url || !boot.backend.publishableKey) return;
    void signOut(boot.backend.url, boot.backend.publishableKey)
      .then(() => {
        invalidateBoot();
        setAuthenticated(false);
        dropSession();
      })
      .catch(() => setError("退出登录失败，请重试。"));
  };
  const openChat = useCallback<RootContextValue["openChat"]>(
    (params, mode) => {
      if (mode === "replace") setPendingAuto(undefined);
      router[mode]({
        pathname: "/chat/[id]",
        params: {
          id: params.id,
          agentId: params.agentId ?? "",
          title: params.title ?? "",
        },
      });
    },
    [router],
  );
  const goHome = useCallback(() => {
    setPendingAuto(undefined);
    router.replace("/");
  }, [router]);
  const contextValue = useMemo<RootContextValue>(
    () => ({
      boot,
      provider,
      accountEmail,
      pendingAuto,
      routeParams,
      getToken,
      isCurrent,
      onUnauthorized,
      openSettings,
      saveProviderModel,
      signOut: handleSignOut,
      openChat,
      goHome,
    }),
    [
      accountEmail,
      boot,
      getToken,
      goHome,
      isCurrent,
      onUnauthorized,
      openChat,
      pendingAuto,
      provider,
      routeParams,
    ],
  );
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
  return (
    <RootContext.Provider value={contextValue}>
      <SafeAreaView style={styles.flex}>
        <Stack screenOptions={{ headerShown: false, animation: "none" }} />
        {!!error && <Text accessibilityRole="alert">{error}</Text>}
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
    </RootContext.Provider>
  );
}

/** 当前活跃路由的会话参数；由根布局统一直入上下文，路由文件保持零 Router 依赖。 */
function useChatParams(): ChatRouteParams {
  const params = useGlobalSearchParams();
  const pick = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : undefined;
  return { id: pick("id"), agentId: pick("agentId"), title: pick("title") };
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

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  loginContent: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 12 },
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
