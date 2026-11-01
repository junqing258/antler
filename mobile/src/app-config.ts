import Constants from "expo-constants";
import { validateServerUrl } from "./native-config";

/** The public endpoint embedded in this build is the only server authority. */
export function readAppConfig() {
  const extra = Constants.expoConfig?.extra;
  const value = extra?.serverUrl;
  if (typeof value !== "string" || !value.trim())
    throw new Error("应用未配置服务地址，请联系部署管理员。");
  try {
    return {
      serverUrl: validateServerUrl(value, extra?.allowHttp === true),
      automationEnabled: extra?.automationEnabled === true,
    };
  } catch {
    throw new Error("应用服务地址无效，请联系部署管理员。");
  }
}
