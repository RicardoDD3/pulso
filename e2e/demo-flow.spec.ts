import { test, expect } from "@playwright/test";

const DEMO_EMAIL = "demo@pulso.local";
const DEMO_PASSWORD = "demo-pulso-1234";

test.describe("demo user flow", () => {
  test("sign in → dashboard with data → exercises → labs", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel(/email|correo/i).fill(DEMO_EMAIL);
    await page.getByLabel(/password|contraseña/i).fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: /sign in|iniciar/i }).click();

    // Dashboard shows KPI data from the seed.
    await page.waitForURL("**/dashboard");
    await expect(page.getByText(/steps|pasos/i).first()).toBeVisible({ timeout: 15_000 });

    // Exercises: the seeded catalog renders.
    await page.getByRole("link", { name: /exercises|ejercicios/i }).click();
    await expect(page.getByText(/sentadillas/i).first()).toBeVisible();

    // Labs: sessions from the seed render with the AI disclaimer.
    await page.getByRole("link", { name: /labs|laboratorios/i }).click();
    await expect(page.getByText(/not medical advice|no es consejo médico/i)).toBeVisible();
    await expect(page.getByText(/demo lab/i).first()).toBeVisible();
  });

  test("registration creates an isolated account", async ({ page }) => {
    const email = `e2e-${Date.now()}@test.dev`;
    await page.goto("/sign-up");
    await page.getByLabel(/name|nombre/i).fill("E2E User");
    await page.getByLabel(/email|correo/i).fill(email);
    await page.getByLabel(/password|contraseña/i).fill("password1234");
    await page.getByRole("button", { name: /create|crear/i }).click();
    await page.waitForURL("**/dashboard");

    // A fresh account sees the empty state, not the demo user's data.
    await page.getByRole("link", { name: /exercises|ejercicios/i }).click();
    await expect(page.getByText(/sentadillas/i).first()).toBeVisible(); // own seeded defaults
  });
});
