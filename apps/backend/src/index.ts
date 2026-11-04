import { createApp } from "./app.js";
import { config } from "./config/env.js";
import { initializeTracing } from "./telemetry/tracing.js";

let telemetry: ReturnType<typeof initializeTracing>;

try {
  telemetry = initializeTracing();
  if (!config.databaseUrl) {
    // 数据库已切换为 Postgres；无连接串时宁可拒绝启动，也不能静默丢失数据。
    throw new Error(
      "缺少 DATABASE_URL 环境变量：后端需要指向 Postgres（例如 Supabase）的连接串。",
    );
  }
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
