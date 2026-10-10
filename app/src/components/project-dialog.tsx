import { useEffect, useState, type FormEvent } from "react";
import { BotIcon, PuzzleIcon, SettingsIcon, XIcon } from "lucide-react";
import { DirectoryPicker } from "@/components/directory-picker";
import type { Project } from "@/lib/conversation-store";

type ProjectTab = "general" | "skill" | "subagent";
type SkillFilter = "workspace" | "global" | "all";
type SkillScope = "workspace" | "user" | "bundled";
type ServerInfo = { baseUrl: string; token: string };
type SkillCatalog = {
  skills: {
    id: string;
    name: string;
    description: string;
    scope: SkillScope;
  }[];
  diagnostics: { code: string; name?: string; message: string; scope: SkillScope }[];
};

const tabs = [
  { id: "general", label: "常规", icon: SettingsIcon },
  { id: "skill", label: "Skill", icon: PuzzleIcon },
  { id: "subagent", label: "Subagent", icon: BotIcon },
] as const;
const scopeLabels = { workspace: "项目", user: "用户", bundled: "内置" };
const skillFilters = [
  { id: "workspace", label: "项目", empty: "当前项目暂无可用 Skill。" },
  { id: "global", label: "全局", empty: "暂无可用的全局 Skill。" },
  { id: "all", label: "全部", empty: "暂无可用 Skill。" },
] as const;

function ProjectSkills({
  workingDirectory,
  getServerInfo,
}: {
  workingDirectory: string;
  getServerInfo: () => Promise<ServerInfo>;
}) {
  const [catalog, setCatalog] = useState<SkillCatalog>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<SkillFilter>("all");

  useEffect(() => {
    const controller = new AbortController();
    setCatalog(undefined);
    setError("");
    void (async () => {
      try {
        const server = await getServerInfo();
        if (controller.signal.aborted) return;
        const directory = workingDirectory.trim();
        const query = directory
          ? `?workingDirectory=${encodeURIComponent(directory)}`
          : "";
        const response = await fetch(`${server.baseUrl}/api/skills${query}`, {
          headers: { "x-antler-token": server.token },
          signal: controller.signal,
        });
        const body = (await response.json()) as SkillCatalog & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "无法加载 Skill");
        if (!controller.signal.aborted) setCatalog(body);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "无法加载 Skill");
        }
      }
    })();
    return () => controller.abort();
  }, [workingDirectory, getServerInfo, attempt]);

  const matchesFilter = (scope: SkillScope) =>
    filter === "all" || (filter === "global" ? scope !== "workspace" : scope === "workspace");
  const skills = catalog?.skills.filter((skill) => matchesFilter(skill.scope)) ?? [];
  const diagnostics = catalog?.diagnostics.filter((diagnostic) => matchesFilter(diagnostic.scope)) ?? [];

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-[#eee] bg-[#fafafa] p-1" role="tablist" aria-label="Skill 来源筛选">
        {skillFilters.map(({ id, label }, index) => (
          <button
            key={id}
            id={`skill-filter-${id}`}
            type="button"
            role="tab"
            aria-selected={filter === id}
            aria-controls="skill-filter-panel"
            tabIndex={filter === id ? 0 : -1}
            className={`rounded-md border-0 px-3 py-2 text-xs ${filter === id ? "bg-[#e8f3ef] font-semibold text-[#087d61]" : "bg-transparent text-[#555] hover:bg-[#f0f0f0]"}`}
            onClick={() => setFilter(id)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "ArrowRight") next = (index + 1) % skillFilters.length;
              else if (event.key === "ArrowLeft") next = (index + skillFilters.length - 1) % skillFilters.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = skillFilters.length - 1;
              else return;
              event.preventDefault();
              setFilter(skillFilters[next].id);
              document.getElementById(`skill-filter-${skillFilters[next].id}`)?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-4" role="tabpanel" id="skill-filter-panel" aria-labelledby={`skill-filter-${filter}`} tabIndex={0}>
        {!catalog && !error && <p className="m-0 text-xs text-[#777]" role="status">正在加载 Skill…</p>}
        {error && (
          <div className="grid gap-2 rounded-lg border border-[#f4d5d1] bg-[#fff8f7] p-4 text-xs text-[#b42318]">
            <p className="m-0" role="alert">{error}</p>
            <button className="justify-self-start border-0 bg-transparent p-0 text-primary" type="button" onClick={() => setAttempt((value) => value + 1)}>
              重试
            </button>
          </div>
        )}
        {catalog && skills.length === 0 && (
          <p className="m-0 rounded-xl border border-dashed border-[#ddd] p-5 text-xs text-[#777]">{skillFilters.find((item) => item.id === filter)?.empty}</p>
        )}
        {catalog && skills.length > 0 && (
          <ul className="m-0 grid min-w-0 grid-cols-1 list-none gap-3 p-0">
            {skills.map((skill) => (
              <li key={skill.id} className="rounded-xl border border-[#e8e8e8] p-4">
                <div className="flex items-start justify-between gap-3">
                  <h4 className="m-0 min-w-0 break-words text-[13px] font-semibold text-[#333]">{skill.name}</h4>
                  <span className="shrink-0 rounded-md bg-[#f3f4f4] px-2 py-0.5 text-[11px] text-[#666]">{scopeLabels[skill.scope]}</span>
                </div>
                <p className="m-0 mt-2 whitespace-pre-wrap break-words text-xs leading-6 text-[#777]">{skill.description}</p>
              </li>
            ))}
          </ul>
        )}
        {catalog && diagnostics.length > 0 && (
          <div className="grid gap-2 rounded-lg border border-[#f0dfb6] bg-[#fffbf2] p-4" role="status">
            <h4 className="m-0 text-xs font-semibold text-[#8a641b]">部分 Skill 无法加载</h4>
            {diagnostics.map((diagnostic, index) => (
              <p key={`${diagnostic.code}-${index}`} className="m-0 break-words text-xs leading-6 text-[#8a641b]">
                {diagnostic.name ? `${diagnostic.name}：` : ""}{diagnostic.message}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ProjectDialog({
  project,
  getServerInfo,
  onSave,
  onClose,
}: {
  project?: Project;
  getServerInfo: () => Promise<ServerInfo>;
  onSave: (values: { name: string; workingDirectory: string }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [workingDirectory, setWorkingDirectory] = useState(project?.workingDirectory ?? "");
  const [activeTab, setActiveTab] = useState<ProjectTab>("general");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    onSave({ name: name.trim(), workingDirectory: workingDirectory.trim() });
  };

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/38 p-4 sm:p-8" role="presentation" onMouseDown={onClose}>
      <section
        className="grid max-h-[calc(100svh-32px)] w-full max-w-[820px] grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[14px] border border-[#e4e4e4] bg-white shadow-[0_24px_70px_rgb(0_0_0_/_20%)] sm:max-h-[calc(100svh-64px)] sm:grid-cols-[190px_minmax(0,1fr)] sm:grid-rows-1"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <aside className="flex flex-col border-b border-[#eee] bg-[#fafafa] p-4 sm:border-b-0 sm:border-r sm:p-5" aria-label="项目设置菜单">
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 min-w-0 text-[#252525]" id="project-dialog-title">{project ? "项目设置" : "新建项目"}</h2>
            <button className="grid size-[22.4px] shrink-0 place-items-center rounded-md border-0 bg-transparent text-[#777] hover:bg-[#eee] hover:text-[#222]" type="button" onClick={onClose} aria-label="关闭">
              <XIcon className="size-[19.2px]" />
            </button>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-1 sm:mt-5 sm:grid-cols-1" role="tablist" aria-label="项目设置">
            {tabs.map(({ id, label, icon: Icon }, index) => (
              <button
                key={id}
                id={`project-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                aria-controls={`project-panel-${id}`}
                tabIndex={activeTab === id ? 0 : -1}
                className={`flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border-0 px-2 py-2 text-left text-xs! sm:justify-start sm:gap-2 sm:px-3 sm:text-[13px]! ${activeTab === id ? "bg-[#e8f3ef] font-semibold! text-[#087d61]" : "bg-transparent text-[#555] hover:bg-[#f0f0f0]"}`}
                onClick={() => setActiveTab(id)}
                onKeyDown={(event) => {
                  let next = index;
                  if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % tabs.length;
                  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + tabs.length - 1) % tabs.length;
                  else if (event.key === "Home") next = 0;
                  else if (event.key === "End") next = tabs.length - 1;
                  else return;
                  event.preventDefault();
                  setActiveTab(tabs[next].id);
                  document.getElementById(`project-tab-${tabs[next].id}`)?.focus();
                }}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </aside>
        <div className="min-h-0 min-w-0 overflow-y-auto p-5 sm:p-7">
          <section role="tabpanel" id="project-panel-general" aria-labelledby="project-tab-general" hidden={activeTab !== "general"}>
            <form className="grid min-w-0 max-w-[560px] grid-cols-1 gap-5" onSubmit={submit}>
              <div className="border-b border-[#eee] pb-4">
                <h3 className="m-0 text-lg">常规</h3>
                <p className="m-0 mt-1 text-xs leading-6 text-[#777]">此项目中的会话将使用相同的工作目录。</p>
              </div>
              <label className="grid min-w-0 grid-cols-1 gap-1.5 text-xs font-semibold text-[#4b4b4b]">
                项目名称
                <input className="h-10 w-full rounded-lg border border-[#ddd] px-[11px] text-[13px] font-normal text-[#222] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="我的项目"
                />
              </label>
              <label className="grid min-w-0 grid-cols-1 gap-1.5 text-xs font-semibold text-[#4b4b4b]">
                工作目录
                <DirectoryPicker value={workingDirectory} onChange={setWorkingDirectory} getServerInfo={getServerInfo} />
                <small className="text-[11px] font-normal leading-6 text-[#888]">选择服务端工作区内的文件夹，或使用服务端默认目录。</small>
              </label>
              <div className="flex justify-end gap-2 border-t border-[#eee] pt-4">
                <button className="h-9 rounded-[7px] border border-[#ddd] bg-white px-[13px] text-[13px] text-[#333] hover:bg-[#f6f6f6]" type="button" onClick={onClose}>取消</button>
                <button className="h-9 rounded-[7px] border border-primary bg-primary px-[13px] text-[13px] text-white disabled:cursor-not-allowed disabled:opacity-45" type="submit" disabled={!name.trim()}>{project ? "保存" : "创建项目"}</button>
              </div>
            </form>
          </section>
          <section role="tabpanel" id="project-panel-skill" aria-labelledby="project-tab-skill" hidden={activeTab !== "skill"}>
            {activeTab === "skill" && (
              <div className="grid max-w-[560px] gap-5">
                <div className="border-b border-[#eee] pb-4">
                  <h3 className="m-0 text-lg">Skill</h3>
                  <p className="m-0 mt-1 text-xs leading-6 text-[#777]">{workingDirectory.trim() ? "查看当前工作目录下可用的项目、用户和内置 Skill。" : "查看可用的用户和内置 Skill，选择工作目录后可查看项目 Skill。"}</p>
                </div>
                <ProjectSkills workingDirectory={workingDirectory} getServerInfo={getServerInfo} />
              </div>
            )}
          </section>
          <section role="tabpanel" id="project-panel-subagent" aria-labelledby="project-tab-subagent" hidden={activeTab !== "subagent"}>
            <div className="grid max-w-[560px] gap-5">
              <div className="border-b border-[#eee] pb-4">
                <h3 className="m-0 text-lg">Subagent</h3>
                <p className="m-0 mt-1 text-xs leading-6 text-[#777]">管理项目的子代理。</p>
              </div>
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[#ddd] px-5 py-10 text-center text-[#777]">
                <BotIcon className="size-8 text-[#999]" aria-hidden="true" />
                <p className="m-0 text-[13px]">Subagent 配置即将推出。</p>
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
