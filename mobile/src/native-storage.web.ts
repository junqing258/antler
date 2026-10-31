import {
  deserializeNativeConfig,
  serializeNativeConfig,
  type NativeConfig,
} from "./native-config";
const settingsKey = "antler.p0.web-probe.settings.v1";
const secretsKey = "antler.p0.web-probe.credentials.v1";
export async function loadNativeConfig(): Promise<NativeConfig> {
  return deserializeNativeConfig(
    localStorage.getItem(settingsKey),
    localStorage.getItem(secretsKey),
  );
}
export async function saveNativeConfig(config: NativeConfig): Promise<void> {
  const { settings, secrets } = serializeNativeConfig(config);
  localStorage.setItem(secretsKey, secrets);
  localStorage.setItem(settingsKey, settings);
}
