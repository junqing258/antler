const files = new Set<string>();

/** Record the environment files actually loaded by the server. */
export function registerProtectedEnvFile(path: string) {
  files.add(path);
}

export function getProtectedEnvFiles(): readonly string[] {
  return [...files];
}
