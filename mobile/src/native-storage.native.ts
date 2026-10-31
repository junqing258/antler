import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import {
  deserializeNativeConfig,
  serializeNativeConfig,
  type NativeConfig,
} from "./native-config";

const settingsKey = "antler.p0.native.settings.v1";
const secretsKey = "antler.p0.native.credentials.v1";
export async function loadNativeConfig(): Promise<NativeConfig> {
  const [settings, secrets] = await Promise.all([
    AsyncStorage.getItem(settingsKey),
    SecureStore.getItemAsync(secretsKey),
  ]);
  return deserializeNativeConfig(settings, secrets);
}
export async function saveNativeConfig(config: NativeConfig): Promise<void> {
  const { settings, secrets } = serializeNativeConfig(config);
  await SecureStore.setItemAsync(secretsKey, secrets);
  await AsyncStorage.setItem(settingsKey, settings);
}
