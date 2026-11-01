import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

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
}) {
  const [newModel, setNewModel] = useState("");
  const update = (key: keyof ProviderConfigDraft, fieldValue: string) =>
    onChange({ ...value, [key]: fieldValue });
  const addModel = () => {
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
    <ScrollView style={styles.form} nestedScrollEnabled>
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
      <TextInput
        accessibilityLabel="名称"
        style={styles.input}
        value={value.name}
        onChangeText={(text) => update("name", text)}
        placeholder="例如：OpenAI"
        autoCapitalize="none"
      />
      <Text style={styles.fieldLabel}>协议</Text>
      <View style={styles.protocolRow}>
        {PROTOCOLS.map((protocol) => (
          <Pressable
            key={protocol.value}
            accessibilityRole="radio"
            accessibilityLabel={protocol.label}
            accessibilityState={{ checked: value.protocol === protocol.value }}
            aria-checked={value.protocol === protocol.value}
            onPress={() => onChange({ ...value, protocol: protocol.value })}
            style={[
              styles.protocolOption,
              value.protocol === protocol.value && styles.protocolActive,
            ]}
          >
            <Text
              style={
                value.protocol === protocol.value
                  ? styles.protocolActiveText
                  : styles.protocolText
              }
            >
              {protocol.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.fieldLabel}>Base URL（可选）</Text>
      <TextInput
        accessibilityLabel="Base URL（可选）"
        style={styles.input}
        value={value.baseUrl}
        onChangeText={(text) => update("baseUrl", text)}
        placeholder="https://api.openai.com/v1"
        autoCapitalize="none"
      />
      <Text style={styles.fieldLabel}>API Key</Text>
      <TextInput
        accessibilityLabel="API Key"
        style={styles.input}
        value={value.apiKey}
        onChangeText={(text) => update("apiKey", text)}
        placeholder="仅保存在本地"
        secureTextEntry
        autoCapitalize="none"
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
          <Pressable
            accessibilityRole="radio"
            accessibilityLabel={`默认模型 ${model}`}
            accessibilityState={{ checked: value.model === model }}
            aria-checked={value.model === model}
            onPress={() => update("model", model)}
            style={styles.modelSelect}
          >
            <Text style={value.model === model ? styles.radioActive : styles.radio}>
              {value.model === model ? "◉" : "○"}
            </Text>
            <Text numberOfLines={1} style={styles.modelText}>
              {model}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`删除 ${model}`}
            disabled={busy}
            onPress={() => removeModel(model)}
          >
            <Text style={styles.removeText}>删除</Text>
          </Pressable>
        </View>
      ))}
      <View style={styles.addRow}>
        <TextInput
          accessibilityLabel="新模型 ID"
          style={styles.addInput}
          value={newModel}
          onChangeText={setNewModel}
          onSubmitEditing={addModel}
          placeholder="输入供应商支持的模型 ID"
          autoCapitalize="none"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="添加模型"
          onPress={addModel}
          style={styles.addButton}
        >
          <Text>添加模型</Text>
        </Pressable>
      </View>
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {!!notice && (
        <Text accessibilityRole="status" style={styles.notice}>
          {notice}
        </Text>
      )}
      <View style={styles.footerRow}>
        {onReset && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="恢复默认"
            disabled={busy}
            onPress={onReset}
            style={styles.secondaryButton}
          >
            <Text>恢复默认</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={submitLabel}
          disabled={busy}
          onPress={submit}
          style={[styles.submit, busy && styles.disabled]}
        >
          <Text style={styles.submitText}>{busy ? "请稍候…" : submitLabel}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  form: { maxWidth: 560 },
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
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    backgroundColor: "white",
    paddingHorizontal: 11,
    paddingVertical: 10,
    fontSize: 13,
    color: "#222",
  },
  protocolRow: { flexDirection: "row", gap: 8 },
  protocolOption: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "white",
  },
  protocolActive: { borderColor: "#087d61", backgroundColor: "#f2faf5" },
  protocolText: { fontSize: 13, color: "#222" },
  protocolActiveText: { fontSize: 13, color: "#087d61", fontWeight: "600" },
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
  modelSelect: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  radio: { color: "#777" },
  radioActive: { color: "#087d61" },
  modelText: { fontSize: 13, color: "#222", flexShrink: 1 },
  removeText: { fontSize: 12, color: "#b42318" },
  addRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  addInput: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    backgroundColor: "white",
    paddingHorizontal: 11,
    paddingVertical: 8,
    fontSize: 13,
    color: "#222",
  },
  addButton: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 7,
    backgroundColor: "white",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
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
  secondaryButton: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    backgroundColor: "white",
    paddingHorizontal: 13,
    paddingVertical: 8,
    alignItems: "center",
  },
  submit: {
    borderRadius: 8,
    backgroundColor: "#087d61",
    paddingHorizontal: 13,
    paddingVertical: 8,
    alignItems: "center",
  },
  submitText: { color: "white", fontSize: 14, fontWeight: "500" },
  disabled: { opacity: 0.5 },
});
