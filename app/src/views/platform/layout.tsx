import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { SettingsIcon } from "lucide-react";
import { currentUserProfile } from "@/lib/auth";
import { SettingsDialog, type SettingsTab } from "@/components/settings-dialog";
import { loadProviderConfig, saveProviderConfig } from "@/lib/provider-config";
export const control =
  "rounded-lg border border-[#ddd] bg-white px-3 py-2 text-sm focus:outline-primary disabled:opacity-40";
export const primary = `${control} bg-primary! text-white`;
export function PlatformLayout({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [settingsTab, setSettingsTab] = useState<SettingsTab>();
  const [providerConfig, setProviderConfig] = useState(loadProviderConfig);
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof currentUserProfile>>>();
  useEffect(() => {
    let cancelled = false;
    void currentUserProfile().then((user) => {
      if (!cancelled) setProfile(user);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return (
    <main className="flex h-[var(--app-viewport-height)] flex-col overflow-hidden bg-[#fafaf9] text-[#222]">
      <header className="relative z-10 shrink-0 border-b border-[#e8e8e5] bg-white px-4 py-4 sm:px-6">
        <nav
          className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 text-sm sm:gap-6"
          aria-label="平台导航"
        >
          <Link to="/" className="flex items-center gap-2 font-semibold text-primary">
            <img src="/antler-logo.svg" alt="" className="size-8" />
            Antler
          </Link>
          <Link to="/">Agent</Link>
          <Link to="/skills">技能库</Link>
          <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
            <button
              type="button"
              className="flex min-w-0 items-center gap-2 rounded-lg text-left focus-visible:outline-primary"
              aria-label="用户信息"
              onClick={() => setSettingsTab("profile")}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#e7f3ef] text-sm font-semibold text-[#00856b]" aria-hidden="true">
                {profile?.initial || "U"}
              </span>
            </button>
            <button
              type="button"
              className="grid size-8 shrink-0 place-items-center rounded-full bg-[#f3f4f4] text-[#777] hover:bg-[#e8eaea] focus-visible:outline-primary"
              aria-label="设置"
              onClick={() => setSettingsTab("provider")}
            >
              <SettingsIcon className="size-4" aria-hidden="true" />
            </button>
          </div>
        </nav>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <h1 className="mb-8 text-3xl font-semibold tracking-tight">{title}</h1>
          {children}
        </div>
      </div>
      {settingsTab && (
        <SettingsDialog
          config={providerConfig}
          initialTab={settingsTab}
          onSave={(config) => {
            saveProviderConfig(config);
            setProviderConfig(config);
            setSettingsTab(undefined);
          }}
          onClose={() => setSettingsTab(undefined)}
        />
      )}
    </main>
  );
}
export function ErrorNotice({ error }: { error: string }) {
  return error ? (
    <p
      role="alert"
      className="my-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
    >
      {error}
    </p>
  ) : null;
}
