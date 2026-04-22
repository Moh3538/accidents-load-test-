'use strict';

const { chromium } = require('playwright');
const fs = require('fs');

/**
 * ================================================================
 *  iCarsU.com  –  PLAYWRIGHT BROWSER LOAD TEST (OPTIMIZED)
 *  Flow: Page Load → Upload → API → Copy Chassis 
 *  Runs on GitHub Actions (stable network, no VUH limits)
 *
 *  BATCHES: 5, 10, 15, 20, 50, 100 concurrent users
 * ================================================================
 */

// ─── Performance Configuration ───────────────────────────────────────────
const MAX_CONTEXTS = 20;

// ─── Mobile devices pool ──────────────────────────────────────────────────
const MOBILE_DEVICES = [
  {
    name: 'iPhone 14 Pro Max',
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  {
    name: 'Samsung Galaxy S23',
    viewport: { width: 384, height: 854 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  {
    name: 'Google Pixel 7',
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.75,
    isMobile: true,
    hasTouch: true,
  },
  {
    name: 'iPhone 13',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  {
    name: 'Samsung Galaxy S21',
    viewport: { width: 360, height: 800 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
];

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
  'Version/15.0 Mobile/15E148 Safari/604.1';

// ─── Chassis images ──────────────────────────────────────────────────────
const IMAGES = [
  './chassis1.jpg',  './chassis2.jpg',  './chassis3.jpg',
  './chassis4.jpg',  './chassis5.jpg',  './chassis6.jpg',
  './chassis7.jpg',  './chassis8.jpg',  './chassis9.jpg',
  './chassis10.jpg',
];

const TARGET_URL  = 'https://icarsu.com/accidents/';
const API_TIMEOUT = 120000;

// ─── Test batches ─────────────────────────────────────────────────────────
const BATCHES = [5, 10, 15, 20, 50, 100];

// ─── Cooldown config ──────────────────────────────────────────────────────
const LONG_COOLDOWN_BEFORE = [50, 100];
const COOLDOWN_LONG        = 30000;
const COOLDOWN_SHORT       = 10000;

// Results storage
const allResults = [];

// ─── Concurrency limiter ──────────────────────────────────────────────────
function pLimit(concurrency) {
  let running = 0;
  const queue = [];

  function next() {
    if (running >= concurrency || queue.length === 0) return;
    running++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => {
      running--;
      next();
    });
  }

  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}

// ─── Helper: Wait for chassis text to change ─────────────────────────────
async function waitForChassisChange(page, before) {
  const deadline = Date.now() + API_TIMEOUT;

  while (Date.now() < deadline) {
    const current = await page
      .evaluate(() => {
        const el = document.getElementById('chassisText');
        return el?.innerText?.trim() ?? '';
      })
      .catch(() => '');

    if (current.length > 0 && current !== before) {
      return current;
    }

    await page.waitForTimeout(300);
  }

  throw new Error(`Chassis text did not change within ${API_TIMEOUT / 1000}s`);
}

// ─── Helper: Upload file ──────────────────────────────────────────────────
async function uploadFile(page, imageFile, timeoutMs = 30000) {
  const selectors = [
    'input[type="file"]',
    'input[id="regImage"]',
    '#regImage',
    '[accept*="image"]',
    'input[type="file"][accept]',
  ];

  for (const selector of selectors) {
    try {
      const fileInput = page.locator(selector).first();
      await fileInput.waitFor({ state: 'attached', timeout: 5000 });
      await fileInput.setInputFiles(imageFile);
      return;
    } catch {
      // try next selector
    }
  }

  await page.waitForSelector('input[type="file"]', {
    state: 'attached',
    timeout: timeoutMs,
  });
  await page.locator('input[type="file"]').first().setInputFiles(imageFile);
}

// ─── Helper: Click Copy button ────────────────────────────────────────────
async function clickCopyButton(page, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const copyBtn = page.locator('button, a, div[role="button"]').filter({
        hasText: /Copy(\s*Chassis)?/i
      }).first();
      
      if (await copyBtn.count() > 0) {
        await copyBtn.click({ timeout: 2000 });
        return;
      }
    } catch {
      // Continue
    }

    const clicked = await page.evaluate(() => {
      const elements = document.querySelectorAll(
        'button, a, [role="button"], [onclick], .btn, .button, span[class*="copy"], div[class*="copy"]'
      );
      
      for (const el of elements) {
        const text = (el.innerText || el.textContent || '').toLowerCase();
        const ariaLabel = el.getAttribute('aria-label') || '';
        
        if (
          text.includes('copy chassis') ||
          text.includes('copy') ||
          text === 'نسخ' ||
          text.includes('نسخ الشاصي') ||
          ariaLabel.toLowerCase().includes('copy')
        ) {
          if (el.offsetParent !== null) {
            el.click();
            return true;
          }
        }
      }
      
      const icons = document.querySelectorAll('i, svg, img[alt*="copy"], [class*="fa-copy"]');
      for (const icon of icons) {
        const parent = icon.closest('button, a, [role="button"]');
        if (parent && parent.offsetParent !== null) {
          parent.click();
          return true;
        }
      }
      
      return false;
    }).catch(() => false);

    if (clicked) return;
    
    try {
      const xpathBtn = page.locator('//*[contains(text(), "Copy") or contains(text(), "نسخ")]').first();
      if (await xpathBtn.count() > 0) {
        await xpathBtn.click({ timeout: 1000 });
        return;
      }
    } catch {
      // Continue
    }

    await page.waitForTimeout(300);
  }

  throw new Error(`Copy button not found within ${timeoutMs / 1000}s`);
}

// ─── Single user journey ──────────────────────────────────────────────────
async function runSingleUser(userId, batchSize, browser) {
  let context;

  const device    = MOBILE_DEVICES[Math.floor(Math.random() * MOBILE_DEVICES.length)];
  const imageFile = IMAGES[(userId - 1) % IMAGES.length];

  const timings = {
    pageLoad:     0,
    upload:       0,
    api:          0,
    copy:         0,
    journeyTotal: 0,
    fullTotal:    0,
  };

  try {
    context = await browser.newContext({
      ...device,
      userAgent: MOBILE_UA,
    });

    const page = await context.newPage();

    // ⏱️ FULL TIMER - starts here
    const fullStart = Date.now();

    // ─── Step 0: Page Load ────────────────────────────────────────
    const pageStart = Date.now();
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    timings.pageLoad = Date.now() - pageStart;

    // Wait for chassis element to be present
    await page.waitForSelector('#chassisText', { timeout: 10000 }).catch(() => {});

    const preChassis = await page
      .evaluate(() => {
        const el = document.getElementById('chassisText');
        return el?.innerText?.trim() ?? '';
      })
      .catch(() => '');

    // ⏱️ JOURNEY TIMER - starts AFTER page is fully ready
    const journeyStart = Date.now();

    // ─── Step 1: Upload ───────────────────────────────────────────
    const uploadStart = Date.now();
    await uploadFile(page, imageFile);
    timings.upload = Date.now() - uploadStart;

    // ─── Step 2: API Processing ───────────────────────────────────
    const apiStart     = Date.now();
    const chassisFound = await waitForChassisChange(page, preChassis);
    timings.api        = Date.now() - apiStart;

    // ─── Step 3: Click Copy ───────────────────────────────────────
    const copyStart = Date.now();
    await clickCopyButton(page, 10000);
    timings.copy = Date.now() - copyStart;

    // Calculate timings
    timings.journeyTotal = Date.now() - journeyStart;
    timings.fullTotal    = Date.now() - fullStart;

    console.log(
      `   ✅ [Batch ${batchSize}] User ${userId}` +
      ` | chassis: ${chassisFound.substring(0, 10)}...` +
      ` | page: ${(timings.pageLoad / 1000).toFixed(2)}s` +
      ` | upload: ${(timings.upload / 1000).toFixed(2)}s` +
      ` | api: ${(timings.api / 1000).toFixed(2)}s` +
      ` | copy: ${(timings.copy / 1000).toFixed(2)}s` +
      ` | journey: ${(timings.journeyTotal / 1000).toFixed(2)}s` +
      ` | FULL: ${(timings.fullTotal / 1000).toFixed(2)}s`
    );

    await context.close();

    return { success: true, userId, batchSize, timings };

  } catch (err) {
    console.error(`   ❌ [Batch ${batchSize}] User ${userId} | ${err.message}`);

    if (context) {
      await context.close().catch(() => {});
    }

    return { success: false, userId, batchSize, error: err.message };
  }
}

// ─── Run a single batch ───────────────────────────────────────────────────
async function runBatch(size, browser) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔥 BATCH: ${size} CONCURRENT USERS — كلهم بيبدأوا دلوقتي`);
  console.log(`${'='.repeat(80)}`);

  const limit = pLimit(MAX_CONTEXTS);
  const startTime = Date.now();

  const results = await Promise.all(
    Array.from({ length: size }, (_, i) =>
      limit(() => runSingleUser(i + 1, size, browser))
    )
  );

  const batchDuration = (Date.now() - startTime) / 1000;
  const successful    = results.filter((r) => r.success);
  const failed        = results.filter((r) => !r.success);

  if (successful.length === 0) {
    console.log(`\n   ❌ ALL ${size} USERS FAILED`);
    return {
      size,
      success:     0,
      total:       size,
      successRate: 0,
      wallTime:    batchDuration,
      timings:     null,
      errors:      failed.slice(0, 3).map((f) => f.error),
    };
  }

  const pageLoadTimes = successful.map((r) => r.timings.pageLoad);
  const uploadTimes   = successful.map((r) => r.timings.upload);
  const apiTimes      = successful.map((r) => r.timings.api);
  const copyTimes     = successful.map((r) => r.timings.copy);
  const journeyTimes  = successful.map((r) => r.timings.journeyTotal);
  const fullTimes     = successful.map((r) => r.timings.fullTotal);

  return {
    size,
    success:     successful.length,
    total:       size,
    successRate: (successful.length / size) * 100,
    wallTime:    batchDuration,
    timings: {
      pageLoad: {
        avg: avg(pageLoadTimes),
        min: Math.min(...pageLoadTimes),
        max: Math.max(...pageLoadTimes),
        p95: percentile(pageLoadTimes, 95),
      },
      upload: {
        avg: avg(uploadTimes),
        min: Math.min(...uploadTimes),
        max: Math.max(...uploadTimes),
        p95: percentile(uploadTimes, 95),
      },
      api: {
        avg: avg(apiTimes),
        min: Math.min(...apiTimes),
        max: Math.max(...apiTimes),
        p95: percentile(apiTimes, 95),
      },
      copy: {
        avg: avg(copyTimes),
        p95: percentile(copyTimes, 95),
      },
      journey: {
        avg: avg(journeyTimes),
        min: Math.min(...journeyTimes),
        max: Math.max(...journeyTimes),
        p95: percentile(journeyTimes, 95),
      },
      full: {
        avg: avg(fullTimes),
        min: Math.min(...fullTimes),
        max: Math.max(...fullTimes),
        p95: percentile(fullTimes, 95),
      },
    },
    errors: failed.slice(0, 5).map((f) => f.error),
  };
}

// ─── Statistics helpers ───────────────────────────────────────────────────
function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const index  = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

// ─── Health assessment ────────────────────────────────────────────────────
function assessHealth(successRate, apiP95) {
  if (successRate === 0)  return '💀 FAILED';
  if (successRate < 50)   return '💀 OVERLOADED';
  if (successRate < 80)   return '🔴 CRITICAL';
  if (apiP95 > 20000)     return '🟠 DEGRADED';
  if (apiP95 > 10000)     return '🟡 GOOD';
  return '🟢 EXCELLENT';
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n📱 ========================================');
  console.log('📱 iCarsU MOBILE LOAD TEST - PLAYWRIGHT');
  console.log('📱 GitHub Actions | Stable Network');
  console.log('📱 Flow: Page Load → Upload → API → Copy');
  console.log('📱 TRUE CONCURRENCY — كل batch كلها مع بعض');
  console.log('📱 Cooldown: 30s قبل batch 50 & 100 | 10s للباقي');
  console.log(`📱 Max concurrent contexts: ${MAX_CONTEXTS}`);
  console.log('📱 ========================================\n');

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-background-timer-throttling',
    ],
  });

  try {
    for (let i = 0; i < BATCHES.length; i++) {
      const size = BATCHES[i];

      const result = await runBatch(size, browser);
      allResults.push(result);

      if (result.timings) {
        console.log(`\n   📊 Batch ${size} Results:`);
        console.log(`   ✅ Success    : ${result.success}/${result.total} (${result.successRate.toFixed(1)}%)`);
        console.log(`   ⏱️  Wall Time  : ${result.wallTime.toFixed(2)}s`);
        console.log(`   📄 Page Load  : avg ${(result.timings.pageLoad.avg / 1000).toFixed(2)}s | p95 ${(result.timings.pageLoad.p95 / 1000).toFixed(2)}s`);
        console.log(`   📤 Upload     : avg ${(result.timings.upload.avg / 1000).toFixed(2)}s | p95 ${(result.timings.upload.p95 / 1000).toFixed(2)}s`);
        console.log(`   🔬 API        : avg ${(result.timings.api.avg / 1000).toFixed(2)}s | p95 ${(result.timings.api.p95 / 1000).toFixed(2)}s`);
        console.log(`   📋 Copy       : avg ${(result.timings.copy.avg / 1000).toFixed(2)}s | p95 ${(result.timings.copy.p95 / 1000).toFixed(2)}s`);
        console.log(`   🚀 JOURNEY    : avg ${(result.timings.journey.avg / 1000).toFixed(2)}s | p95 ${(result.timings.journey.p95 / 1000).toFixed(2)}s`);
        console.log(`   🎯 FULL TOTAL : avg ${(result.timings.full.avg / 1000).toFixed(2)}s | p95 ${(result.timings.full.p95 / 1000).toFixed(2)}s`);
        console.log(`   🏥 Health     : ${assessHealth(result.successRate, result.timings.api.p95)}`);
      } else {
        console.log(`\n   ❌ Batch ${size}: ALL FAILED`);
        if (result.errors?.length) {
          console.log('   📋 Sample errors:');
          result.errors.slice(0, 3).forEach((e) => console.log(`      - ${e}`));
        }
      }

      if (i < BATCHES.length - 1) {
        const nextBatch    = BATCHES[i + 1];
        const isLongPause  = LONG_COOLDOWN_BEFORE.includes(nextBatch);
        const cooldown     = isLongPause ? COOLDOWN_LONG : COOLDOWN_SHORT;
        const cooldownSecs = cooldown / 1000;

        console.log(`\n   ⏸️  Cooling down for ${cooldownSecs}s before Batch ${nextBatch}...\n`);
        await new Promise((r) => setTimeout(r, cooldown));
      }
    }
  } finally {
    await browser.close();
  }

  // ─── Generate CSV Report ──────────────────────────────────────────────────
  let csv =
    'Users,Success,SuccessRate,WallTime_s,' +
    'PageLoad_avg_s,PageLoad_p95_s,' +
    'Upload_avg_s,Upload_p95_s,' +
    'API_avg_s,API_p95_s,' +
    'Copy_avg_s,Copy_p95_s,' +
    'Journey_avg_s,Journey_p95_s,' +
    'FULL_avg_s,FULL_p95_s,Health\n';

  allResults.forEach((r) => {
    if (r.timings) {
      csv +=
        `${r.size},${r.success}/${r.total},${r.successRate.toFixed(1)}%,${r.wallTime.toFixed(2)},` +
        `${(r.timings.pageLoad.avg / 1000).toFixed(2)},${(r.timings.pageLoad.p95 / 1000).toFixed(2)},` +
        `${(r.timings.upload.avg / 1000).toFixed(2)},${(r.timings.upload.p95 / 1000).toFixed(2)},` +
        `${(r.timings.api.avg / 1000).toFixed(2)},${(r.timings.api.p95 / 1000).toFixed(2)},` +
        `${(r.timings.copy.avg / 1000).toFixed(2)},${(r.timings.copy.p95 / 1000).toFixed(2)},` +
        `${(r.timings.journey.avg / 1000).toFixed(2)},${(r.timings.journey.p95 / 1000).toFixed(2)},` +
        `${(r.timings.full.avg / 1000).toFixed(2)},${(r.timings.full.p95 / 1000).toFixed(2)},` +
        `${assessHealth(r.successRate, r.timings.api.p95)}\n`;
    } else {
      csv += `${r.size},0/${r.total},0%,${r.wallTime.toFixed(2)},0,0,0,0,0,0,0,0,0,0,0,0,FAILED\n`;
    }
  });

  fs.writeFileSync('load-test-results.csv', csv);
  fs.writeFileSync('load-test-results.json', JSON.stringify(allResults, null, 2));

  // ─── Final Summary ────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(120));
  console.log('📊 FINAL REPORT - TIMING BREAKDOWN');
  console.log('='.repeat(120));
  console.log(
    'Users │ Success │ Page   │ Upload │ API    │ Copy   │ Journey │ FULL   │ Health'
  );
  console.log(
    '──────┼─────────┼────────┼────────┼────────┼────────┼─────────┼────────┼──────────'
  );

  allResults.forEach((r) => {
    if (r.timings) {
      const users   = r.size.toString().padEnd(5);
      const success = `${r.success}/${r.total}`.padEnd(7);
      const page    = `${(r.timings.pageLoad.avg / 1000).toFixed(1)}s`.padEnd(6);
      const upload  = `${(r.timings.upload.avg / 1000).toFixed(1)}s`.padEnd(6);
      const api     = `${(r.timings.api.avg / 1000).toFixed(1)}s`.padEnd(6);
      const copy    = `${(r.timings.copy.avg / 1000).toFixed(1)}s`.padEnd(6);
      const journey = `${(r.timings.journey.avg / 1000).toFixed(1)}s`.padEnd(7);
      const full    = `${(r.timings.full.avg / 1000).toFixed(1)}s`.padEnd(6);
      const health  = assessHealth(r.successRate, r.timings.api.p95);
      console.log(`${users} │ ${success} │ ${page} │ ${upload} │ ${api} │ ${copy} │ ${journey} │ ${full} │ ${health}`);
    } else {
      console.log(`${r.size.toString().padEnd(5)} │ 0/${r.total}  │ -      │ -      │ -      │ -      │ -       │ -      │ FAILED`);
    }
  });

  console.log('='.repeat(120));
  console.log('\n📝 Results saved to: load-test-results.csv, load-test-results.json\n');

  // ─── Executive Summary ────────────────────────────────────────────────────
  const lastSafe      = allResults.filter((r) => r.successRate >= 90).pop();
  const firstOverload = allResults.find((r) => r.successRate < 50);
  const lastBatch     = allResults.at(-1);

  console.log('📋 EXECUTIVE SUMMARY:');
  console.log('─'.repeat(60));
  console.log(`   ✅ Safe concurrent mobile users : ${lastSafe ? lastSafe.size : 'N/A'}`);
  console.log(`   ❌ Server overloaded at          : ${firstOverload ? firstOverload.size : `> ${lastBatch?.size ?? '?'}`}`);
  console.log('');
  console.log('   📌 JOURNEY = Upload + API + Copy (business flow)');
  console.log('   📌 FULL = Page Load + JOURNEY (complete experience)');
  console.log('');
}

main().catch(console.error);
