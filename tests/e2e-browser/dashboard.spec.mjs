// Browser DOM e2e: drives the real rendered dashboard. Runs in CI (Playwright).
import { test, expect } from "@playwright/test";

const TABS = [
  ["radar", "#radarTable"],
  ["portfolio", "#holdings"],
  ["catalysts", "#filings"],
  ["chokepoints", "#chokeList"],
  ["options", "#optForm"],
  ["research", "#researchReview"],
  ["scout", "#scoutReview"],
  ["diversifier", "#diversifierReview"],
  ["digest", "#digestBox"],
];

test("dashboard loads with no console errors", async ({ page }) => {
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("Puck");
  // data renders from the committed seed
  await expect(page.locator("#radarTable tbody tr").first()).toBeVisible();
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("every tab switches and shows its content", async ({ page }) => {
  await page.goto("/");
  for (const [tab, sel] of TABS) {
    await page.locator(`.tabs button[data-tab="${tab}"]`).click();
    await expect(page.locator(`#${tab}`)).toHaveClass(/active/);
    await expect(page.locator(sel)).toBeVisible();
  }
});

test("help modal opens with content and closes", async ({ page }) => {
  await page.goto("/");
  await page.locator('.help[data-help="overview"]').first().click();
  await expect(page.locator("#helpModal")).toBeVisible();
  await expect(page.locator("#helpBody")).toContainText("Puck");
  await page.locator("#helpClose").click();
  await expect(page.locator("#helpModal")).toBeHidden();
});

test("settings modal opens; a holding can be added and persists in the table", async ({ page }) => {
  await page.goto("/");
  await page.locator("#settingsBtn").click();
  await expect(page.locator("#settingsModal")).toBeVisible();
  await page.locator("#hTicker").fill("MU");
  await page.locator("#hShares").fill("100");
  await page.locator("#hCost").fill("80");
  await page.locator("#hAdd").click();
  await expect(page.locator("#holdEdit tbody")).toContainText("MU");
});

test("options check evaluates and returns a verdict", async ({ page }) => {
  await page.goto("/");
  await page.locator('.tabs button[data-tab="options"]').click();
  await page.locator("#oType").selectOption("call");
  await page.locator("#oS").fill("100");
  await page.locator("#oK").fill("110");
  await page.locator("#oDays").fill("90");
  await page.locator("#oPx").fill("4.5");
  await page.locator("#oVol").fill("30");
  await page.locator("#oEval").click();
  await expect(page.locator("#optResult .verdict")).toContainText(/CHEAP|FAIR|RICH/);
});
