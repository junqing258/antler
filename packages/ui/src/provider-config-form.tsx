import { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { FormButton, FormChoice, FormTextInput } from "./form-controls";

export type ProviderConfigDraft = {
  name: string;
  protocol: "openai-responses" | "anthropic-messages";
  baseUrl: string;
  apiKey: string;
  models: string[];
  model: string;
};

export type CredentialBinding = {
  protocol: string;
  baseUrl: string;
  model: string;
};

const PROTOCOLS: { value: ProviderConfigDraft["protocol"]; label: string }[] = [
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
];

/** 供应商配置表单：模型凭据的跨端配置入口；提交前做与旧版一致的归一化。 */
export function ProviderConfigForm({
  value,
  onChange,
  onSubmit,
  submitLabel = "保存",
  busy = false,
  error,
  notice,
  credentialBinding,
  title = "供应商配置",
  description = "配置仅保存在当前设备的本地存储中。",
  onReset,
  contentPaddingHorizontal = 0,
}: {
  value: ProviderConfigDraft;
  onChange: (next: ProviderConfigDraft) => void;
  onSubmit: (normalized: ProviderConfigDraft) => void;
  submitLabel?: string;
  busy?: boolean;
  error?: string;
  notice?: string;
  credentialBinding?: CredentialBinding;
  title?: string;
  description?: string;
  onReset?: () => void;
  /** 滚动内容的水平内边距；宿主容器不再提供水平 padding 时用它，避免滚动条被挤离屏幕边缘。 */
  contentPaddingHorizontal?: number;
}) {
  const [newModel, setNewModel] = useState("");
  const update = (key: keyof ProviderConfigDraft, fieldValue: string) =>
    onChange({ ...value, [key]: fieldValue });
  const addModel = () => {
    if (busy) return;
    const model = newModel.trim();
    if (!model || value.models.includes(model)) return;
    onChange({
      ...value,
      models: [...value.models, model],
      model: value.model || model,
    });
    setNewModel("");
  };
  const removeModel = (model: string) =>
    onChange({
      ...value,
      models: value.models.filter((item) => item !== model),
      model:
        value.model === model
          ? (value.models.filter((item) => item !== model)[0] ?? "")
          : value.model,
    });
  const submit = () => {
    if (busy) return;
    const models = [
      ...new Set(
        [...value.models, newModel].map((model) => model.trim()).filter(Boolean),
      ),
    ];
    const selected = value.model.trim();
    onSubmit({
      ...value,
      name: value.name.trim() || "自定义供应商",
      baseUrl: value.baseUrl.trim(),
      apiKey: value.apiKey.trim(),
      models,
      model: models.includes(selected) ? selected : (models[0] ?? ""),
    });
  };
  return (
    <ScrollView style={styles.form} contentContainerStyle={[styles.formContent, contentPaddingHorizontal > 0 && { paddingHorizontal: contentPaddingHorizontal }]} nestedScrollEnabled keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {credentialBinding && (
        <View style={styles.binding}>
          <Text style={styles.bindingTitle}>当前会话绑定的配置</Text>
          <Text style={styles.bindingText}>
            {`协议：${credentialBinding.protocol}；服务地址：${credentialBinding.baseUrl || "默认地址"}；模型：${credentialBinding.model}`}
          </Text>
          <Text style={styles.bindingText}>
            请填写匹配的协议、服务地址和 API Key。保存后可继续此会话，账号不会同步
            API Key。
          </Text>
        </View>
      )}
      <Text style={styles.fieldLabel}>名称</Text>
      <FormTextInput
        accessibilityLabel="名称"
        editable={!busy}
        value={value.name}
        onChangeText={(text) => update("name", text)}
        placeholder="例如：OpenAI"
        autoCapitalize="none"
      />
      <Text style={styles.fieldLabel}>协议</Text>
      <View style={styles.protocolRow}>
        {PROTOCOLS.map((protocol) => (
          <FormChoice
            key={protocol.value}
            label={protocol.label}
            selected={value.protocol === protocol.value}
            disabled={busy}
            onPress={() => onChange({ ...value, protocol: protocol.value })}
            containerStyle={styles.flexControl}
          />
        ))}
      </View>
      <Text style={styles.fieldLabel}>Base URL（可选）</Text>
      <FormTextInput
        accessibilityLabel="Base URL（可选）"
        editable={!busy}
        value={value.baseUrl}
        onChangeText={(text) => update("baseUrl", text)}
        placeholder="https://api.openai.com/v1"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <Text style={styles.fieldLabel}>API Key</Text>
      <FormTextInput
        accessibilityLabel="API Key"
        editable={!busy}
        value={value.apiKey}
        onChangeText={(text) => update("apiKey", text)}
        placeholder="仅保存在本地"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.fieldLabel}>模型</Text>
      {credentialBinding ? (
        <Text style={styles.hint}>
          当前会话继续使用上方绑定的模型，无需将它设为默认模型。
        </Text>
      ) : !value.apiKey.trim() ? (
        <Text style={styles.hint}>
          未填写 API Key 时使用服务端默认模型；填写后可在聊天中选择下方模型。
        </Text>
      ) : (
        value.models.length === 0 && (
          <Text style={styles.hint}>请添加供应商支持的模型 ID。</Text>
        )
      )}
      {value.models.map((model) => (
        <View key={model} style={styles.modelRow}>
          <FormChoice
            label={model}
            accessibilityLabel={`默认模型 ${model}`}
            selected={value.model === model}
            variant="model"
            disabled={busy}
            onPress={() => update("model", model)}
            containerStyle={styles.flexControl}
          />
          <FormButton
            label="删除"
            variant="text"
            accessibilityLabel={`删除 ${model}`}
            disabled={busy}
            onPress={() => removeModel(model)}
          />
        </View>
      ))}
      <View style={styles.addRow}>
        <FormTextInput
          accessibilityLabel="新模型 ID"
          containerStyle={styles.flexControl}
          editable={!busy}
          value={newModel}
          onChangeText={setNewModel}
          onSubmitEditing={addModel}
          placeholder="输入供应商支持的模型 ID"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <FormButton
          label="添加模型"
          variant="outlined"
          disabled={busy || !newModel.trim() || value.models.includes(newModel.trim())}
          onPress={addModel}
        />
      </View>
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {!!notice && (
        <Text style={styles.notice}>
          {notice}
        </Text>
      )}
      <View style={styles.footerRow}>
        {onReset && (
          <FormButton
            label="恢复默认"
            variant="outlined"
            disabled={busy}
            onPress={() => {
              setNewModel("");
              onReset();
            }}
          />
        )}
        <FormButton
          label={busy ? "请稍候…" : submitLabel}
          accessibilityLabel={submitLabel}
          disabled={busy}
          onPress={submit}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  form: { maxWidth: 560 },
  formContent: { paddingBottom: 32 },
  title: { fontSize: 18, fontWeight: "600", color: "#222" },
  description: { fontSize: 12, color: "#777", marginTop: 4 },
  binding: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#f0d9a8",
    backgroundColor: "#fffbeb",
    padding: 12,
    gap: 4,
    marginTop: 16,
  },
  bindingTitle: { fontSize: 12, fontWeight: "600", color: "#78350f" },
  bindingText: { fontSize: 12, color: "#92400e" },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: "#4b4b4b", marginTop: 16, marginBottom: 6 },
  protocolRow: { flexDirection: "row", gap: 8 },
  flexControl: { flex: 1, minWidth: 0 },
  hint: { fontSize: 12, color: "#777", marginBottom: 8 },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  addRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  error: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#f4d5d1",
    backgroundColor: "#fff8f7",
    color: "#b42318",
    fontSize: 12,
    padding: 10,
    marginTop: 12,
  },
  notice: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d9ecdf",
    backgroundColor: "#f2faf5",
    color: "#087d61",
    fontSize: 12,
    padding: 10,
    marginTop: 12,
  },
  footerRow: { flexDirection: "row", gap: 8, marginTop: 16 },
});
