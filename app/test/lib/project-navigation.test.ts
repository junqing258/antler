import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COLLAPSED_PROJECTS_STORAGE_KEY,
  loadCollapsedProjectIds,
  saveCollapsedProjectIds,
} from "@/lib/project-navigation";

describe("project navigation storage", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it.each(["invalid json", "null", '{"default":true}'])("defaults to expanded for invalid stored data: %s", (stored) => {
    localStorage.setItem(COLLAPSED_PROJECTS_STORAGE_KEY, stored);
    expect(loadCollapsedProjectIds()).toEqual(new Set());
  });

  it("ignores invalid project IDs and removes duplicates", () => {
    localStorage.setItem(COLLAPSED_PROJECTS_STORAGE_KEY, '["default",null,42,"default","workspace:example"]');
    expect(loadCollapsedProjectIds()).toEqual(new Set(["default", "workspace:example"]));
  });

  it("keeps navigation usable when local storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage blocked");
    });
    expect(loadCollapsedProjectIds()).toEqual(new Set());
    expect(() => saveCollapsedProjectIds(new Set(["default"]))).not.toThrow();
  });
});
