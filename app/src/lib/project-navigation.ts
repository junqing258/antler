export const COLLAPSED_PROJECTS_STORAGE_KEY = "antler.collapsed-projects.v1";

export function loadCollapsedProjectIds(): Set<string> {
  try {
    const stored = localStorage.getItem(COLLAPSED_PROJECTS_STORAGE_KEY);
    const value: unknown = stored ? JSON.parse(stored) : [];
    if (Array.isArray(value)) {
      return new Set(value.filter((id): id is string => typeof id === "string"));
    }
  } catch {
    // Keep navigation usable when local storage is unavailable or invalid.
  }
  return new Set();
}

export function saveCollapsedProjectIds(projectIds: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_PROJECTS_STORAGE_KEY, JSON.stringify([...projectIds]));
  } catch {
    // Folding still works for this session if the browser blocks local storage.
  }
}
