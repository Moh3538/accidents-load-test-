const { chromium } = require('playwright');
const fs = require('fs');

/**
 * ================================================================
 *  iCarsU.com – OPTIMIZED PLAYWRIGHT LOAD TEST
 *  Flow: Page Load → Upload → API → Copy Chassis
 *
 *  Improvements:
 *  - Single browser per batch (مش لكل user)
 *  - Context per user (أخف بكتير)
 *  - Resource blocking (images/fonts/media)
 *  - Smart wait بدل polling
 *  - Retry logic
 *  - Jitter (realistic start)
 * ================================================================
 */

// ─── Mobile devices ─────────────────────────────────────────────
const MOBILE_DEVICES = [
  { name: 'iPhone 14 Pro Max', viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: 'Samsung Galaxy S23', viewport: { width: 384, height: 854 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: 'Google Pixel 7', viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true },
  { name: 'iPhone 13', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: 'Samsung Galaxy S21', viewport: { width: 360, height: 800 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
];

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
  'Version/15.0 Mobile/15E148 Safari/604.1';

// ─── Images ─────────────────────────────────────────────────────
const IMAGES = [
  './chassis1.jpg','./chassis2.jpg','./chassis3.jpg',
  './chassis4.jpg','./chassis5.jpg','./chassis6.jpg',
  './chassis7.jpg','./chassis8.jpg','./chassis9.jpg',
  './chassis10.jpg',
];

const TARGET_URL  = 'https://icarsu.com/accidents/';
const API_TIMEOUT = 120000;

// ─── Batches ────────────────────────────────────────────────────
const BATCHES = [5, 10, 15, 20, 50, 100];

// cooldown
const LONG_COOLDOWN_BEFORE = [50, 100];
const COOLDOWN_LONG = 30000;
const COOLDOWN_SHORT = 10000;

const allResults = [];

// ───────────────────────────────────────────────────────────────
// Retry helper
async function retry(fn, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ───────────────────────────────────────────────────────────────
// Smart wait بدل polling
async function waitForChassisChange(page, before) {
  await page.waitForFunction(
    (prev) => {
      const el = document.getElementById('chassisText');
      const txt = el?.innerText?.trim() || '';
      return txt.length > 0 && txt !== prev;
    },
    before,
    { timeout: API_TIMEOUT }
  );

  return page.evaluate(() => {
    return document.getElementById('chassisText')?.innerText?.trim() || '';
  });
}

// ───────────────────────────────────────────────────────────────
async function uploadFile(page, imageFile) {
  await retry(async () => {
    const input = page.locator('input[type="file"]').first();
    await input.waitFor({ state: 'attached', timeout: 5000 });
    await input.setInputFiles(imageFile);
  });
}

// ───────────────────────────────────────────────────────────────
async function clickCopyButton(page) {
  await retry(async () => {
    const btn = page.locator('text=Copy').first();
    await btn.click({ timeout: 5000 });
  });
}

// ───────────────────────────────────────────────────────────────
async function runSingleUser(browser, userId, batchSize) {
  const device    = MOBILE_DEVICES[Math.floor(Math.random() * MOBILE_DEVICES.length)];
  const imageFile = IMAGES[(userId - 1) % IMAGES.length];

  const context = await browser.newContext({
    ...device,
    userAgent: MOBILE_UA,
  });

  // 🚫 Block heavy resources
  await context.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (['image', 'font', 'media'].includes(type)) return route.abort();
    return route.continue();
  });

  const page = await context.newPage();

  const timings = {
    pageLoad: 0,
    upload: 0,
    api: 0,
    copy: 0,
    journeyTotal: 0,
    fullTotal: 0,
  };

  try {
    const fullStart = Date.now();

    // jitter (simulate real users)
    await page.waitForTimeout(Math.random() * 200);

    // ─── Page Load ─────────────────────────
    const pageStart = Date.now();
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    timings.pageLoad = Date.now() - pageStart;

    await page.waitForTimeout(1500);

    const preChassis = await page
      .locator('#chassisText')
      .innerText()
      .catch(() => '');

    const journeyStart = Date.now();

    // ─── Upload ────────────────────────────
    const uploadStart = Date.now();
    await uploadFile(page, imageFile);
    timings.upload = Date.now() - uploadStart;

    // ─── API ───────────────────────────────
    const apiStart = Date.now();
    const chassis = await waitForChassisChange(page, preChassis);
    timings.api = Date.now() - apiStart;

    // ─── Copy ──────────────────────────────
    const copyStart = Date.now();
    await clickCopyButton(page);
    timings.copy = Date.now() - copyStart;

    timings.journeyTotal = Date.now() - journeyStart;
    timings.fullTotal = Date.now() - fullStart;

    console.log(
      `   ✅ [Batch ${batchSize}] User ${userId}` +
      ` | chassis: ${chassis.substring(0, 10)}...` +
      ` | page: ${(timings.pageLoad / 1000).toFixed(2)}s` +
      ` | api: ${(timings.api / 1000).toFixed(2)}s` +
      ` | FULL: ${(timings.fullTotal / 1000).toFixed(2)}s`
    );

    await context.close();

    return { success: true, userId, batchSize, timings };

  } catch (err) {
    console.error(`   ❌ [Batch ${batchSize}] User ${userId} | ${err.message}`);
    await context.close();

    return { success: false, userId, batchSize, error: err.message };
  }
}

// ───────────────────────────────────────────────────────────────
async function runBatch(size) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔥 BATCH: ${size} USERS`);
  console.log(`${'='.repeat(80)}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const startTime = Date.now();

  const results = await Promise.all(
    Array.from({ length: size }, (_, i) =>
      runSingleUser(browser, i + 1, size)
    )
  );

  const batchDuration = (Date.now() - startTime) / 1000;

  await browser.close();

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  if (successful.length === 0) {
    return {
      size,
      success: 0,
      total: size,
      successRate: 0,
      wallTime: batchDuration,
      timings: null,
    };
  }

  const apiTimes = successful.map((r) => r.timings.api);

  return {
    size,
    success: successful.length,
    total: size,
    successRate: (successful.length / size) * 100,
    wallTime: batchDuration,
    timings: {
      api: {
        avg: avg(apiTimes),
        p95: percentile(apiTimes, 95),
      },
    },
  };
}

// ───────────────────────────────────────────────────────────────
function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

// ───────────────────────────────────────────────────────────────
function assessHealth(successRate, apiP95) {
  if (successRate === 0) return 'FAILED';
  if (successRate < 50) return 'OVERLOADED';
  if (successRate < 80) return 'CRITICAL';
  if (apiP95 > 20000) return 'DEGRADED';
  if (apiP95 > 10000) return 'GOOD';
  return 'EXCELLENT';
}

// ───────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🚀 OPTIMIZED LOAD TEST START\n');

  for (let i = 0; i < BATCHES.length; i++) {
    const size = BATCHES[i];

    const result = await runBatch(size);
    allResults.push(result);

    console.log(result);

    if (i < BATCHES.length - 1) {
      const nextBatch = BATCHES[i + 1];
      const cooldown = LONG_COOLDOWN_BEFORE.includes(nextBatch)
        ? COOLDOWN_LONG
        : COOLDOWN_SHORT;

      console.log(`⏸️ Cooling ${cooldown / 1000}s...\n`);
      await new Promise((r) => setTimeout(r, cooldown));
    }
  }

  fs.writeFileSync('load-test-results.json', JSON.stringify(allResults, null, 2));

  console.log('\n📊 DONE\n');
}

main().catch(console.error);
