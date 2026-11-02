import { createContext, useContext } from "react";
import type { BoundCredential } from "@antler/client-runtime";
import type { ProviderConfigDraft } from "@antler/ui";
import type { AuthBackendConfig } from "../../lib/native-auth";
import type { NativeConfig } from "../../lib/native-config";

export type PendingAuto = {
  id: string;
  agentId?: string;
  message?: string;
  cancelAfter?: number;
};

export type ChatRouteParams = {
  id?: string;
  agentId?: string;
  title?: string;
};

export type RootContextValue = {
  /** 仅在已认证的路由树中非空；门禁早退分支期间为 undefined。 */
  boot:
    | {
        config: NativeConfig;
        backend: AuthBackendConfig;
        automationEnabled: boolean;
        generation: number;
      }
    | undefined;
  provider: ProviderConfigDraft;
  accountEmail: string;
  pendingAuto: PendingAuto | undefined;
  routeParams: ChatRouteParams;
  getToken: () => Promise<string>;
  isCurrent: () => boolean;
  onUnauthorized: () => void;
  openSettings: (binding?: BoundCredential, tab?: "provider" | "profile") => void;
  /** 保存模型选择；失败时打开设置并显示错误，返回是否成功。 */
  saveProviderModel: (model: string) => Promise<boolean>;
  signOut: () => void;
  openChat: (
    params: { id: string; agentId?: string; title?: string },
    mode: "push" | "replace",
  ) => void;
  goHome: () => void;
};

export const RootContext = createContext<RootContextValue | null>(null);

export function useRoot(): RootContextValue {
  const value = useContext(RootContext);
  if (!value) throw new Error("RootContext 必须在根布局内使用。");
  return value;
}
