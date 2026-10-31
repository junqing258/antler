import { createRoot } from "react-dom/client";
import { Probe } from "../../../mobile/src/probe";

createRoot(document.getElementById("root")!).render(
  <Probe streamFetch={fetch} />,
);
