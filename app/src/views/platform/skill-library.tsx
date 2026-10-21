import { useEffect, useState } from "react";
import { platformApi, type PlatformSkill } from "@/lib/platform-api";
import { ErrorNotice, PlatformLayout, control } from "./layout";
export function SkillLibraryPage() {
  const [skills, setSkills] = useState<PlatformSkill[]>([]),
    [name, setName] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = () =>
    platformApi<{ skills: PlatformSkill[] }>("/skills").then((data) =>
      setSkills(data.skills),
    );
  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, []);
  const upload = async (file: File | undefined, skill?: PlatformSkill) => {
    if (!file) return;
    setError("");
    setNotice("");
    if (file.size > 5 * 1024 * 1024) {
      setError("skill_too_large：压缩包不能超过 5 MiB");
      return;
    }
    if (!skill && !name.trim()) {
      setError("请填写与 SKILL.md 一致的技能名称");
      return;
    }
    setBusy(true);
    try {
      const archive = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]!);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const result = await platformApi<{ diagnostics: { message: string }[] }>(
        skill ? `/skills/${skill.id}` : "/skills",
        skill ? "PUT" : "POST",
        { name: skill?.name ?? name.trim(), archive },
      );
      setNotice(
        result.diagnostics?.map((d) => d.message).join("\n") || "技能已保存。",
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (skill: PlatformSkill) => {
    if (!window.confirm(`删除技能 ${skill.name}？`)) return;
    setBusy(true);
    setError("");
    try {
      await platformApi(`/skills/${skill.id}`, "DELETE");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <PlatformLayout title="技能库">
      <p className="mb-6 text-sm text-[#666]">
        上传含 SKILL.md 和资源文件的 ZIP 包。技能名称须与文件中的 name 一致。
      </p>
      <div className="mb-8 flex flex-wrap items-end gap-4 rounded-xl border bg-white p-6">
        <label className="grid gap-2 text-sm">
          技能名称
          <input
            className={control}
            value={name}
            maxLength={64}
            placeholder="stock-analysis"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className={`${control} cursor-pointer`}>
          上传 ZIP
          <input
            className="ml-3 max-w-60"
            aria-label="上传技能 ZIP"
            type="file"
            accept=".zip"
            disabled={busy}
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        <small className="pb-2 text-[#888]">最大 5 MiB</small>
      </div>
      <ErrorNotice error={error} />
      {notice && (
        <p role="status" className="mb-4 text-sm text-primary">
          {notice}
        </p>
      )}
      <div className="space-y-3">
        {skills.map((skill) => (
          <article
            key={skill.id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-white p-5"
          >
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">
                {skill.name}{" "}
                <span className="ml-2 text-xs font-normal text-[#777]">
                  {skill.state}
                  {!skill.bindable && ` · 不可绑定 (${skill.unbindableReason})`}
                </span>
              </h2>
              <p className="my-2 break-words text-sm text-[#666]">
                {skill.description}
              </p>
              <small className="text-[#888]">
                {skill.fileCount} 个文件 · {(skill.sizeBytes / 1024).toFixed(1)}{" "}
                KiB · {new Date(skill.createdAt).toLocaleString()}
              </small>
            </div>
            {skill.editable && (
              <div className="flex items-center gap-3">
                <label className={`${control} cursor-pointer`}>
                  覆盖更新
                  <input
                    aria-label={`更新 ${skill.name}`}
                    className="sr-only"
                    type="file"
                    accept=".zip"
                    disabled={busy}
                    onChange={(e) => {
                      void upload(e.target.files?.[0], skill);
                      e.target.value = "";
                    }}
                  />
                </label>
                <button
                  className={`${control} text-red-700`}
                  disabled={busy}
                  onClick={() => void remove(skill)}
                >
                  删除
                </button>
              </div>
            )}
          </article>
        ))}
        {!skills.length && (
          <p className="p-12 text-center text-[#888]">还没有平台技能。</p>
        )}
      </div>
    </PlatformLayout>
  );
}
