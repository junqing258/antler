import { createApp } from "./app.js";
import { config } from "./config/env.js";

try {
  const app = createApp(config);
  await app.listen({ port: config.port, host: config.host });
  console.log(
    `Antler local agent listening on http://${config.host}:${config.port}`,
  );
} catch (error) {
  // Fastify logging is disabled in createApp; startup failures must still be visible.
  console.error("Antler backend failed to start:", error);
  process.exit(1);
}
