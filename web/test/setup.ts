import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// jsdom has no native safe-area measurements; keep mobile components renderable.
vi.mock("../../mobile/node_modules/react-native-safe-area-context", async () => {
  const { createContext } = await import("react");
  const { View } = await vi.importActual<{ View: unknown }>("react-native");
  return {
    SafeAreaView: View,
    SafeAreaInsetsContext: createContext({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});
