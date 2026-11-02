import path from "node:path";
import { codeInspectorPlugin } from "code-inspector-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => ({
  plugins: [
    ...(mode === "test"
      ? []
      : [codeInspectorPlugin({ bundler: "vite" })]),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      injectRegister: null,
      manifest: {
        id: "/",
        name: "Antler",
        short_name: "Antler",
        description: "Antler AI 助手",
        lang: "zh-CN",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#14a883",
        background_color: "#ffffff",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: "index.html",
        // 管理员认证等纯文本文件必须向服务器读取，不能回退为应用首页。
        navigateFallbackDenylist: [
          /^\/api(?:\/|$)/,
          /^\/health(?:\/|$)/,
          /\.txt(?:\?|$)/i,
        ],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: [
      ...(mode === "test" ? [{ find: /^lucide-react-native$/, replacement: path.resolve(import.meta.dirname, "node_modules/lucide-react/dist/esm/lucide-react.mjs") }] : []),
      { find: /^react-native$/, replacement: path.resolve(import.meta.dirname, "node_modules/react-native-web/dist/index.js") },
      { find: "@", replacement: path.resolve(import.meta.dirname, "./src") },
    ],
    dedupe: ["react", "react-dom"],
    extensions: [".web.tsx", ".web.ts", ".web.jsx", ".web.js", ".mjs", ".js", ".ts", ".jsx", ".tsx", ".json"],
  },
  build: {
    ...(mode === "p0" ? { outDir: "dist-p0" } : {}),
    rollupOptions: {
      ...(mode === "p0"
        ? { input: path.resolve(import.meta.dirname, "rnw-probe.html") }
        : {}),
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (
            id.includes("/markdown-it/") ||
            id.includes("/markdown-it-") ||
            id.includes("/lowlight/") ||
            id.includes("/highlight.js/")
          )
            return "markdown";
          if (id.includes("/@supabase/")) return "supabase";
          if (id.includes("/lucide-react/")) return "icons";
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/react-router/")
          )
            return "react";
        },
      },
    },
  },
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    globals: true,
    setupFiles: "./test/setup.ts",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
    },
  },
}));
