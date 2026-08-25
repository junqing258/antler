export type AppConfig = {
  host: string;
  port: number;
  accessToken?: string;
  openAiApiKey?: string;
  model: string;
  maxRunDurationMs: number;
};

export const config: AppConfig = {
  host: process.env.ANTLER_HOST ?? '127.0.0.1',
  port: Number(process.env.ANTLER_PORT ?? 3210),
  accessToken: process.env.ANTLER_ACCESS_TOKEN,
  openAiApiKey: process.env.OPENAI_API_KEY,
  model: process.env.ANTLER_MODEL ?? 'gpt-4.1-mini',
  maxRunDurationMs: Number(process.env.ANTLER_MAX_RUN_DURATION_MS ?? 120_000)
};
