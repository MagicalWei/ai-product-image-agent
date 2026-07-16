import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function findCachedChromium() {
  const cacheRoot = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  if (!fs.existsSync(cacheRoot)) return undefined;
  const candidates = fs.readdirSync(cacheRoot)
    .filter((name) => name.startsWith('chromium_headless_shell-'))
    .sort()
    .reverse()
    .map((name) => path.join(cacheRoot, name, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'));
  return candidates.find((candidate) => fs.existsSync(candidate));
}

const cachedChromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || findCachedChromium();

export default defineConfig({
  testDir: './e2e',
  timeout: 90000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Run E2E tests sequentially to prevent state collision
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(cachedChromium ? { launchOptions: { executablePath: cachedChromium } } : {}),
      },
    },
  ],
  // Start both frontend and backend before running tests
  webServer: [
    {
      command: 'NODE_ENV=test node backend/server.js',
      cwd: projectRoot,
      port: 3000,
      reuseExistingServer: true,
      timeout: 30000,
    },
    {
      command: 'cd frontend && npx vite --port 5173',
      cwd: projectRoot,
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 15000,
    },
    {
      command: 'cd backend/agent_service && python3 -m uvicorn main:app --host 0.0.0.0 --port 8000',
      cwd: projectRoot,
      url: 'http://localhost:8000/health',
      reuseExistingServer: true,
      timeout: 30000,
    },
  ],
});
