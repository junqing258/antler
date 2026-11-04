// Only credentials and companion settings consumed by supported shell skills.
// Model, database, SMTP and authentication secrets stay in their dedicated tools.
const SKILL_ENV_NAMES = [
  "TUSHARE_TOKEN",
  "TAVILY_API_KEY",
  "SERPAPI_KEY",
  "COS_SECRET_ID",
  "COS_SECRET_KEY",
  "COS_TOKEN",
  "COS_REGION",
  "COS_BUCKET",
  "COS_APP_ID",
  "COS_SCHEME",
  "COS_ENDPOINT",
] as const;

export function skillEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(
    SKILL_ENV_NAMES.flatMap((name) => {
      const value = environment[name];
      return value ? [[name, value]] : [];
    }),
  );
}
