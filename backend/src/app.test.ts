import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const temporaryDirectories: string[] = [];

async function staticDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'antler-static-'));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, 'assets'));
  await writeFile(join(directory, 'index.html'), '<!doctype html><title>Antler Web</title>');
  await writeFile(join(directory, 'assets', 'app.js'), 'console.log("antler")');
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('backend Web hosting', () => {
  it('serves the Web build, SPA fallback, health and API 404s directly', async () => {
    const app = createApp({
      host: '127.0.0.1',
      port: 3210,
      provider: 'openai',
      workspaceRoot: process.cwd(),
      staticDir: await staticDirectory(),
      model: 'test-model',
      maxRunDurationMs: 1_000,
    });

    const home = await app.inject({ method: 'GET', url: '/' });
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain('Antler Web');
    expect(home.headers['cache-control']).toBe('public, max-age=0');

    const asset = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');

    const spa = await app.inject({
      method: 'GET',
      url: '/projects/example',
      headers: { accept: 'text/html' },
    });
    expect(spa.statusCode).toBe(200);
    expect(spa.body).toContain('Antler Web');

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: 'ok' });

    const missingApi = await app.inject({ method: 'GET', url: '/api/missing' });
    expect(missingApi.statusCode).toBe(404);
    expect(missingApi.json()).toEqual({ error: '路由不存在。' });
    await app.close();
  });
});
