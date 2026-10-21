import type { ReactNode } from "react";
import { Link } from "react-router";
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
  return (
    <main className="h-dvh overflow-y-auto bg-[#fafaf9] text-[#222]">
      <header className="sticky top-0 z-10 border-b border-[#e8e8e5] bg-white px-6 py-4">
        <nav
          className="mx-auto flex max-w-6xl flex-wrap items-center gap-6 text-sm"
          aria-label="平台导航"
        >
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <img src="/antler-logo.svg" alt="" className="size-8" />
            Antler
          </Link>
          <Link to="/">Agent</Link>
          <Link to="/skills">技能库</Link>
        </nav>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="mb-8 text-3xl font-semibold tracking-tight">{title}</h1>
        {children}
      </div>
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
