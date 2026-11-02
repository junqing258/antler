import { LoaderCircleIcon } from "lucide-react";

export function SessionLoading({ notice }: { notice?: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center bg-white px-6 text-center" aria-busy="true">
      <div className="mb-5 grid size-16 place-items-center rounded-2xl bg-[#f0f8f5]">
        <img src="/antler-logo.svg" alt="" className="size-10" />
      </div>
      <div role="status" className="flex items-center gap-2 text-sm font-medium text-[#404b47]">
        <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin text-[#087d61] motion-reduce:animate-none" />
        正在加载会话…
      </div>
      {notice && <p role="alert" className="mt-3 text-sm text-[#747d79]">{notice}</p>}
    </div>
  );
}
