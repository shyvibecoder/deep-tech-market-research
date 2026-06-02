// Generates the User Guide screenshots (docs/img/*.png) from the real dashboard.
// Run by the `docs` GitHub workflow whenever the UI changes, so the guide's images
// stay current. Local: `npm run screenshots` (needs Playwright chromium installed).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serveWeb } from "../../scripts/serve.mjs";

const outDir = fileURLToPath(new URL("../../docs/img/", import.meta.url));
mkdirSync(outDir, { recursive: true });

const shots = [
  { name: "overview", tab: "radar", setup: async () => {} },
  { name: "radar", tab: "radar" },
  { name: "portfolio", tab: "portfolio" },
  { name: "catalysts", tab: "catalysts" },
  { name: "chokepoints", tab: "chokepoints" },
  { name: "options", tab: "options" },
  { name: "research", tab: "research" },
  { name: "scout", tab: "scout" },
  { name: "diversifier", tab: "diversifier" },
  { name: "digest", tab: "digest" },
];

const server = await serveWeb(3100);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://127.0.0.1:3100/");
await page.waitForSelector("#radarTable tbody tr");

for (const s of shots) {
  await page.locator(`.tabs button[data-tab="${s.tab}"]`).click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: outDir + s.name + ".png", fullPage: true });
  console.log("shot", s.name);
}

// Settings modal screenshot
await page.locator("#settingsBtn").click();
await page.waitForSelector("#settingsModal:not(.hidden)");
await page.screenshot({ path: outDir + "settings.png", fullPage: true });
await page.locator("#settingsClose").click();

// Help modal screenshot
await page.locator('.help[data-help="regime"], .help[data-help="overview"]').first().click();
await page.waitForSelector("#helpModal:not(.hidden)");
await page.screenshot({ path: outDir + "help.png", fullPage: true });

await browser.close();
server.close();
console.log("screenshots written to docs/img/");
