import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { PwaUpdatePrompt } from "@/components/pwa-update-prompt";
import { ChatView } from "@/views/chat";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ChatView />
      <PwaUpdatePrompt />
    </BrowserRouter>
  </StrictMode>,
);
