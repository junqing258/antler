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
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BottomSheet, RNHostView } from "@expo/ui";
import * as Crypto from "expo-crypto";
import { CircleHelp, Settings, UserRound } from "lucide-react-native";
import { useRouter, useGlobalSearchParams, Stack } from "expo-router";
import { AuthForm, ProviderConfigForm } from "@antler/ui";
import type { BoundCredential } from "@antler/client-runtime";
import { Button } from "../../components/button";
import { QueryProvider } from "./query-provider";
import { readAppConfig } from "../../lib/app-config";
import { bundleVersion } from "../../lib/bundle-version";
import { createNativePlatform } from "../../lib/native-platform";
import { useDelayedPending } from "../../lib/use-delayed-pending";
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
  currentAccountId,
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
  cacheScope?: string;
};

/**
 * 根容器：启动、认证边界、自动化深链分发与全局设置。
 * 路由栈由 Expo Router 接管；本组件只决定是否渲染路由（认证门禁）
 * 以及持有跨页面共享状态。antler://autostart 不作为普通页面路由：
 * 由这里的 Linking 监听解析后经 openChat 进入 /chat/[id]。
 */
export function AppContainer() {
  const { height: windowHeight } = useWindowDimensions();
  const [boot, setBoot] = useState<Boot>();
  const bootGeneration = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const showLoading = useDelayedPending(loading);
  const [authenticated, setAuthenticated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState(defaultProvider);
  const [draftProvider, setDraftProvider] = useState(defaultProvider);
  const [settings, setSettings] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [settingsTab, setSettingsTab] = useState<"provider" | "profile" | "about">(
    "provider",
  );
  const [displayName, setDisplayName] = useState("用户");
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
        const accountId = backend.mode === "supabase" && backend.url && backend.publishableKey && accessToken
          ? await currentAccountId(backend.url, backend.publishableKey)
          : backend.mode === "local" ? `local:${token}` : "";
        const cacheScope = accountId
          ? await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify([application.serverUrl, backend.mode, backend.url ?? "", accountId]))
          : undefined;
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
                cacheScope,
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
            cacheScope,
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
  const openSettings = (value?: BoundCredential, tab: "provider" | "profile" = "provider") => {
    setBinding(value);
    setDraftProvider(provider);
    setSettingsError("");
    setSettingsTab(tab);
    setDisplayName("用户");
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
    if (router.canGoBack()) router.back();
    else router.replace("/");
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
      <SafeAreaView style={[styles.center, styles.connectionLoading]} accessibilityLabel={showLoading ? "正在连接" : undefined}>
        {showLoading && <ActivityIndicator size="small" color="#087d61" />}
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
    <QueryProvider key={boot.generation} scope={boot.cacheScope}>
    <RootContext.Provider value={contextValue}>
      <View style={styles.flex}>
        <Stack screenOptions={{ headerShown: false, animation: "default" }} />
        {!!error && <Text accessibilityRole="alert">{error}</Text>}
        {settings && <BottomSheet isPresented={settings} onDismiss={() => setSettings(false)} contentPadding={0} containerColor="#fff" showDragIndicator={false}>
          <RNHostView matchContents={{ vertical: true }}>
          <KeyboardAvoidingView style={[styles.modalFrame, { maxHeight: windowHeight * 0.85 }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={styles.dialog} accessibilityViewIsModal>
              <View style={styles.grabber} />
              <View style={styles.dialogHeader}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
                  {([
                    ["provider", Settings, "供应商配置"],
                    ["profile", UserRound, "个人资料"],
                    ["about", CircleHelp, "关于"],
                  ] as const).map(([tab, Icon, label]) => (
                    <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected: settingsTab === tab }} onPress={() => setSettingsTab(tab)} style={[styles.tab, settingsTab === tab && styles.activeTab]}>
                      <Icon size={16} color={settingsTab === tab ? "#087d61" : "#555"} />
                      <Text style={[styles.tabText, settingsTab === tab && styles.activeTabText]}>{label}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
              <View style={styles.dialogContent}>
                {settingsTab === "provider" ? (
                  <ProviderConfigForm
                    value={draftProvider}
                    onChange={setDraftProvider}
                    onSubmit={(value) => void save(value)}
                    submitLabel="保存配置"
                    busy={busy}
                    error={settingsError}
                    credentialBinding={binding}
                    onReset={() => setDraftProvider(defaultProvider)}
                    description="配置只保存在当前设备，账号不会同步 API Key。"
                    contentPaddingHorizontal={20}
                  />
                ) : settingsTab === "profile" ? (
                  <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.detailContent}>
                    <View style={styles.detailHeading}>
                      <Text accessibilityRole="header" style={styles.detailTitle}>个人资料</Text>
                      <Text style={styles.hint}>管理此设备上的个人信息。</Text>
                    </View>
                    <View style={styles.avatar}><Text style={styles.avatarText}>{displayName.slice(0, 1).toUpperCase() || "U"}</Text></View>
                    <View style={styles.field}>
                      <Text style={styles.label}>显示名称</Text>
                      <TextInput accessibilityLabel="显示名称" value={displayName} onChangeText={setDisplayName} placeholder="输入你的名称" style={styles.input} />
                    </View>
                    {!!accountEmail && <View style={styles.infoCard}>
                      <Text style={styles.label}>登录账号</Text>
                      <Text style={styles.account}>{accountEmail}</Text>
                      <Pressable accessibilityRole="button" onPress={() => { setSettings(false); handleSignOut(); }} style={styles.signOut}>
                        <Text style={styles.signOutText}>退出登录</Text>
                      </Pressable>
                    </View>}
                    <Text style={styles.hint}>个人资料当前仅保存在本次应用会话中。</Text>
                  </ScrollView>
                ) : (
                  <ScrollView contentContainerStyle={styles.detailContent}>
                    <View style={styles.detailHeading}>
                      <Text accessibilityRole="header" style={styles.detailTitle}>关于</Text>
                      <Text style={styles.hint}>应用信息与版本</Text>
                    </View>
                    <View style={styles.infoCard}><Text style={styles.detailTitle}>Antler</Text><Text style={styles.hint}>移动助手</Text></View>
                    <View style={styles.infoCard}><Text style={styles.account}>应用名称　 Antler</Text><Text style={styles.account}>当前版本　 v{bundleVersion}</Text><Text style={styles.account}>运行环境　移动应用</Text></View>
                  </ScrollView>
                )}
              </View>
            </View>
          </KeyboardAvoidingView>
          </RNHostView>
        </BottomSheet>}
      </View>
    </RootContext.Provider>
    </QueryProvider>
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
  connectionLoading: { alignItems: "center", backgroundColor: "#fff" },
  loginContent: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 12 },
  modalFrame: { width: "100%", flexShrink: 1, backgroundColor: "white" },
  dialog: { flexShrink: 1, width: "100%", maxWidth: 820, alignSelf: "center", backgroundColor: "white" },
  dialogHeader: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, backgroundColor: "white", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e5e5e5" },
  grabber: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: "#d9d9d9", marginTop: 10, marginBottom: 8 },
  tabRow: { flexDirection: "row", gap: 4, marginTop: 12 },
  tab: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10 },
  activeTab: { backgroundColor: "#e8f3ef" },
  tabText: { color: "#555", fontSize: 12 },
  activeTabText: { color: "#087d61", fontWeight: "600" },
  dialogContent: { flexShrink: 1, minHeight: 0, paddingTop: 20 },
  detailContent: { gap: 20, paddingHorizontal: 20, paddingBottom: 32 },
  detailHeading: { borderBottomWidth: 1, borderBottomColor: "#eee", paddingBottom: 16, gap: 4 },
  detailTitle: { fontSize: 18, fontWeight: "600", color: "#222" },
  hint: { fontSize: 12, lineHeight: 18, color: "#777" },
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: "#e8f3ef" },
  avatarText: { fontSize: 20, fontWeight: "600", color: "#087d61" },
  field: { gap: 6 },
  label: { color: "#4b4b4b", fontWeight: "600", fontSize: 12 },
  input: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, minHeight: 40, paddingHorizontal: 11, fontSize: 14, color: "#222" },
  infoCard: { backgroundColor: "#f6faf8", borderWidth: 1, borderColor: "#e7eeeb", borderRadius: 12, padding: 16, gap: 8 },
  account: { color: "#222", fontSize: 13 },
  signOut: { alignSelf: "flex-start", borderWidth: 1, borderColor: "#ddd", borderRadius: 8, backgroundColor: "white", paddingHorizontal: 12, paddingVertical: 8, marginTop: 4 },
  signOutText: { color: "#4b4b4b", fontSize: 12 },
});
