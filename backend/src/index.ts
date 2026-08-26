import { createApp } from './app.js';
import { config } from './config/env.js';

const app = createApp(config);

try {
  await app.listen({ port: config.port, host: config.host });
  console.log(`Antler local agent listening on http://${config.host}:${config.port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
