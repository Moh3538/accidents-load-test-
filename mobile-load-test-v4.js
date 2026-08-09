'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const { execSync } = require('child_process');

// ======================== [ تسخين الكاش ] ========================
console.log('🔥 Warming cache...');
try {
  execSync('curl -s -o /dev/null -w "%{http_code}" https://icarsu.com/accidents/', { stdio: 'inherit' });
  console.log('✅ Cache warmed successfully.\n');
} catch (e) {
  console.log('⚠️  Cache warm failed, continuing anyway.\n');
}

// ======================== [ الأجهزة ] ========================
const MOBILE_DEVICES = [
  { name:'iPhone 14 Pro Max', viewport:{width:430,height:932}, deviceScaleFactor:3, isMobile:true, hasTouch:true, userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1' },
  { name:'Samsung Galaxy S23', viewport:{width:384,height:854}, deviceScaleFactor:3, isMobile:true, hasTouch:true, userAgent:'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Mobile Safari/537.36' },
  { name:'Google Pixel 7', viewport:{width:412,height:915}, deviceScaleFactor:2.75, isMobile:true, hasTouch:true, userAgent:'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Mobile Safari/537.36' },
  { name:'iPhone 13', viewport:{width:390,height:844}, deviceScaleFactor:3, isMobile:true, hasTouch:true, userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1' },
  { name:'Samsung Galaxy S21', viewport:{width:360,height:800}, deviceScaleFactor:3, isMobile:true, hasTouch:true, userAgent:'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Mobile Safari/537.36' },
];

const IMAGES = [
  './chassis1.jpg','./chassis2.jpg','./chassis3.jpg','./chassis4.jpg','./chassis5.jpg',
  './chassis6.jpg','./chassis7.jpg','./chassis8.jpg','./chassis9.jpg','./chassis10.jpg',
];

const TARGET_URL = 'https://icarsu.com/accidents/';
const API_TIMEOUT = 120000;
const BATCHES = [5,10,15,20,50,100];
const LONG_COOLDOWN_BEFORE = [50,100];
const COOLDOWN_LONG = 30000;
const COOLDOWN_SHORT = 10000;
const allResults = [];

function isValidVIN(vin) { return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin); }

async function waitForChassisChange(page, before) {
  const deadline = Date.now() + API_TIMEOUT;
  while (Date.now() < deadline) {
    const errorMsg = await page.evaluate(() => {
      const blurEl = document.getElementById('blurMsg');
      if (blurEl && blurEl.style.display !== 'none' && blurEl.innerText.trim().length > 0) return blurEl.innerText.trim();
      const statusEl = document.getElementById('uploadStatus');
      if (statusEl && statusEl.style.display !== 'none' && statusEl.innerText.trim().length > 0) {
        const t = statusEl.innerText.trim();
        if (t.includes('blur')||t.includes('clear')||t.includes('not found')||t.includes('No chassis')) return t;
      }
      return null;
    }).catch(()=>null);
    if (errorMsg) throw new Error(`OCR failed: ${errorMsg}`);
    const current = await page.evaluate(() => document.getElementById('chassisText')?.innerText?.trim()??'').catch(()=>'');
    if (current.length>0 && current!==before) {
      if (!isValidVIN(current)) throw new Error(`Invalid VIN: "${current}"`);
      return current;
    }
    await page.waitForTimeout(300);
  }
  throw new Error('Chassis text did not change');
}

async function uploadFile(page, imageFile, timeoutMs=30000) { // ← زودناها لـ30 ثانية
  const selectors = ['input[type="file"]','input[id="regImage"]','#regImage','[accept*="image"]','input[type="file"][accept]'];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      await el.waitFor({ state:'attached', timeout:timeoutMs });
      await el.setInputFiles(imageFile);
      return;
    } catch {}
  }
  throw new Error(`File input not found within ${timeoutMs/1000}s`);
}

async function clickCopyButton(page, timeoutMs=15000) {
  const deadline = Date.now()+timeoutMs;
  while (Date.now()<deadline) {
    const clicked = await page.evaluate(() => {
      const all = document.querySelectorAll('a,button,[role="button"],span,div');
      for (const el of all) {
        const txt = el.innerText||el.textContent||'';
        if ((txt.includes('Copy')&&txt.includes('Chassis'))||txt.trim()==='Copy'||txt.includes('Copy Chassis')) {
          if (el.offsetParent!==null) { el.click(); return true; }
        }
      }
      return false;
    }).catch(()=>false);
    if (clicked) return;
    await page.waitForTimeout(300);
  }
  throw new Error('Copy button not found');
}

async function runSingleUser(userId, batchSize) {
  let browser;
  const device = MOBILE_DEVICES[Math.floor(Math.random()*MOBILE_DEVICES.length)];
  const img = IMAGES[(userId-1)%IMAGES.length];
  const timings = { pageLoad:0, upload:0, api:0, copy:0, journeyTotal:0, fullTotal:0 };
  try {
    browser = await chromium.launch({ headless:true, args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-blink-features=AutomationControlled'] });
    const ctx = await browser.newContext({ viewport:device.viewport, deviceScaleFactor:device.deviceScaleFactor, isMobile:device.isMobile, hasTouch:device.hasTouch, userAgent:device.userAgent });
    const page = await ctx.newPage();
    const fullStart = Date.now();

    const pStart = Date.now();
    await page.goto(TARGET_URL, { waitUntil:'networkidle', timeout:60000 });
    timings.pageLoad = Date.now()-pStart;
    await page.waitForTimeout(2000);
    const pre = await page.evaluate(()=>document.getElementById('chassisText')?.innerText?.trim()??'').catch(()=>'');

    const journeyStart = Date.now();

    const upStart = Date.now();
    await uploadFile(page, img);
    timings.upload = Date.now()-upStart;

    const apiStart = Date.now();
    const chassis = await waitForChassisChange(page, pre);
    timings.api = Date.now()-apiStart;

    const copyStart = Date.now();
    await clickCopyButton(page, 10000);
    timings.copy = Date.now()-copyStart;

    timings.journeyTotal = Date.now()-journeyStart;
    timings.fullTotal = Date.now()-fullStart;

    console.log(`   ✅ [Batch ${batchSize}] User ${userId} | ${device.name} | chassis: ${chassis.substring(0,10)}... | page: ${(timings.pageLoad/1000).toFixed(2)}s | api: ${(timings.api/1000).toFixed(2)}s | FULL: ${(timings.fullTotal/1000).toFixed(2)}s`);
    await page.waitForTimeout(1000);
    await browser.close();
    return { success:true, userId, batchSize, timings };
  } catch(e) {
    console.error(`   ❌ [Batch ${batchSize}] User ${userId} | ${e.message}`);
    if (browser) await browser.close().catch(()=>{});
    return { success:false, userId, batchSize, error:e.message };
  }
}

async function runBatch(size) {
  console.log(`\n${'='.repeat(80)}\n🔥 BATCH: ${size} CONCURRENT USERS — كلهم بيبدأوا دلوقتي\n${'='.repeat(80)}`);
  const start = Date.now();
  const results = await Promise.all(Array.from({length:size},(_,i)=>runSingleUser(i+1,size)));
  const dur = (Date.now()-start)/1000;
  const success = results.filter(r=>r.success);
  const failed = results.filter(r=>!r.success);
  if (success.length===0) {
    console.log(`\n   ❌ ALL ${size} USERS FAILED`);
    return { size, success:0, total:size, successRate:0, wallTime:dur, timings:null, errors:failed.slice(0,3).map(f=>f.error) };
  }
  const pTimes = success.map(r=>r.timings.pageLoad);
  const aTimes = success.map(r=>r.timings.api);
  const jTimes = success.map(r=>r.timings.journeyTotal);
  const fTimes = success.map(r=>r.timings.fullTotal);
  const uTimes = success.map(r=>r.timings.upload);
  const cTimes = success.map(r=>r.timings.copy);
  return {
    size, success:success.length, total:size, successRate:(success.length/size)*100, wallTime:dur,
    timings: {
      pageLoad: { avg:avg(pTimes), min:Math.min(...pTimes), max:Math.max(...pTimes), p95:percentile(pTimes,95) },
      upload:   { avg:avg(uTimes), min:Math.min(...uTimes), max:Math.max(...uTimes), p95:percentile(uTimes,95) },
      api:      { avg:avg(aTimes), min:Math.min(...aTimes), max:Math.max(...aTimes), p95:percentile(aTimes,95) },
      copy:     { avg:avg(cTimes), p95:percentile(cTimes,95) },
      journey:  { avg:avg(jTimes), min:Math.min(...jTimes), max:Math.max(...jTimes), p95:percentile(jTimes,95) },
      full:     { avg:avg(fTimes), min:Math.min(...fTimes), max:Math.max(...fTimes), p95:percentile(fTimes,95) },
    },
    errors: failed.slice(0,5).map(f=>f.error)
  };
}

function avg(a) { return a.reduce((x,y)=>x+y,0)/a.length; }
function percentile(a,p) { const s=[...a].sort((x,y)=>x-y); const i=Math.ceil((p/100)*s.length)-1; return s[Math.max(0,i)]??0; }
function assessHealth(sr,ap) {
  if (sr===0) return '💀 FAILED';
  if (sr<50) return '💀 OVERLOADED';
  if (sr<80) return '🔴 CRITICAL';
  if (ap>20000) return '🟠 DEGRADED';
  if (ap>10000) return '🟡 GOOD';
  return '🟢 EXCELLENT';
}

async function main() {
  console.log('\n📱 ========================================');
  console.log('📱 iCarsU MOBILE LOAD TEST - FINAL');
  console.log('📱 (Cache pre-warmed + 30s upload timeout)');
  console.log('📱 ========================================\n');

  for (let i=0;i<BATCHES.length;i++) {
    const size = BATCHES[i];
    const result = await runBatch(size);
    allResults.push(result);
    if (result.timings) {
      console.log(`\n   📊 Batch ${size} Results:`);
      console.log(`   ✅ Success    : ${result.success}/${result.total} (${result.successRate.toFixed(1)}%)`);
      console.log(`   ⏱️  Wall Time  : ${result.wallTime.toFixed(2)}s`);
      console.log(`   📄 Page Load  : avg ${(result.timings.pageLoad.avg/1000).toFixed(2)}s | p95 ${(result.timings.pageLoad.p95/1000).toFixed(2)}s`);
      console.log(`   🔬 API        : avg ${(result.timings.api.avg/1000).toFixed(2)}s | p95 ${(result.timings.api.p95/1000).toFixed(2)}s`);
      console.log(`   📋 Journey    : avg ${(result.timings.journey.avg/1000).toFixed(2)}s | p95 ${(result.timings.journey.p95/1000).toFixed(2)}s`);
      console.log(`   🎯 FULL TOTAL : avg ${(result.timings.full.avg/1000).toFixed(2)}s | p95 ${(result.timings.full.p95/1000).toFixed(2)}s`);
      console.log(`   🏥 Health     : ${assessHealth(result.successRate, result.timings.api.p95)}`);
    } else {
      console.log(`\n   ❌ Batch ${size}: ALL FAILED`);
      if (result.errors?.length) {
        console.log('   📋 Sample errors:');
        result.errors.slice(0,3).forEach(e=>console.log(`      - ${e}`));
      }
    }
    if (i<BATCHES.length-1) {
      const next = BATCHES[i+1];
      const long = LONG_COOLDOWN_BEFORE.includes(next);
      const cd = long?COOLDOWN_LONG:COOLDOWN_SHORT;
      console.log(`\n   ⏸️  Cooling down for ${cd/1000}s before Batch ${next}...\n`);
      await new Promise(r=>setTimeout(r,cd));
    }
  }

  let csv = 'Users,Success,SuccessRate,WallTime_s,PageLoad_avg_s,PageLoad_p95_s,API_avg_s,API_p95_s,Journey_avg_s,Journey_p95_s,FULL_avg_s,FULL_p95_s,Upload_avg_s,Copy_avg_s,Health\n';
  allResults.forEach(r=>{
    if (r.timings) {
      csv += `${r.size},${r.success}/${r.total},${r.successRate.toFixed(1)}%,${r.wallTime.toFixed(2)},` +
        `${(r.timings.pageLoad.avg/1000).toFixed(2)},${(r.timings.pageLoad.p95/1000).toFixed(2)},` +
        `${(r.timings.api.avg/1000).toFixed(2)},${(r.timings.api.p95/1000).toFixed(2)},` +
        `${(r.timings.journey.avg/1000).toFixed(2)},${(r.timings.journey.p95/1000).toFixed(2)},` +
        `${(r.timings.full.avg/1000).toFixed(2)},${(r.timings.full.p95/1000).toFixed(2)},` +
        `${(r.timings.upload.avg/1000).toFixed(2)},${(r.timings.copy.avg/1000).toFixed(2)},` +
        `${assessHealth(r.successRate, r.timings.api.p95)}\n`;
    } else {
      csv += `${r.size},0/${r.total},0%,${r.wallTime.toFixed(2)},0,0,0,0,0,0,0,0,0,0,FAILED\n`;
    }
  });
  fs.writeFileSync('load-test-results.csv', csv);
  fs.writeFileSync('load-test-results.json', JSON.stringify(allResults,null,2));

  // التقرير النهائي
  console.log('\n' + '='.repeat(120));
  console.log('📊 FINAL REPORT');
  console.log('='.repeat(120));
  console.log('Users  │ Success │ Page (avg/p95)  │ API (avg/p95)  │ Journey (avg/p95)  │ FULL (avg/p95)  │ Health');
  console.log('───────┼─────────┼─────────────────┼────────────────┼────────────────────┼─────────────────┼──────────────');
  allResults.forEach(r=>{
    if (r.timings) {
      const u = r.size.toString().padEnd(6); 
      const s = `${r.success}/${r.total}`.padEnd(7);
      const pg = `${(r.timings.pageLoad.avg/1000).toFixed(1)}/${(r.timings.pageLoad.p95/1000).toFixed(1)}s`.padEnd(15);
      const ap = `${(r.timings.api.avg/1000).toFixed(1)}/${(r.timings.api.p95/1000).toFixed(1)}s`.padEnd(14);
      const jn = `${(r.timings.journey.avg/1000).toFixed(1)}/${(r.timings.journey.p95/1000).toFixed(1)}s`.padEnd(18);
      const fl = `${(r.timings.full.avg/1000).toFixed(1)}/${(r.timings.full.p95/1000).toFixed(1)}s`.padEnd(15);
      const hl = assessHealth(r.successRate, r.timings.api.p95);
      console.log(`${u} │ ${s} │ ${pg} │ ${ap} │ ${jn} │ ${fl} │ ${hl}`);
    } else {
      console.log(`${r.size.toString().padEnd(6)} │ 0/${r.total}  │ -               │ -              │ -                  │ -               │ FAILED`);
    }
  });
  console.log('='.repeat(120));
  console.log('\n📝 Results saved.\n');
}

main().catch(console.error);
