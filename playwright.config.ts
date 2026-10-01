import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const browser = process.env.AUTUMN_TEST_BROWSER || [
  "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find(existsSync);

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:1420", launchOptions: browser ? { executablePath: browser } : {} },
  projects: [
    { name: "desktop", use: { viewport: { width: 1200, height: 800 } } },
    { name: "android", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      userAgent: "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36" } },
  ],
  webServer: { command: "npm run dev -- --host 127.0.0.1 --port 1420", url: "http://127.0.0.1:1420", reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: "https://autumn-test.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only" } },
});
