'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const { execSync } = require('child_process');

// ── تسخين الكاش ──
console.log('🔥 Warming cache...');
try {
  execSync('curl -s -o /dev/null -w "%{http_code}" https://icarsu.com/accidents/', { stdio: 'inherit' });
  console.log('✅ Cache warmed.\n');
} catch (e) {
  console.log('⚠️  Warm failed, continuing.\n');
}

// ── الأجهزة ──
const MOBILE_DEVICES = [
  { name:'iPhone 14 Pro Max', viewport:{w:430,h:932}, scale:3, mobile:true, touch:true, ua:'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1' },
  { name:'Samsung Galaxy S23', viewport:{w:384,h:854}, scale:3, mobile:true, touch:true, ua:'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Mobile Safari/537.36' },
  { name:'Google Pixel 7', viewport:{w:412,h:915}, scale:2.75, mobile:true, touch:true, ua:'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Mobile Safari/537.36' },
  { name:'iPhone 13', viewport:{w:390,h:844}, scale:3, mobile:true, touch:true, ua:'Mozilla/5.0 (iPhone; CPU iPhone OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1' },
  { name:'Samsung Galaxy S21', viewport:{w:360,h:800}, scale:3, mobile:true, touch:true, ua:'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Mobile Safari/537.36' },
];

const IMAGES = [
  './chassis1.jpg','./chassis2.jpg','./chassis3.jpg','./chassis4.jpg','./chassis5.jpg',
  './chassis6.jpg','./chassis7.jpg','./chassis8.jpg','./chassis9.jpg','./chassis10.jpg',
];

const TARGET_URL = 'https://icarsu.com/accidents/';
const BATCHES = [5,10,15,20,50,100];
const LONG_COOLDOWN_BEFORE = [50,100];
const COOLDOWN_LONG = 30000;
const COOLDOWN_SHORT = 10000;
const allResults = [];

// تحقق من صحة VIN
const isValidVIN = vin => /^[A-HJ-NPR-Z0-9]{17}$/.test(vin);

// بدلاً من انتظار تغيير النص، نتحقق أيضاً من رسائل الخطأ
async function waitForChassis(page, before) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const err = await page.evaluate(() => {
      const b = document.getElementById('blurMsg');
      if (b && b.style.display !== 'none' && b.innerText.trim()) return b.innerText.trim();
      const s = document.getElementById('uploadStatus');
      if (s && s.style.display !== 'none') {
        const t = s.innerText.trim();
        if (/blur|clear|not found|no chassis/i.test(t)) return t;
      }
      return null;
    }).catch(() => null);
    if (err) throw new Error('OCR failed: ' + err);

    const cur = await page.evaluate(() => document.getElementById('chassisText')?.innerText?.trim() ?? '').catch(() => '');
    if (cur && cur !== before) {
      if (!isValidVIN(cur)) throw new Error('Invalid VIN: ' + cur);
      return cur;
    }
    await page.waitForTimeout(300);
  }
  throw new Error('Chassis text did not change');
}

// ── رفع الملف عبر النقر على زر الرفع بدلاً من البحث عن input file ──
async function uploadViaButton(page, imageFile) {
  // ننتظر زر الرفع يكون جاهزاً
  await page.waitForSelector('#uploadBtn', { state: 'visible', timeout: 30000 });
  
  // نضغط على الزر وننتظر فتح محدد الملفات
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15000 }),
    page.click('#uploadBtn'),
  ]);
  
  await fileChooser.setFiles(imageFile);
}

// في حالة فشل الطريقة الأولى، نلجأ للطريقة المباشرة (كتأمين)
async function uploadFileFallback(page, imageFile) {
  const selectors = ['input[type="file"]','#regImage'];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      await el.waitFor({ state: 'attached', timeout: 10000 });
      await el.setInputFiles(imageFile);
      return;
    } catch {}
  }
  throw new Error('No file input found');
}

async function uploadFile(page, imageFile) {
  try {
    await uploadViaButton(page, imageFile);
  } catch (e) {
    console.warn('   ⚠️  Upload via button failed, trying direct input...');
    await uploadFileFallback(page, imageFile);
  }
}

async function clickCopyButton(page) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const clicked = await page.evaluate(() => {
      const all = document.querySelectorAll('a,button,[role="button"],span,div');
      for (const el of all) {
        const txt = (el.innerText||el.textContent||'').toLowerCase();
        if (txt.includes('copy') && (txt.includes('chassis') || txt.trim()==='copy')) {
          if (el.offsetParent !== null) { el.click(); return true; }
        }
      }
      return false;
    }).catch(() => false);
    if (clicked) return;
    await page.waitForTimeout(300);
  }
  throw new Error('Copy button not found');
}

async function runSingleUser(userId, batchSize) {
  let browser;
  const device = MOBILE_DEVICES[Math.floor(Math.random()*MOBILE_DEVICES.length)];
  const img = IMAGES[(userId-1)%IMAGES.length];
  const timings = { pageLoad:0, upload:0, api:0, copy:0, journey:0, full:0 };

  try {
    browser = await chromium.launch({ headless:true, args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-blink-features=AutomationControlled'] });
    const ctx = await browser.newContext({
      viewport: { width: device.viewport.w, height: device.viewport.h },
      deviceScaleFactor: device.scale,
      isMobile: device.mobile,
      hasTouch: device.touch,
      userAgent: device.ua,
    });
    const page = await ctx.newPage();

    const fullStart = Date.now();
    
    // تحميل الصفحة
    const pStart = Date.now();
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60000 });
    timings.pageLoad = Date.now() - pStart;
    await page.waitForTimeout(2000);
    
    const pre = await page.evaluate(() => document.getElementById('chassisText')?.innerText?.trim() ?? '').catch(() => '');
    
    // بداية الرحلة
    const journeyStart = Date.now();
    
    // رفع الصورة
    const upStart = Date.now();
    await uploadFile(page, img);
    timings.upload = Date.now() - upStart;
    
    // انتظار نتيجة الـ OCR
    const apiStart = Date.now();
    const chassis = await waitForChassis(page, pre);
    timings.api = Date.now() - apiStart;
    
    // نسخ
    const copyStart = Date.now();
    await clickCopyButton(page);
    timings.copy = Date.now() - copyStart;
    
    timings.journey = Date.now() - journeyStart;
    timings.full = Date.now() - fullStart;
    
    console.log(`   ✅ [Batch ${batchSize}] User ${userId} | ${device.name} | chassis: ${chassis.slice(0,10)}... | page: ${(timings.pageLoad/1000).toFixed(2)}s | api: ${(timings.api/1000).toFixed(2)}s | FULL: ${(timings.full/1000).toFixed(2)}s`);
    await page.waitForTimeout(1000);
    await browser.close();
    return { success: true, userId, batchSize, timings };
  } catch (e) {
    console.error(`   ❌ [Batch ${batchSize}] User ${userId} | ${e.message}`);
    if (browser) await browser.close().catch(() => {});
    return { success: false, userId, batchSize, error: e.message };
  }
}

// باقي الدوال (runBatch, statistics, main...) كما هي دون تغيير
// (انسخها من الإصدار السابق)
