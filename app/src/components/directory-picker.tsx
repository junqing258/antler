import { useState } from "react";
import {
  ArrowUpIcon,
  CheckIcon,
  FolderIcon,
  FolderOpenIcon,
  LoaderCircleIcon,
  XIcon,
} from "lucide-react";

type ServerInfo = { baseUrl: string; token: string };

type DirectoryListing = {
  root: string;
  path: string;
  workingDirectory: string;
  parent: string | null;
  directories: { name: string; path: string }[];
};

export function DirectoryPicker({
  value,
  onChange,
  getServerInfo,
}: {
  value: string;
  onChange: (value: string) => void;
  getServerInfo: () => Promise<ServerInfo>;
}) {
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<DirectoryListing>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async (path = "") => {
    setLoading(true);
    setError("");
    try {
      const server = await getServerInfo();
      const query = path ? `?path=${encodeURIComponent(path)}` : "";
      const response = await fetch(
        `${server.baseUrl}/api/directories${query}`,
        {
          headers: { "x-antler-token": server.token },
        },
      );
      const body = (await response.json()) as DirectoryListing & {
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "无法读取目录");
      setListing(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取目录");
    } finally {
      setLoading(false);
    }
  };

  const showBrowser = () => {
    setOpen(true);
    void load();
  };

  return (
    <div className="relative font-normal">
      <div className="flex h-10 w-full overflow-hidden rounded-lg border border-[#ddd] bg-white focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/15">
        <button
          className="flex min-w-0 flex-1 items-center gap-2.5 border-0 bg-transparent px-[11px] text-left text-[#333]"
          type="button"
          onClick={showBrowser}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <FolderOpenIcon className="size-4 shrink-0" />
          <span className={`min-w-0 overflow-hidden truncate text-[13px] ${value ? "text-[#333]" : "text-[#999]"}`}>
            {value || "Server default (./workspace)"}
          </span>
        </button>
        {value && (
          <button
            className="grid w-[38px] shrink-0 place-items-center border-0 border-l border-[#eee] bg-transparent text-[#888] hover:bg-[#f6f6f6] hover:text-[#333]"
            type="button"
            onClick={() => onChange("")}
            aria-label="Use server default directory"
            title="Use server default"
          >
            <XIcon className="size-4" />
          </button>
        )}
      </div>

      {open && (
        <div
          className="absolute left-0 right-0 z-10 mt-2 grid overflow-hidden rounded-[9px] border border-[#ddd] bg-white shadow-[0_12px_32px_rgb(0_0_0_/_12%)]"
          role="dialog"
          aria-label="Choose working directory"
        >
          <div className="flex items-center gap-2 border-b border-[#eee] bg-[#fafafa] p-2">
            <button
              className="grid size-[30px] shrink-0 place-items-center rounded-md border border-[#ddd] bg-white text-[#555] disabled:cursor-default disabled:opacity-40"
              type="button"
              onClick={() => {
                if (listing?.parent !== null && listing?.parent !== undefined) {
                  void load(listing.parent);
                }
              }}
              disabled={loading || !listing || listing.parent === null}
              aria-label="Parent directory"
              title="Parent directory"
            >
              <ArrowUpIcon className="size-[15px]" />
            </button>
            <span className="min-w-0 overflow-hidden truncate font-mono text-[11px] text-[#666]" title={listing?.workingDirectory}>
              {listing?.workingDirectory ?? "Loading workspace…"}
            </span>
          </div>

          <div className="min-h-24 max-h-[210px] overflow-y-auto p-[5px]">
            {loading && (
              <div className="flex min-h-[86px] items-center justify-center gap-2 text-xs text-[#888]">
                <LoaderCircleIcon className="size-4 animate-spin" />
                Loading…
              </div>
            )}
            {!loading && error && (
              <div className="flex min-h-[86px] flex-col items-center justify-center gap-2 text-center text-xs text-[#b42318]">
                {error}
                <button className="border-0 bg-transparent text-primary" type="button" onClick={() => void load(listing?.path)}>
                  Retry
                </button>
              </div>
            )}
            {!loading && !error && listing?.directories.length === 0 && (
              <div className="flex min-h-[86px] items-center justify-center text-xs text-[#888]">No subdirectories</div>
            )}
            {!loading &&
              !error &&
              listing?.directories.map((directory) => (
                <button
                  className="flex w-full items-center gap-2.5 rounded-md border-0 bg-transparent p-[9px] text-left text-[13px] text-[#333] hover:bg-[#f1f8f6] hover:text-[#087d61]"
                  key={directory.path}
                  type="button"
                  onClick={() => void load(directory.path)}
                >
                  <FolderIcon className="size-[17px] shrink-0" />
                  <span className="truncate">{directory.name}</span>
                </button>
              ))}
          </div>

          <div className="flex justify-end gap-1.5 border-t border-[#eee] bg-[#fafafa] p-2">
            <button className="flex h-[31px] items-center gap-1.5 rounded-md border border-[#ddd] bg-white px-2.5 text-xs text-[#444] hover:bg-[#f6f6f6]" type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="flex h-[31px] items-center gap-1.5 rounded-md border border-primary bg-primary px-2.5 text-xs text-white disabled:cursor-not-allowed disabled:opacity-45"
              type="button"
              disabled={!listing || loading || !!error}
              onClick={() => {
                if (!listing) return;
                onChange(listing.workingDirectory);
                setOpen(false);
              }}
            >
              <CheckIcon className="size-3.5" />
              Use this folder
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
