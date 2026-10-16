import { createApp } from "./app.js";
import { config } from "./config/env.js";
import { initializeTracing } from "./telemetry/tracing.js";

let telemetry: ReturnType<typeof initializeTracing>;

try {
  telemetry = initializeTracing();
  const app = createApp(config);
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      await app.close();
      await telemetry?.shutdown();
      process.exit(0);
    } catch (error) {
      console.error("Antler backend failed to shut down:", error);
      await telemetry?.shutdown().catch(() => {});
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  await app.listen({ port: config.port, host: config.host });
  console.log(
    `Antler local agent listening on http://${config.host}:${config.port}`,
  );
} catch (error) {
  // Fastify logging is disabled in createApp; startup failures must still be visible.
  console.error("Antler backend failed to start:", error);
  await telemetry?.shutdown().catch(() => {});
  process.exit(1);
}
