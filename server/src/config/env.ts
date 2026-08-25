export type AppConfig = {
  host: string;
  port: number;
  accessToken?: string;
};

export const config: AppConfig = {
  host: process.env.ANTLER_HOST ?? '127.0.0.1',
  port: Number(process.env.ANTLER_PORT ?? 3210),
  accessToken: process.env.ANTLER_ACCESS_TOKEN
};
