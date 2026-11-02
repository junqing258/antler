import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router";
import { AuthGate } from "@/auth/auth-gate";
import { PwaUpdatePrompt } from "@/components/pwa-update-prompt";
import "./styles.css";

const AgentListPage = lazy(async () => ({
  default: (await import("@/views/platform/agent-list")).AgentListPage,
}));
const AgentEditPage = lazy(async () => ({
  default: (await import("@/views/platform/agent-edit")).AgentEditPage,
}));
const SkillLibraryPage = lazy(async () => ({
  default: (await import("@/views/platform/skill-library")).SkillLibraryPage,
}));
const AgentChatPage = lazy(async () => ({
  default: (await import("@/views/platform/agent-chat")).AgentChatPage,
}));

function LegacyChatRedirect() {
  const location = useLocation();
  return <Navigate to={`/${location.search}`} replace />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthGate>
        <Suspense
          fallback={
            <main className="grid min-h-[var(--app-viewport-height)] place-items-center bg-[#fafaf9] text-sm text-[#777]">
              正在加载…
            </main>
          }
        >
          <Routes>
            <Route path="/" element={<AgentListPage />} />
            <Route path="/chat" element={<LegacyChatRedirect />} />
            <Route path="/agents/new" element={<AgentEditPage />} />
            <Route path="/agents/:id/edit" element={<AgentEditPage />} />
            <Route path="/agents/:id" element={<AgentChatPage />} />
            <Route path="/skills" element={<SkillLibraryPage />} />
          </Routes>
        </Suspense>
      </AuthGate>
      <PwaUpdatePrompt />
    </BrowserRouter>
  </StrictMode>,
);
