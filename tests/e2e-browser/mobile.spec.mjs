// Mobile e2e: the dashboard must not overflow horizontally on a phone, and the core
// interactions (tabs, settings, options) must work at a narrow viewport.
import { test, expect, devices } from "@playwright/test";

test.use({ ...devices["iPhone 12"] });

const noHorizontalOverflow = async (page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `page overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(2);
};

test("no horizontal overflow on every tab (iPhone)", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("Puck");
  for (const tab of ["radar", "portfolio", "catalysts", "chokepoints", "options", "research", "scout", "diversifier", "digest"]) {
    await page.locator(`.tabs button[data-tab="${tab}"]`).click();
    await expect(page.locator(`#${tab}`)).toHaveClass(/active/);
    await noHorizontalOverflow(page);
  }
});

test("settings modal is usable on a phone", async ({ page }) => {
  await page.goto("/");
  await page.locator("#settingsBtn").click();
  await expect(page.locator("#settingsModal")).toBeVisible();
  await noHorizontalOverflow(page);
  await page.locator("#settingsClose").click();
  await expect(page.locator("#settingsModal")).toBeHidden();
});

test("options evaluate works at mobile width", async ({ page }) => {
  await page.goto("/");
  await page.locator('.tabs button[data-tab="options"]').click();
  await page.locator("#oType").selectOption("put");
  await page.locator("#oS").fill("100");
  await page.locator("#oK").fill("95");
  await page.locator("#oDays").fill("60");
  await page.locator("#oPx").fill("3");
  await page.locator("#oVol").fill("30");
  await page.locator("#oEval").click();
  await expect(page.locator("#optResult .verdict")).toContainText(/CHEAP|FAIR|RICH/);
  await noHorizontalOverflow(page);
});
