import { useState, type FormEvent } from "react";
import {
  CircleHelpIcon,
  SettingsIcon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import {
  defaultProviderConfig,
  type ProviderConfig,
} from "@/lib/provider-config";

export type SettingsTab = "provider" | "profile" | "about";

export function SettingsDialog({
  config,
  initialTab = "provider",
  onSave,
  onClose,
}: {
  config: ProviderConfig;
  initialTab?: SettingsTab;
  onSave: (config: ProviderConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(config);
  const [newModel, setNewModel] = useState("");
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [displayName, setDisplayName] = useState("User");
  const update = (key: keyof ProviderConfig, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const addModel = () => {
    const model = newModel.trim();
    if (!model || draft.models.includes(model)) return;
    setDraft((current) => ({
      ...current,
      models: [...current.models, model],
      model: current.model || model,
    }));
    setNewModel("");
  };
  const removeModel = (model: string) =>
    setDraft((current) => {
      const models = current.models.filter((item) => item !== model);
      return {
        ...current,
        models,
        model: current.model === model ? (models[0] ?? "") : current.model,
      };
    });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({
      ...draft,
      name: draft.name.trim() || "自定义供应商",
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim(),
      models: draft.models.map((model) => model.trim()).filter(Boolean),
      model: draft.model.trim(),
    });
  };
  const tabs: { id: SettingsTab; label: string; icon: typeof SettingsIcon }[] =
    [
      { id: "provider", label: "供应商配置", icon: SettingsIcon },
      { id: "profile", label: "个人资料", icon: UserRoundIcon },
      { id: "about", label: "关于", icon: CircleHelpIcon },
    ];
  return (
    <div
      className="fixed inset-0 z-20 grid place-items-center bg-black/38 p-4 sm:p-8"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="grid max-h-[calc(100svh-32px)] w-full max-w-[820px] grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[14px] border border-[#e4e4e4] bg-white shadow-[0_24px_70px_rgb(0_0_0_/_20%)] sm:max-h-[calc(100svh-64px)] sm:grid-cols-[190px_minmax(0,1fr)] sm:grid-rows-1"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <aside className="flex flex-col border-b border-[#eee] bg-[#fafafa] p-4 sm:border-b-0 sm:border-r sm:p-5" aria-label="设置菜单">
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 min-w-0 text-[#252525]" id="settings-title">设置</h2>
            <button
              className="grid size-[22.4px] shrink-0 place-items-center rounded-md border-0 bg-transparent text-[#777] hover:bg-[#eee] hover:text-[#222]"
              type="button"
              onClick={onClose}
              aria-label="关闭设置"
            >
              <XIcon className="size-[19.2px]" />
            </button>
          </div>
          <div
            className="mt-4 grid grid-cols-3 gap-1 sm:mt-5 sm:grid-cols-1"
            role="tablist"
          >
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                className={`flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border-0 px-2 py-2 text-left text-xs! sm:justify-start sm:gap-2 sm:px-3 sm:text-[13px]! ${activeTab === id ? "bg-[#e8f3ef] font-semibold! text-[#087d61]" : "bg-transparent text-[#555] hover:bg-[#f0f0f0]"}`}
                onClick={() => setActiveTab(id)}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </aside>
        <div className="min-h-0 min-w-0 overflow-y-auto p-5 sm:p-7">
          {activeTab === "provider" && (
            <form
              className="grid max-w-[560px] gap-5"
              aria-labelledby="provider-title"
              onSubmit={submit}
            >
              <div className="border-b border-[#eee] pb-4">
                <div>
                  <h3 className="m-0 text-lg" id="provider-title">供应商配置</h3>
                  <p className="m-0 mt-1 text-xs text-[#777]">配置仅保存在当前浏览器的本地存储中。</p>
                </div>
              </div>
              <label className="grid gap-1.5 text-xs font-semibold text-[#4b4b4b]">
                名称
                <input className="h-10 w-full rounded-lg border border-[#ddd] px-[11px] text-[13px] font-normal text-[#222] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
                  value={draft.name}
                  onChange={(event) => update("name", event.target.value)}
                  placeholder="例如：OpenAI"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-[#4b4b4b]">
                协议
                <select className="h-10 w-full rounded-lg border border-[#ddd] bg-white px-[11px] text-[13px] font-normal text-[#222] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
                  value={draft.protocol}
                  onChange={(event) => update("protocol", event.target.value)}
                >
                  <option value="openai-responses">OpenAI Responses</option>
                  <option value="anthropic-messages">Anthropic Messages</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-[#4b4b4b]">
                Base URL（可选）
                <input className="h-10 w-full rounded-lg border border-[#ddd] px-[11px] text-[13px] font-normal text-[#222] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
                  type="url"
                  value={draft.baseUrl}
                  onChange={(event) => update("baseUrl", event.target.value)}
                  placeholder="https://api.openai.com/v1"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-[#4b4b4b]">
                API Key
                <input className="h-10 w-full rounded-lg border border-[#ddd] px-[11px] text-[13px] font-normal text-[#222] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
                  type="password"
                  value={draft.apiKey}
                  onChange={(event) => update("apiKey", event.target.value)}
                  placeholder="仅保存在本地"
                  autoComplete="off"
                />
              </label>
              <div className="grid gap-2 text-xs font-semibold text-[#4b4b4b]">
                <span>模型</span>
                {draft.models.length === 0 && (
                  <p className="m-0 font-normal text-[#777]">
                    默认使用服务端配置。使用本地 API Key 时，请添加模型。
                  </p>
                )}
                <div className="grid gap-1.5">
                  {draft.models.map((model) => (
                    <div key={model} className="flex items-center justify-between rounded-lg border border-[#eee] px-3 py-2">
                      <label className="flex items-center gap-2 font-normal">
                        <input
                          type="radio"
                          name="default-model"
                          checked={draft.model === model}
                          onChange={() => update("model", model)}
                        />
                        <span>{model}</span>
                      </label>
                      <button
                        className="border-0 bg-transparent text-xs text-[#b42318] disabled:opacity-40"
                        type="button"
                        onClick={() => removeModel(model)}
                        aria-label={`删除 ${model}`}
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input className="h-9 min-w-0 flex-1 rounded-lg border border-[#ddd] px-[11px] text-[13px] font-normal text-[#222] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
                    value={newModel}
                    onChange={(event) => setNewModel(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addModel();
                      }
                    }}
                    placeholder="输入供应商支持的模型 ID"
                  />
                  <button className="h-9 rounded-[7px] border border-[#ddd] bg-white px-3 text-[13px] text-[#333] hover:bg-[#f6f6f6]" type="button" onClick={addModel}>
                    添加模型
                  </button>
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-[#eee] pt-4">
                <button className="h-9 rounded-[7px] border border-[#ddd] bg-white px-[13px] text-[13px] text-[#333] hover:bg-[#f6f6f6]"
                  type="button"
                  onClick={() => setDraft(defaultProviderConfig)}
                >
                  恢复默认
                </button>
                <button className="h-9 rounded-[7px] border border-primary bg-primary px-[13px] text-[13px] text-white" type="submit">
                  保存配置
                </button>
              </div>
            </form>
          )}
          {activeTab === "profile" && (
            <section className="grid max-w-[560px] gap-5" aria-labelledby="profile-title">
              <div className="border-b border-[#eee] pb-4">
                <div>
                  <h3 className="m-0 text-lg" id="profile-title">个人资料</h3>
                  <p className="m-0 mt-1 text-xs text-[#777]">管理此设备上的个人信息。</p>
                </div>
              </div>
              <div className="grid size-16 place-items-center rounded-full bg-[#e8f3ef] text-xl font-semibold text-[#087d61]">
                {displayName.slice(0, 1).toUpperCase() || "U"}
              </div>
              <label className="grid gap-1.5 text-xs font-semibold text-[#4b4b4b]">
                显示名称
                <input className="h-10 w-full rounded-lg border border-[#ddd] px-[11px] text-[13px] font-normal text-[#222] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="输入你的名称"
                />
              </label>
              <p className="m-0 text-xs text-[#777]">
                个人资料当前仅保存在本次应用会话中。
              </p>
            </section>
          )}
          {activeTab === "about" && (
            <section
              className="grid max-w-[560px] gap-5"
              aria-labelledby="about-title"
            >
              <div className="border-b border-[#eee] pb-4">
                <div>
                  <h3 className="m-0 text-lg" id="about-title">关于</h3>
                  <p className="m-0 mt-1 text-xs text-[#777]">应用信息与版本</p>
                </div>
              </div>
              <div className="flex items-center gap-4 rounded-xl border border-[#e7eeeb] bg-[#f6faf8] p-5">
                <img className="size-16 shrink-0 rounded-2xl" src="/favicon.png" alt="Antler 应用图标" />
                <div className="min-w-0">
                  <h4 className="m-0 text-2xl font-semibold tracking-tight text-[#222]">Antler</h4>
                  <p className="m-0 mt-1 text-[13px] text-[#68756f]">桌面助手</p>
                </div>
              </div>
              <dl className="m-0 divide-y divide-[#eee] overflow-hidden rounded-xl border border-[#e8e8e8] px-4 sm:px-5">
                <div className="flex items-center justify-between gap-4 py-4">
                  <dt className="shrink-0 text-xs text-[#777]">应用名称</dt>
                  <dd className="m-0 text-right text-[13px] font-medium text-[#333]">Antler</dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-4">
                  <dt className="shrink-0 text-xs text-[#777]">当前版本</dt>
                  <dd className="m-0 rounded-md bg-[#f3f4f4] px-2 py-0.5 text-xs font-medium tabular-nums text-[#555]">v0.1.0</dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-4">
                  <dt className="shrink-0 text-xs text-[#777]">运行环境</dt>
                  <dd className="m-0 text-right text-[13px] font-medium text-[#333]">Web 应用</dd>
                </div>
              </dl>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
