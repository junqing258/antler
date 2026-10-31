/** Host-owned capabilities. Type-only browser stream types are also implemented by Expo fetch. */
export type ServerConnection = {
  baseUrl: string;
  headers: Record<string, string>;
};
export interface StreamPlatform {
  connection(): Promise<ServerConnection>;
  request(url: string, init: RequestInit): Promise<Response>;
  abortController(): AbortController;
  decoder(): Pick<TextDecoder, "decode">;
  schedule(callback: () => void, delayMs: number): () => void;
}
export interface ClientPlatform extends StreamPlatform {
  initialize(): Promise<void>;
  createId(): string;
  onForeground(callback: () => void): () => void;
}
