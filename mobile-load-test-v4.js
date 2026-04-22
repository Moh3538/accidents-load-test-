const { chromium } = require('playwright');
const fs = require('fs');

const MOBILE_DEVICES = [
  { name: 'iPhone 14 Pro Max', viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: 'Samsung Galaxy S23', viewport: { width: 384, height: 854 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: 'Google Pixel 7', viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true },
];

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1';

const IMAGES = [
  './chassis1.jpg','./chassis2.jpg','./chassis3.jpg',
  './chassis4.jpg','./chassis5.jpg','./chassis6.jpg',
  './chassis7.jpg','./chassis8.jpg','./chassis9.jpg',
  './chassis10.jpg',
];

const TARGET_URL = 'https://icarsu.com/accidents/';
const API_TIMEOUT = 120000;
const BATCHES = [5, 10, 15, 20, 50, 100];

const allResults = [];

// ─────────────────────────────────────────────
// Retry
async function retry(fn, retries = 2) {
  let err;
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (e) { err = e; }
  }
  throw err;
}

// ─────────────────────────────────────────────
// REMOVE OVERLAYS 🔥
async function removeOverlays(page) {
  await page.evaluate(() => {
    const ids = ['installBox', 'iosSteps'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });

    document.querySelectorAll('*').forEach(el => {
      const style = window.getComputedStyle(el);
      if (
        style.position === 'fixed' &&
        parseInt(style.zIndex) > 1000
      ) {
        el.remove();
      }
    });
  });
}

// ─────────────────────────────────────────────
async function waitForChassisChange(page, before) {
  await page.waitForFunction(
    (prev) => {
      const el = document.getElementById('chassisText');
      const txt = el?.innerText?.trim() || '';
      return txt && txt !== prev;
    },
    before,
    { timeout: API_TIMEOUT }
  );

  return page.evaluate(() =>
    document.getElementById('chassisText')?.innerText.trim()
  );
}

// ─────────────────────────────────────────────
async function uploadFile(page, file) {
  await retry(async () => {
    await page.locator('input[type="file"]').setInputFiles(file);
  });
}

// ─────────────────────────────────────────────
// 💥 FIXED CLICK
async function clickCopyButton(page) {
  await removeOverlays(page);

  const btn = page.locator('text=Copy Chassis').first();

  try {
    await btn.click({ timeout: 3000 });
    return;
  } catch {}

  try {
    await btn.click({ force: true });
    return;
  } catch {}

  // last fallback → JS click
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('*')).find(e =>
      (e.innerText || '').includes('Copy Chassis')
    );
    if (el) el.click();
  });
}

// ─────────────────────────────────────────────
async function runSingleUser(browser, userId, batchSize) {
  const device = MOBILE_DEVICES[Math.floor(Math.random() * MOBILE_DEVICES.length)];
  const imageFile = IMAGES[(userId - 1) % IMAGES.length];

  const context = await browser.newContext({
    ...device,
    userAgent: MOBILE_UA,
  });

  await context.route('**/*', route => {
    const type = route.request().resourceType();
    if (['image', 'font', 'media'].includes(type)) return route.abort();
    route.continue();
  });

  const page = await context.newPage();

  const timings = {};

  try {
    const start = Date.now();

    await page.waitForTimeout(Math.random() * 200);

    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });

    await removeOverlays(page); // 🔥 مهم جدًا

    const before = await page.locator('#chassisText').innerText().catch(() => '');

    const uploadStart = Date.now();
    await uploadFile(page, imageFile);
    timings.upload = Date.now() - uploadStart;

    const apiStart = Date.now();
    await waitForChassisChange(page, before);
    timings.api = Date.now() - apiStart;

    const copyStart = Date.now();
    await clickCopyButton(page);
    timings.copy = Date.now() - copyStart;

    timings.total = Date.now() - start;

    await context.close();

    return { success: true, timings };

  } catch (e) {
    await context.close();
    return { success: false, error: e.message };
  }
}

// ─────────────────────────────────────────────
async function runBatch(size) {
  console.log(`🔥 Batch ${size}`);

  const browser = await chromium.launch({ headless: true });

  const results = await Promise.all(
    Array.from({ length: size }, (_, i) =>
      runSingleUser(browser, i + 1, size)
    )
  );

  await browser.close();

  const success = results.filter(r => r.success);

  return {
    size,
    success: success.length,
    total: size,
    successRate: (success.length / size) * 100,
  };
}

// ─────────────────────────────────────────────
async function main() {
  console.log('🚀 START');

  for (const size of BATCHES) {
    const result = await runBatch(size);
    console.log(result);
  }
}

main();
