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
      const response = await fetch(`${server.baseUrl}/api/directories${query}`, {
        headers: { "x-antler-token": server.token },
      });
      const body = (await response.json()) as DirectoryListing & { error?: string };
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
    <div className="directory-picker">
      <div className="directory-picker-control">
        <button
          className="directory-picker-trigger"
          type="button"
          onClick={showBrowser}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <FolderOpenIcon />
          <span className={value ? undefined : "directory-picker-placeholder"}>
            {value || "Server default (./workspace)"}
          </span>
        </button>
        {value && (
          <button
            className="directory-picker-clear"
            type="button"
            onClick={() => onChange("")}
            aria-label="Use server default directory"
            title="Use server default"
          >
            <XIcon />
          </button>
        )}
      </div>

      {open && (
        <div className="directory-browser" role="dialog" aria-label="Choose working directory">
          <div className="directory-browser-toolbar">
            <button
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
              <ArrowUpIcon />
            </button>
            <span title={listing?.workingDirectory}>
              {listing?.workingDirectory ?? "Loading workspace…"}
            </span>
          </div>

          <div className="directory-browser-list">
            {loading && (
              <div className="directory-browser-message">
                <LoaderCircleIcon className="directory-browser-spinner" />
                Loading…
              </div>
            )}
            {!loading && error && (
              <div className="directory-browser-message directory-browser-error">
                {error}
                <button type="button" onClick={() => void load(listing?.path)}>Retry</button>
              </div>
            )}
            {!loading && !error && listing?.directories.length === 0 && (
              <div className="directory-browser-message">No subdirectories</div>
            )}
            {!loading && !error && listing?.directories.map((directory) => (
              <button
                key={directory.path}
                type="button"
                onClick={() => void load(directory.path)}
              >
                <FolderIcon />
                <span>{directory.name}</span>
              </button>
            ))}
          </div>

          <div className="directory-browser-actions">
            <button type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button
              className="directory-browser-select"
              type="button"
              disabled={!listing || loading || !!error}
              onClick={() => {
                if (!listing) return;
                onChange(listing.workingDirectory);
                setOpen(false);
              }}
            >
              <CheckIcon />
              Use this folder
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
