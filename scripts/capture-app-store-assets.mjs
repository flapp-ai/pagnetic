import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const outputDirectory = new URL("../docs/app-store-assets/", import.meta.url);
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_EXECUTABLE_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
});

async function capture(name, url, prepare) {
  await page.goto(url, { waitUntil: "networkidle" });
  if (prepare) await prepare(page);
  await page.screenshot({
    path: fileURLToPath(new URL(name, outputDirectory)),
    type: "png",
  });
}

await capture(
  "00-feature-media-free-scanner.png",
  "https://pagnetic.fly.dev/",
  async (target) => {
    await target.locator("aside").evaluate((node) => node.remove());
  },
);

await capture(
  "01-free-message-preview.png",
  "https://pagnetic.fly.dev/",
  async (target) => {
    await target.getByRole("button", { name: "No public product yet? View a sample" }).click();
    await target.getByText("Instant opportunity preview").waitFor();
    await target.locator('section[aria-live="polite"]').scrollIntoViewIfNeeded();
  },
);
await capture(
  "02-source-backed-message-review.png",
  "http://127.0.0.1:9294/qa/v2-ui?view=messages",
  async (target) => {
    await target.locator('nav[aria-label="Local UI QA views"]').evaluate((node) => node.remove());
  },
);
await capture(
  "03-guided-theme-activation.png",
  "http://127.0.0.1:9294/qa/v2-ui?view=overview",
  async (target) => {
    await target.locator('nav[aria-label="Local UI QA views"]').evaluate((node) => node.remove());
  },
);

await browser.close();
