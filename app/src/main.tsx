import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { AuthGate } from "@/auth/auth-gate";
import { PwaUpdatePrompt } from "@/components/pwa-update-prompt";
import { ChatView } from "@/views/chat";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthGate>
        <ChatView />
      </AuthGate>
      <PwaUpdatePrompt />
    </BrowserRouter>
  </StrictMode>,
);
