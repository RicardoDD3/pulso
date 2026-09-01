import { defineConfig } from "@playwright/test";

/**
 * E2E suite (spec doc 12): few and fat, over docker compose with the demo
 * seed. Assumes the stack is up (npm run dev or compose) and seeded:
 *   docker compose up -d postgres redis && npm run seed:demo && npm run dev
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  reporter: process.env.CI ? "github" : "list",
});
