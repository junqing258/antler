import { AgentListPage } from "@/views/platform/agent-list";
import { AgentEditPage } from "@/views/platform/agent-edit";
import { SkillLibraryPage } from "@/views/platform/skill-library";
import { AgentChatPage } from "@/views/platform/agent-chat";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router";
import { AuthGate } from "@/auth/auth-gate";
import { PwaUpdatePrompt } from "@/components/pwa-update-prompt";
import { SiteFiling } from "@/components/site-filing";
import "./styles.css";

function LegacyChatRedirect() {
  const location = useLocation();
  return <Navigate to={`/${location.search}`} replace />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthGate>
        <Routes>
          <Route path="/" element={<AgentListPage />} />
          <Route path="/chat" element={<LegacyChatRedirect />} />
          <Route path="/agents/new" element={<AgentEditPage />} />
          <Route path="/agents/:id/edit" element={<AgentEditPage />} />
          <Route path="/agents/:id" element={<AgentChatPage />} />
          <Route path="/skills" element={<SkillLibraryPage />} />
        </Routes>
      </AuthGate>
      <SiteFiling />
      <PwaUpdatePrompt />
    </BrowserRouter>
  </StrictMode>,
);
