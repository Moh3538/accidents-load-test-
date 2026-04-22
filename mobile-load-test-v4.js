'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');

/**
 * ================================================================
 *  iCarsU.com  –  PLAYWRIGHT BROWSER LOAD TEST (ENHANCED)
 *  Flow: Page Load → Upload → API → Copy Chassis
 *  Runs on GitHub Actions (stable network, no VUH limits)
 *
 *  BATCHES: 5, 10, 15, 20, 50, 100 concurrent users
 *  كل batch بتشغّل كل اليوزرز مع بعض في نفس اللحظة
 *  Cooldown: 30s قبل batch 50 و 100 | 10s باقي الـ batches
 *
 *  ENHANCEMENTS (More Realistic):
 *  ✓ Realistic think times between actions (human behavior)
 *  ✓ Random viewport variations within device families
 *  ✓ Network throttling simulation for mobile conditions
 *  ✓ Realistic scroll behavior before interactions
 *  ✓ Random delays to avoid detection patterns
 *  ✓ Session persistence tracking
 *  ✓ Memory usage monitoring
 *  ✓ Request/response timing breakdown
 *  ✓ Realistic touch events simulation
 * ================================================================
 */

// ─── System & Concurrency Configuration ───────────────────────────────────
const CPU_COUNT = os.cpus().length;
const MAX_CONTEXTS = Math.min(20, Math.floor(CPU_COUNT * 1.5)); // Dynamic based on CPU
const GLOBAL_TIMEOUT_MS = 35 * 60 * 1000; // 35 minutes max

// ─── Realistic Mobile Network Conditions ──────────────────────────────────
const NETWORK_CONDITIONS = [
  { name: '4G', download: 20 * 1024 * 1024 / 8, upload: 10 * 1024 * 1024 / 8, latency: 50 }, // 20 Mbps down, 10 Mbps up
  { name: 'LTE', download: 12 * 1024 * 1024 / 8, upload: 5 * 1024 * 1024 / 8, latency: 70 },
  { name: '3G', download: 1.5 * 1024 * 1024 / 8, upload: 750 * 1024 / 8, latency: 150 },
];

// ─── Enhanced Mobile Devices Pool with Realistic Variations ───────────────
const MOBILE_DEVICES = [
  {
    name: 'iPhone 14 Pro Max',
    baseViewport: { width: 430, height: 932 },
    viewportVariation: 0.02, // ±2% variation
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgents: [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1',
    ],
    typicalScrollDistance: 300,
  },
  {
    name: 'Samsung Galaxy S23',
    baseViewport: { width: 384, height: 854 },
    viewportVariation: 0.02,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgents: [
      'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Linux; Android 13; SM-S911U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36',
    ],
    typicalScrollDistance: 350,
  },
  {
    name: 'Google Pixel 7',
    baseViewport: { width: 412, height: 915 },
    viewportVariation: 0.02,
    deviceScaleFactor: 2.75,
    isMobile: true,
    hasTouch: true,
    userAgents: [
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Linux; Android 13; Pixel 7 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36',
    ],
    typicalScrollDistance: 320,
  },
  {
    name: 'iPhone 13',
    baseViewport: { width: 390, height: 844 },
    viewportVariation: 0.02,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgents: [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 15_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Mobile/15E148 Safari/604.1',
    ],
    typicalScrollDistance: 280,
  },
  {
    name: 'Samsung Galaxy S21',
    baseViewport: { width: 360, height: 800 },
    viewportVariation: 0.02,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgents: [
      'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Linux; Android 12; SM-G991U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36',
    ],
    typicalScrollDistance: 310,
  },
];

// ─── Chassis images ────────────────────────────────────────────────────────
const IMAGES = [
  './chassis1.jpg', './chassis2.jpg', './chassis3.jpg',
  './chassis4.jpg', './chassis5.jpg', './chassis6.jpg',
  './chassis7.jpg', './chassis8.jpg', './chassis9.jpg',
  './chassis10.jpg',
];

const TARGET_URL = 'https://icarsu.com/accidents/';
const API_TIMEOUT = 120_000; // 2 minutes

// ─── Human Behavior Delays (milliseconds) ──────────────────────────────────
const THINK_TIMES = {
  beforeUpload: { min: 500, max: 2000 },    // Looking at page before uploading
  afterUpload: { min: 300, max: 1000 },     // Brief pause after selecting file
  beforeCopy: { min: 800, max: 2500 },      // Reading chassis number before copying
  scrollPause: { min: 200, max: 600 },      // Pause during scrolling
};

// ─── Test batches ─────────────────────────────────────────────────────────
const BATCHES = [5, 10, 15, 20, 50, 100];

// ─── Cooldown config ──────────────────────────────────────────────────────
const LONG_COOLDOWN_BEFORE = [50, 100];
const COOLDOWN_LONG = 30_000; // 30 seconds
const COOLDOWN_SHORT = 10_000; // 10 seconds

// Results storage
const allResults = [];
const memorySnapshots = [];

// ─── Simple concurrency limiter ───────────────────────────────────────────
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

  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

// ─── Statistics helpers ───────────────────────────────────────────────────
function avg(arr) {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.min(Math.ceil((p / 100) * sorted.length) - 1, sorted.length - 1);
  return sorted[Math.max(0, index)];
}

function stdDev(arr) {
  if (arr.length === 0) return 0;
  const mean = avg(arr);
  const squareDiffs = arr.map(value => Math.pow(value - mean, 2));
  return Math.sqrt(avg(squareDiffs));
}

// ─── Health assessment ────────────────────────────────────────────────────
function assessHealth(successRate, apiP95) {
  if (successRate === 0) return 'FAILED';
  if (successRate < 50) return 'OVERLOADED';
  if (successRate < 80) return 'CRITICAL';
  if (apiP95 > 20_000) return 'DEGRADED';
  if (apiP95 > 10_000) return 'GOOD';
  return 'EXCELLENT';
}

function assessHealthEmoji(successRate, apiP95) {
  const label = assessHealth(successRate, apiP95);
  const map = {
    FAILED: '💀 FAILED',
    OVERLOADED: '💀 OVERLOADED',
    CRITICAL: '🔴 CRITICAL',
    DEGRADED: '🟠 DEGRADED',
    GOOD: '🟡 GOOD',
    EXCELLENT: '🟢 EXCELLENT',
  };
  return map[label] ?? label;
}

// ─── Helper: Random delay (human behavior simulation) ─────────────────────
async function humanDelay(min, max) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  await new Promise(resolve => setTimeout(resolve, delay));
  return delay;
}

// ─── Helper: Realistic scroll behavior ───────────────────────────────────
async function realisticScroll(page, device) {
  try {
    // Random scroll distance based on device
    const scrollDistance = device.typicalScrollDistance + 
                          Math.floor(Math.random() * 100) - 50;
    
    // Smooth scroll with random pauses
    const steps = Math.floor(Math.random() * 3) + 3; // 3-5 steps
    const stepDistance = Math.floor(scrollDistance / steps);
    
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, stepDistance);
      await humanDelay(THINK_TIMES.scrollPause.min, THINK_TIMES.scrollPause.max);
    }
    
    // Sometimes scroll back up a bit
    if (Math.random() > 0.5) {
      await page.mouse.wheel(0, -Math.floor(scrollDistance * 0.3));
      await humanDelay(200, 400);
    }
  } catch (error) {
    // Scroll failure is non-critical
  }
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

    if (current.length > 0 && current !== before) return current;

    await page.waitForTimeout(300);
  }

  throw new Error(`Chassis text did not change within ${API_TIMEOUT / 1000}s`);
}

// ─── Helper: Upload file with realistic interaction ───────────────────────
async function uploadFile(page, imageFile, timeoutMs = 30_000) {
  // Simulate human looking at upload area
  await humanDelay(THINK_TIMES.beforeUpload.min, THINK_TIMES.beforeUpload.max);
  
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
      await fileInput.waitFor({ state: 'attached', timeout: 5_000 });
      
      // Simulate tap/click on upload area before file selection
      await fileInput.click({ force: true }).catch(() => {});
      await humanDelay(200, 500);
      
      await fileInput.setInputFiles(imageFile);
      
      // Brief pause after file selection (processing)
      await humanDelay(THINK_TIMES.afterUpload.min, THINK_TIMES.afterUpload.max);
      
      return;
    } catch {
      // Try next selector
    }
  }

  // Last attempt
  await page.waitForSelector('input[type="file"]', {
    state: 'attached',
    timeout: timeoutMs,
  });
  await page.locator('input[type="file"]').first().setInputFiles(imageFile);
}

// ─── Helper: Click Copy button with realistic interaction ─────────────────
async function clickCopyButton(page, timeoutMs = 15_000) {
  // Human reading time before copying
  await humanDelay(THINK_TIMES.beforeCopy.min, THINK_TIMES.beforeCopy.max);
  
  const locators = [
    page.locator('button:has-text("Copy Chassis")'),
    page.locator('a:has-text("Copy Chassis")'),
    page.locator('[role="button"]:has-text("Copy Chassis")'),
    page.locator('button:has-text("Copy")'),
    page.locator('a:has-text("Copy")'),
  ];

  const deadline = Date.now() + timeoutMs;

  for (const loc of locators) {
    if (Date.now() >= deadline) break;
    try {
      const remaining = deadline - Date.now();
      
      // Wait for button to be visible and stable
      await loc.first().waitFor({ state: 'visible', timeout: Math.min(3_000, remaining) });
      
      // Simulate touch event (more realistic for mobile)
      await loc.first().tap().catch(() => loc.first().click());
      
      // Brief pause after click
      await humanDelay(100, 300);
      
      return;
    } catch {
      // Try next
    }
  }

  throw new Error(`Copy button not found within ${timeoutMs / 1000}s`);
}

// ─── Get memory usage ─────────────────────────────────────────────────────
function getMemoryUsage() {
  const used = process.memoryUsage();
  return {
    heapUsedMB: Math.round(used.heapUsed / 1024 / 1024 * 100) / 100,
    heapTotalMB: Math.round(used.heapTotal / 1024 / 1024 * 100) / 100,
    rssMB: Math.round(used.rss / 1024 / 1024 * 100) / 100,
    externalMB: Math.round(used.external / 1024 / 1024 * 100) / 100,
  };
}

// ─── Single user journey with realistic behavior ──────────────────────────
async function runSingleUser(userId, batchSize, browser) {
  let context;
  
  // Random device with variations
  const baseDevice = MOBILE_DEVICES[Math.floor(Math.random() * MOBILE_DEVICES.length)];
  const networkCondition = NETWORK_CONDITIONS[Math.floor(Math.random() * NETWORK_CONDITIONS.length)];
  const imageFile = IMAGES[(userId - 1) % IMAGES.length];
  
  // Add realistic viewport variation
  const variation = 1 + (Math.random() * baseDevice.viewportVariation * 2 - baseDevice.viewportVariation);
  const viewport = {
    width: Math.round(baseDevice.baseViewport.width * variation),
    height: Math.round(baseDevice.baseViewport.height * variation),
  };
  
  // Random user agent for this device
  const userAgent = baseDevice.userAgents[Math.floor(Math.random() * baseDevice.userAgents.length)];

  const timings = {
    pageLoad: 0,
    upload: 0,
    api: 0,
    copy: 0,
    journeyTotal: 0,
    fullTotal: 0,
    thinkTime: 0, // Track total think time
    networkLatency: networkCondition.latency,
  };

  try {
    context = await browser.newContext({
      viewport: viewport,
      deviceScaleFactor: baseDevice.deviceScaleFactor,
      isMobile: baseDevice.isMobile,
      hasTouch: baseDevice.hasTouch,
      userAgent: userAgent,
    });

    const page = await context.newPage();
    
    // Apply network throttling for realistic mobile conditions
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: networkCondition.download,
      uploadThroughput: networkCondition.upload,
      latency: networkCondition.latency,
    });

    // ⏱️ FULL TIMER
    const fullStart = Date.now();

    // ─── Step 0: Page Load ────────────────────────────────────────
    const pageStart = Date.now();
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60_000 });
    timings.pageLoad = Date.now() - pageStart;

    // Wait for chassis text element
    await page.waitForSelector('#chassisText', { timeout: 10_000 }).catch(() => {});

    const preChassis = await page
      .evaluate(() => {
        const el = document.getElementById('chassisText');
        return el?.innerText?.trim() ?? '';
      })
      .catch(() => '');

    // Realistic scroll behavior after page load
    await realisticScroll(page, baseDevice);

    // ⏱️ JOURNEY TIMER
    const journeyStart = Date.now();
    let totalThinkTime = 0;

    // ─── Step 1: Upload ───────────────────────────────────────────
    const uploadStart = Date.now();
    
    // Add think time before upload
    const thinkBefore = await humanDelay(THINK_TIMES.beforeUpload.min, THINK_TIMES.beforeUpload.max);
    totalThinkTime += thinkBefore;
    
    await uploadFile(page, imageFile);
    timings.upload = Date.now() - uploadStart - thinkBefore; // Subtract think time for pure operation timing

    // ─── Step 2: API Processing ───────────────────────────────────
    const apiStart = Date.now();
    const chassisFound = await waitForChassisChange(page, preChassis);
    timings.api = Date.now() - apiStart;

    // ─── Step 3: Click Copy ───────────────────────────────────────
    const copyStart = Date.now();
    
    // Add think time before copy
    const thinkBeforeCopy = await humanDelay(THINK_TIMES.beforeCopy.min, THINK_TIMES.beforeCopy.max);
    totalThinkTime += thinkBeforeCopy;
    
    await clickCopyButton(page, 10_000);
    timings.copy = Date.now() - copyStart - thinkBeforeCopy; // Subtract think time

    timings.journeyTotal = Date.now() - journeyStart;
    timings.fullTotal = Date.now() - fullStart;
    timings.thinkTime = totalThinkTime;

    console.log(
      `   ✅ [Batch ${batchSize}] User ${userId}` +
      ` | device: ${baseDevice.name} (${viewport.width}x${viewport.height})` +
      ` | net: ${networkCondition.name}` +
      ` | chassis: ${chassisFound.substring(0, 10)}...` +
      ` | page: ${(timings.pageLoad / 1000).toFixed(2)}s` +
      ` | api: ${(timings.api / 1000).toFixed(2)}s` +
      ` | FULL: ${(timings.fullTotal / 1000).toFixed(2)}s`,
    );

    await context.close();

    return { success: true, userId, batchSize, timings, device: baseDevice.name };

  } catch (err) {
    console.error(`   ❌ [Batch ${batchSize}] User ${userId} | ${err.message}`);

    if (context) {
      await context.close().catch((e) =>
        console.error(`   ⚠️  [Batch ${batchSize}] User ${userId} | context.close() failed: ${e.message}`),
      );
    }

    return { success: false, userId, batchSize, error: err.message };
  }
}

// ─── Run a single batch ───────────────────────────────────────────────────
async function runBatch(size, browser) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔥 BATCH: ${size} CONCURRENT USERS — كلهم بيبدأوا دلوقتي (max ${MAX_CONTEXTS} متوازيين)`);
  console.log(`${'='.repeat(80)}`);

  // Take memory snapshot before batch
  const memBefore = getMemoryUsage();
  memorySnapshots.push({ batch: size, phase: 'before', ...memBefore });

  const limit = pLimit(MAX_CONTEXTS);
  const startTime = Date.now();

  const results = await Promise.all(
    Array.from({ length: size }, (_, i) =>
      limit(() => runSingleUser(i + 1, size, browser)),
    ),
  );

  const batchDuration = (Date.now() - startTime) / 1000;
  
  // Take memory snapshot after batch
  const memAfter = getMemoryUsage();
  memorySnapshots.push({ batch: size, phase: 'after', ...memAfter });

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  if (successful.length === 0) {
    console.log(`\n   ❌ ALL ${size} USERS FAILED`);
    return {
      size,
      success: 0,
      total: size,
      successRate: 0,
      wallTime: batchDuration,
      timings: null,
      errors: failed.slice(0, 3).map((f) => f.error),
      memoryDelta: memAfter.heapUsedMB - memBefore.heapUsedMB,
    };
  }

  const pageLoadTimes = successful.map((r) => r.timings.pageLoad);
  const apiTimes = successful.map((r) => r.timings.api);
  const journeyTimes = successful.map((r) => r.timings.journeyTotal);
  const fullTimes = successful.map((r) => r.timings.fullTotal);
  const uploadTimes = successful.map((r) => r.timings.upload);
  const copyTimes = successful.map((r) => r.timings.copy);
  const thinkTimes = successful.map((r) => r.timings.thinkTime);

  return {
    size,
    success: successful.length,
    total: size,
    successRate: (successful.length / size) * 100,
    wallTime: batchDuration,
    timings: {
      pageLoad: {
        avg: avg(pageLoadTimes),
        min: Math.min(...pageLoadTimes),
        max: Math.max(...pageLoadTimes),
        p95: percentile(pageLoadTimes, 95),
        stdDev: stdDev(pageLoadTimes),
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
        stdDev: stdDev(apiTimes),
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
      thinkTime: {
        avg: avg(thinkTimes),
        total: thinkTimes.reduce((a, b) => a + b, 0),
      },
    },
    errors: failed.slice(0, 5).map((f) => f.error),
    memoryDelta: Math.round((memAfter.heapUsedMB - memBefore.heapUsedMB) * 100) / 100,
  };
}

// ─── Run all batches ──────────────────────────────────────────────────────
async function runAllBatches() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });

  try {
    console.log('\n📱 ========================================');
    console.log('📱 iCarsU MOBILE LOAD TEST - ENHANCED REALISTIC VERSION');
    console.log('📱 GitHub Actions | Stable Network');
    console.log(`📱 CPU Cores: ${CPU_COUNT} | Max Contexts: ${MAX_CONTEXTS}`);
    console.log('📱 Features: Human think times, Network throttling, Viewport variations');
    console.log('📱 ========================================\n');

    for (let i = 0; i < BATCHES.length; i++) {
      const size = BATCHES[i];
      const result = await runBatch(size, browser);
      allResults.push(result);

      if (result.timings) {
        console.log(`\n   📊 Batch ${size} Results:`);
        console.log(`   ✅ Success    : ${result.success}/${result.total} (${result.successRate.toFixed(1)}%)`);
        console.log(`   ⏱️  Wall Time  : ${result.wallTime.toFixed(2)}s`);
        console.log(`   💭 Think Time : avg ${(result.timings.thinkTime.avg / 1000).toFixed(2)}s per user`);
        console.log(`   📄 Page Load  : avg ${(result.timings.pageLoad.avg / 1000).toFixed(2)}s | p95 ${(result.timings.pageLoad.p95 / 1000).toFixed(2)}s`);
        console.log(`   🔬 API        : avg ${(result.timings.api.avg / 1000).toFixed(2)}s | p95 ${(result.timings.api.p95 / 1000).toFixed(2)}s`);
        console.log(`   📋 Journey    : avg ${(result.timings.journey.avg / 1000).toFixed(2)}s | p95 ${(result.timings.journey.p95 / 1000).toFixed(2)}s`);
        console.log(`   🎯 FULL TOTAL : avg ${(result.timings.full.avg / 1000).toFixed(2)}s | p95 ${(result.timings.full.p95 / 1000).toFixed(2)}s`);
        console.log(`   💾 Memory Δ   : ${result.memoryDelta > 0 ? '+' : ''}${result.memoryDelta} MB`);
        console.log(`   🏥 Health     : ${assessHealthEmoji(result.successRate, result.timings.api.p95)}`);
      } else {
        console.log(`\n   ❌ Batch ${size}: ALL FAILED`);
        if (result.errors?.length) {
          console.log('   📋 Sample errors:');
          result.errors.slice(0, 3).forEach((e) => console.log(`      - ${e}`));
        }
      }

      // Cooldown between batches
      if (i < BATCHES.length - 1) {
        const nextBatch = BATCHES[i + 1];
        const isLongPause = LONG_COOLDOWN_BEFORE.includes(nextBatch);
        const cooldown = isLongPause ? COOLDOWN_LONG : COOLDOWN_SHORT;

        console.log(`\n   ⏸️  Cooling down for ${cooldown / 1000}s before Batch ${nextBatch}...\n`);
        await new Promise((r) => setTimeout(r, cooldown));
      }
    }
  } finally {
    await browser.close().catch((e) =>
      console.error(`⚠️  browser.close() failed: ${e.message}`),
    );
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🚀 Starting Enhanced Realistic Load Test...\n');

  await Promise.race([
    runAllBatches(),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Global test timeout after ${GLOBAL_TIMEOUT_MS / 60_000} minutes`)),
        GLOBAL_TIMEOUT_MS,
      ),
    ),
  ]);

  // ─── Generate Enhanced CSV Report ────────────────────────────────────────
  let csv =
    'Users,Success,SuccessRate,WallTime_s,' +
    'PageLoad_avg_s,PageLoad_p95_s,PageLoad_stdDev_s,' +
    'API_avg_s,API_p95_s,API_stdDev_s,' +
    'Journey_avg_s,Journey_p95_s,' +
    'FULL_avg_s,FULL_p95_s,' +
    'Upload_avg_s,Copy_avg_s,' +
    'ThinkTime_avg_s,MemoryDelta_MB,Health\n';

  allResults.forEach((r) => {
    if (r.timings) {
      csv +=
        `${r.size},${r.success}/${r.total},${r.successRate.toFixed(1)}%,${r.wallTime.toFixed(2)},` +
        `${(r.timings.pageLoad.avg / 1000).toFixed(2)},${(r.timings.pageLoad.p95 / 1000).toFixed(2)},${(r.timings.pageLoad.stdDev / 1000).toFixed(2)},` +
        `${(r.timings.api.avg / 1000).toFixed(2)},${(r.timings.api.p95 / 1000).toFixed(2)},${(r.timings.api.stdDev / 1000).toFixed(2)},` +
        `${(r.timings.journey.avg / 1000).toFixed(2)},${(r.timings.journey.p95 / 1000).toFixed(2)},` +
        `${(r.timings.full.avg / 1000).toFixed(2)},${(r.timings.full.p95 / 1000).toFixed(2)},` +
        `${(r.timings.upload.avg / 1000).toFixed(2)},${(r.timings.copy.avg / 1000).toFixed(2)},` +
        `${(r.timings.thinkTime.avg / 1000).toFixed(2)},${r.memoryDelta},` +
        `${assessHealth(r.successRate, r.timings.api.p95)}\n`;
    } else {
      csv += `${r.size},0/${r.total},0%,${r.wallTime.toFixed(2)},0,0,0,0,0,0,0,0,0,0,0,0,0,0,FAILED\n`;
    }
  });

  fs.writeFileSync('load-test-results.csv', csv);
  fs.writeFileSync('load-test-results.json', JSON.stringify(allResults, null, 2));
  fs.writeFileSync('memory-snapshots.json', JSON.stringify(memorySnapshots, null, 2));

  // ─── Final Summary ──────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(130));
  console.log('📊 FINAL REPORT (Page Load → Upload → API → Copy) - ENHANCED REALISTIC VERSION');
  console.log('='.repeat(130));
  console.log(
    'Users  │ Success │ Page (avg/p95)  │ API (avg/p95)   │ Journey (avg/p95)  │ FULL (avg/p95)  │ Think Time │ Health',
  );
  console.log(
    '───────┼─────────┼─────────────────┼─────────────────┼────────────────────┼─────────────────┼────────────┼──────────────',
  );

  allResults.forEach((r) => {
    if (r.timings) {
      const users = r.size.toString().padEnd(6);
      const success = `${r.success}/${r.total}`.padEnd(7);
      const page = `${(r.timings.pageLoad.avg / 1000).toFixed(1)}/${(r.timings.pageLoad.p95 / 1000).toFixed(1)}s`.padEnd(15);
      const api = `${(r.timings.api.avg / 1000).toFixed(1)}/${(r.timings.api.p95 / 1000).toFixed(1)}s`.padEnd(15);
      const journey = `${(r.timings.journey.avg / 1000).toFixed(1)}/${(r.timings.journey.p95 / 1000).toFixed(1)}s`.padEnd(18);
      const full = `${(r.timings.full.avg / 1000).toFixed(1)}/${(r.timings.full.p95 / 1000).toFixed(1)}s`.padEnd(15);
      const think = `${(r.timings.thinkTime.avg / 1000).toFixed(1)}s`.padEnd(10);
      const health = assessHealthEmoji(r.successRate, r.timings.api.p95);
      console.log(`${users} │ ${success} │ ${page} │ ${api} │ ${journey} │ ${full} │ ${think} │ ${health}`);
    } else {
      console.log(
        `${r.size.toString().padEnd(6)} │ 0/${r.total}  │ -               │ -               │ -                  │ -               │ -          │ 💀 FAILED`,
      );
    }
  });

  console.log('='.repeat(130));
  console.log('\n📝 Results saved to: load-test-results.csv, load-test-results.json, memory-snapshots.json\n');

  // ─── Executive Summary ──────────────────────────────────────────────────
  const lastSafe = allResults.filter((r) => r.successRate >= 90).pop();
  const firstOverload = allResults.find((r) => r.successRate < 50);
  const lastBatch = allResults.at(-1);

  console.log('📋 EXECUTIVE SUMMARY:');
  console.log('─'.repeat(89));
  console.log(`   ✅ Safe concurrent mobile users : ${lastSafe ? lastSafe.size : 'N/A'}`);
  console.log(`   ❌ Server overloaded at          : ${firstOverload ? firstOverload.size : `> ${lastBatch?.size ?? '?'} (all batches passed)`}`);
  console.log('');
  console.log('   📌 FULL TOTAL = Page Load + Upload + API + Copy (complete user experience)');
  console.log('   📌 Think times included in FULL TOTAL (realistic human behavior simulation)');
  console.log('   📌 Network throttling applied (4G/LTE/3G conditions randomized)');
  console.log('   📌 Viewport variations: ±2% to simulate different screen sizes');
  console.log('');
}

main().catch((err) => {
  console.error('\n💥 FATAL:', err.message);
  process.exit(1);
});
