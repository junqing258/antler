import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { AuthGate } from "@/auth/auth-gate";
import { PwaUpdatePrompt } from "@/components/pwa-update-prompt";
import { supabaseAuthEnabled } from "@/lib/server-info";
import { ChatView } from "@/views/chat";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      {supabaseAuthEnabled ? (
        <AuthGate>
          <ChatView />
        </AuthGate>
      ) : (
        <ChatView />
      )}
      <PwaUpdatePrompt />
    </BrowserRouter>
  </StrictMode>,
);
