// Automated checks for the new tab page. Run with:  npm test
// (Needs ffmpeg to create the test videos, and Playwright's Chromium.)
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { launch, openNewTab, decodePng, NEWTAB_URL, EXT_DIR } = require('./helpers');

const SHOTS = path.join(EXT_DIR, 'test-shots');
const FIX = path.join(__dirname, 'fixtures');

const SIZES = [
  { name: 'ultrawide-3440x1440', width: 3440, height: 1440 },
  { name: 'qhd-2560x1440', width: 2560, height: 1440 },
  { name: 'fullhd-1920x1080', width: 1920, height: 1080 },
  { name: 'tall-1280x1600', width: 1280, height: 1600 },
  { name: 'narrow-480x1000', width: 480, height: 1000 },
];

before(() => {
  fs.mkdirSync(SHOTS, { recursive: true });
  execFileSync(path.join(__dirname, 'make-fixtures.sh'), { stdio: 'ignore' });
});

// ---------- helpers

// Collect every request the extension's pages make. Anything that isn't local is a failure.
function watchNetwork(context) {
  const external = [];
  context.on('request', (req) => {
    const u = req.url();
    if (!/^(chrome-extension|blob|data):/.test(u)) external.push(u);
  });
  return external;
}

async function waitForVideoPlaying(page) {
  await page.waitForFunction(() => {
    const v = document.getElementById('bgVideo');
    return v && !v.hidden && v.classList.contains('ready') && !v.paused && v.currentTime > 0;
  }, null, { timeout: 20000 });
}

// Measures how the video is drawn: element box, and the size of the actual picture inside it.
function measureCover(page, selector = '#bgVideo') {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const iw = el.videoWidth || el.naturalWidth;
    const ih = el.videoHeight || el.naturalHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // object-fit: cover scales by the larger ratio.
    const scale = Math.max(r.width / iw, r.height / ih);
    return { rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, objectFit: cs.objectFit, vw, vh, iw, ih, drawnW: iw * scale, drawnH: ih * scale };
  }, selector);
}

function assertCovers(m, label) {
  assert.equal(m.objectFit, 'cover', `${label}: object-fit should be cover`);
  assert.ok(m.rect.left <= 0 && m.rect.top <= 0, `${label}: background starts at the top-left corner`);
  assert.ok(m.rect.right >= m.vw && m.rect.bottom >= m.vh, `${label}: background reaches the right/bottom edges (${JSON.stringify(m.rect)} vs ${m.vw}x${m.vh})`);
  assert.ok(m.drawnW >= m.vw - 0.5 && m.drawnH >= m.vh - 0.5, `${label}: picture is at least as big as the window (${m.drawnW}x${m.drawnH} vs ${m.vw}x${m.vh})`);
}

// No black bars: sample pixels along all four edges of a screenshot.
function assertNoBlackEdges(png, label) {
  const img = decodePng(png);
  const bad = [];
  const check = (x, y) => {
    const [r, g, b] = img.pixel(x, y);
    if (Math.max(r, g, b) < 8) bad.push(`${x},${y}`);
  };
  for (let x = 0; x < img.width; x += 7) { check(x, 0); check(x, 2); check(x, img.height - 1); check(x, img.height - 3); }
  for (let y = 0; y < img.height; y += 7) { check(0, y); check(2, y); check(img.width - 1, y); check(img.width - 3, y); }
  assert.equal(bad.length, 0, `${label}: found black pixels at the edges, e.g. ${bad.slice(0, 5).join(' ')}`);
}

async function uploadFile(page, file) {
  const before = await page.evaluate(() => document.body.dataset.uploaded || '');
  await openSettings(page);
  await page.setInputFiles('#upload', file);
  await page.waitForFunction((b) => (document.body.dataset.uploaded || '') !== b, before, { timeout: 60000 });
  return page.evaluate(() => ({ status: document.getElementById('uploadStatus').textContent, error: document.getElementById('uploadStatus').classList.contains('error') }));
}

// Mouse only: move into the top-right corner, then click the gear.
async function openSettings(page) {
  if (await page.isVisible('#panel')) return;
  const vp = page.viewportSize();
  await page.mouse.move(vp.width - 40, 36);
  await page.waitForTimeout(350);
  await page.click('#gear');
  await page.waitForSelector('#panel', { state: 'visible' });
}

async function closeSettings(page) {
  if (await page.isVisible('#panel')) await page.click('#closePanel');
  await page.mouse.move(10, 300);
}

async function setRange(page, id, value) {
  await page.evaluate(([id, value]) => {
    const el = document.getElementById(id);
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [id, value]);
}

// Playwright's Chromium never reports a tab as hidden (see NOTES.md), so we
// simulate the browser's "tab hidden / shown" signal the page listens for.
async function setTabVisibility(page, state) {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => s === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

// ---------- tests

describe('plain by default', () => {
  test('a fresh install shows only the animated background', async () => {
    const { context } = await launch();
    const external = watchNetwork(context);
    try {
      const page = await openNewTab(context);
      await waitForVideoPlaying(page);
      const state = await page.evaluate(() => ({
        text: document.body.innerText.trim(),
        clockHidden: document.getElementById('clock').hidden,
        sitesHidden: document.getElementById('topSites').hidden,
        panelHidden: document.getElementById('panel').hidden,
        gearOpacity: getComputedStyle(document.getElementById('gear')).opacity,
        muted: document.getElementById('bgVideo').muted,
        loop: document.getElementById('bgVideo').loop,
      }));
      assert.equal(state.text, '', 'no visible text at all');
      assert.ok(state.clockHidden && state.sitesHidden && state.panelHidden);
      assert.equal(state.gearOpacity, '0', 'gear is invisible until hovered');
      assert.ok(state.muted && state.loop, 'video is muted and loops');

      // Hovering the top-right corner reveals the gear faintly.
      await page.mouse.move(page.viewportSize().width - 40, 36);
      await page.waitForTimeout(400);
      const hovered = Number(await page.evaluate(() => getComputedStyle(document.getElementById('gear')).opacity));
      assert.ok(hovered > 0.3, 'gear shows on hover');
      await page.screenshot({ path: path.join(SHOTS, 'gear-on-hover.png') });
      assert.deepEqual(external, []);
    } finally { await context.close(); }
  });
});

describe('fills the window at every size (no squish, no black bars)', () => {
  let context, page, external;
  before(async () => {
    ({ context } = await launch());
    external = watchNetwork(context);
    page = await openNewTab(context);
    await waitForVideoPlaying(page);
  });
  after(async () => {
    assert.deepEqual(external, [], 'no network requests');
    await context.close();
  });

  for (const size of SIZES) {
    test(`${size.width}×${size.height}`, async () => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.waitForTimeout(300);
      await waitForVideoPlaying(page);
      assertCovers(await measureCover(page), size.name);
      const png = await page.screenshot({ path: path.join(SHOTS, `${size.name}.png`) });
      assertNoBlackEdges(png, size.name);
    });
  }

  test('a square (1:1) video still fills an ultrawide and a tall window', async () => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    const res = await uploadFile(page, path.join(FIX, 'square.webm'));
    assert.equal(res.error, false, res.status);
    await closeSettings(page);
    for (const s of [SIZES[0], SIZES[3], SIZES[4]]) {
      await page.setViewportSize({ width: s.width, height: s.height });
      await page.waitForTimeout(300);
      await waitForVideoPlaying(page);
      const m = await measureCover(page);
      assert.equal(m.iw, 720);
      assertCovers(m, 'square video ' + s.name);
      assertNoBlackEdges(await page.screenshot(), 'square video ' + s.name);
    }
  });

  test('a GIF fills the window too', async () => {
    await page.setViewportSize({ width: 3440, height: 1440 });
    const res = await uploadFile(page, path.join(FIX, 'anim.gif'));
    assert.equal(res.error, false, res.status);
    await closeSettings(page);
    await page.waitForFunction(() => document.getElementById('bgImage').classList.contains('ready'));
    const m = await measureCover(page, '#bgImage');
    assertCovers(m, 'gif');
    assertNoBlackEdges(await page.screenshot({ path: path.join(SHOTS, 'gif-ultrawide-3440x1440.png') }), 'gif');
  });
});

describe('light: only plays while the tab is visible', () => {
  test('pauses when hidden, resumes when shown', async () => {
    const { context } = await launch();
    try {
      const page = await openNewTab(context);
      await waitForVideoPlaying(page);

      await setTabVisibility(page, 'hidden');
      const t1 = await page.evaluate(() => document.getElementById('bgVideo').currentTime);
      await page.waitForTimeout(700);
      const hidden = await page.evaluate(() => ({ paused: document.getElementById('bgVideo').paused, t: document.getElementById('bgVideo').currentTime }));
      assert.equal(hidden.paused, true, 'video paused while hidden');
      assert.equal(hidden.t, t1, 'no frames decoded while hidden');

      await setTabVisibility(page, 'visible');
      await page.waitForTimeout(700);
      const shown = await page.evaluate(() => ({ paused: document.getElementById('bgVideo').paused, t: document.getElementById('bgVideo').currentTime }));
      assert.equal(shown.paused, false, 'video plays again');
      assert.ok(shown.t > t1, 'video moved on');
    } finally { await context.close(); }
  });

  test('a tab opened in the background loads nothing until it is shown', async () => {
    const { context } = await launch();
    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      });
      await page.goto(NEWTAB_URL);
      await page.waitForSelector('body[data-ready="1"]');
      await page.waitForTimeout(500);
      const src = await page.evaluate(() => document.getElementById('bgVideo').getAttribute('src'));
      assert.equal(src, null, 'video not loaded while hidden');
      await setTabVisibility(page, 'visible');
      await waitForVideoPlaying(page);
    } finally { await context.close(); }
  });

  test('"Pause animation" stops the video', async () => {
    const { context } = await launch();
    try {
      const page = await openNewTab(context);
      await waitForVideoPlaying(page);
      await openSettings(page);
      await page.click('label.toggle:has(#paused)');
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => document.getElementById('bgVideo').paused), true);
      await page.reload();
      await page.waitForSelector('body[data-ready="1"]');
      await page.waitForFunction(() => document.getElementById('bgVideo').classList.contains('ready'));
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(() => document.getElementById('bgVideo').paused), true, 'still paused after reload');
    } finally { await context.close(); }
  });
});

describe('upload, persist, reload', () => {
  test('a 50 MB video survives reloads and a browser restart', async () => {
    const big = path.join(FIX, 'big-50mb.webm');
    assert.ok(fs.statSync(big).size >= 50 * 1024 * 1024 * 0.99, 'test file is ~50 MB');

    const { context, userDir } = await launch();
    const external = watchNetwork(context);
    let page = await openNewTab(context);
    await waitForVideoPlaying(page);
    const res = await uploadFile(page, big);
    assert.equal(res.error, false, res.status);
    await closeSettings(page);
    await waitForVideoPlaying(page);
    const first = await page.evaluate(() => ({ src: document.getElementById('bgVideo').src, w: document.getElementById('bgVideo').videoWidth }));
    assert.match(first.src, /^blob:/, 'playing the uploaded file');
    assert.equal(first.w, 1920);

    await page.reload();
    await page.waitForSelector('body[data-ready="1"]');
    await waitForVideoPlaying(page);
    const poster = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--poster'));
    assert.match(poster, /data:image\/jpeg/, 'its still image shows instantly on load');
    assert.equal(await page.evaluate(() => document.getElementById('bgVideo').videoWidth), 1920);
    assert.deepEqual(external, []);
    await context.close();

    // Restart the browser with the same profile.
    const again = await launch({ userDir });
    try {
      page = await openNewTab(again.context);
      await waitForVideoPlaying(page);
      const after = await page.evaluate(() => ({ src: document.getElementById('bgVideo').src, w: document.getElementById('bgVideo').videoWidth }));
      assert.match(after.src, /^blob:/);
      assert.equal(after.w, 1920, 'the 50 MB video is still there after restart');
      await openSettings(page);
      assert.equal(await page.locator('.lib-item').count(), 2, 'library: built-in + uploaded');
      await page.screenshot({ path: path.join(SHOTS, 'settings-panel.png') });
    } finally { await again.context.close(); }
  });

  test('removing a background goes back to the built-in one', async () => {
    const { context } = await launch();
    try {
      const page = await openNewTab(context);
      await waitForVideoPlaying(page);
      await uploadFile(page, path.join(FIX, 'square.webm'));
      await waitForVideoPlaying(page);
      assert.match(await page.evaluate(() => document.getElementById('bgVideo').src), /^blob:/);
      page.once('dialog', (d) => d.accept());
      await page.hover('.lib-item:not([data-id="default"])');
      await page.click('.lib-item:not([data-id="default"]) .lib-delete');
      await page.waitForFunction(() => document.querySelectorAll('.lib-item').length === 1);
      await waitForVideoPlaying(page);
      assert.match(await page.evaluate(() => document.getElementById('bgVideo').src), /bg\/default\.webm$/);
    } finally { await context.close(); }
  });

  test('a different background for very wide windows', async () => {
    const { context } = await launch({ viewport: { width: 1920, height: 1080 } });
    try {
      const page = await openNewTab(context);
      await waitForVideoPlaying(page);
      await uploadFile(page, path.join(FIX, 'square.webm'));     // becomes the normal background
      const squareId = await page.evaluate(() => document.querySelector('.lib-item.active').dataset.id);
      await page.click('.lib-item[data-id="default"]');            // normal = built-in again
      await page.selectOption('#wideSelect', squareId);             // ultrawide = square video
      await closeSettings(page);

      await waitForVideoPlaying(page);
      assert.match(await page.evaluate(() => document.getElementById('bgVideo').src), /default\.webm$/, '16:9 window uses the normal one');

      await page.setViewportSize({ width: 3440, height: 1440 });
      await page.waitForFunction(() => document.getElementById('bgVideo').src.startsWith('blob:'), null, { timeout: 5000 });
      await waitForVideoPlaying(page);
      assert.equal(await page.evaluate(() => document.getElementById('bgVideo').videoWidth), 720, 'ultrawide window uses the wide one');

      await page.setViewportSize({ width: 2560, height: 1440 });
      await page.waitForFunction(() => document.getElementById('bgVideo').src.endsWith('default.webm'), null, { timeout: 5000 });
    } finally { await context.close(); }
  });
});

describe('settings', () => {
  test('settings persist across reloads and restarts', async () => {
    const { context, userDir } = await launch();
    let page = await openNewTab(context);
    await openSettings(page);
    await page.click('label.toggle:has(#clockOn)');
    await page.click('label.toggle:has(#clock24)');
    await page.click('label.toggle:has(#topSitesOn)');
    await setRange(page, 'dim', 35);
    await setRange(page, 'focusX', 30);
    await setRange(page, 'focusY', 40);
    await page.waitForTimeout(600); // slider saves are batched
    await closeSettings(page);
    const clockText = await page.textContent('#clock');
    assert.match(clockText, /^\d{2}:\d{2}$/, '24-hour clock');
    await context.close();

    const again = await launch({ userDir });
    try {
      page = await openNewTab(again.context);
      const s = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        return {
          clock: !document.getElementById('clock').hidden,
          text: document.getElementById('clock').textContent,
          dim: getComputedStyle(document.getElementById('shade')).opacity,
          pos: getComputedStyle(document.getElementById('bgVideo')).objectPosition,
          fx: cs.getPropertyValue('--fx').trim(),
        };
      });
      assert.equal(s.clock, true);
      assert.match(s.text, /^\d{2}:\d{2}$/);
      assert.equal(s.dim, '0.35');
      assert.equal(s.pos, '30% 40%');
      await openSettings(page);
      assert.equal(await page.isChecked('#clockOn'), true);
      assert.equal(await page.isChecked('#clock24'), true);
      assert.equal(await page.isChecked('#topSitesOn'), true);
      assert.equal(await page.inputValue('#dim'), '35');
    } finally { await again.context.close(); }
  });

  test('12-hour clock (Brave style, top-left)', async () => {
    const { context } = await launch();
    try {
      const page = await openNewTab(context);
      await openSettings(page);
      await page.click('label.toggle:has(#clockOn)');
      await closeSettings(page);
      const text = await page.textContent('#clock');
      assert.match(text, /^(1[0-2]|[1-9]):\d{2}$/);
      const box = await page.locator('#clock').boundingBox();
      assert.ok(box.x < 100 && box.y < 140, 'top-left, under the favourites star');
    } finally { await context.close(); }
  });
});

describe('top sites (with a local test website)', () => {
  test('tiles show with favicons and can be removed', async () => {
    const http = require('http');
    const server = http.createServer((req, res) => {
      const name = String(req.headers.host || 'site').split('.')[0];
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<!doctype html><title>${name[0].toUpperCase() + name.slice(1)}</title><h1>${name}</h1>`);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    // Pretend *.test websites exist, served by the local test server above.
    const { context } = await launch({ viewport: { width: 1920, height: 1080 }, extraArgs: ['--host-resolver-rules=MAP *.test 127.0.0.1'] });
    try {
      // Build some browsing history (only this helper tab talks to the local server).
      const browse = await context.newPage();
      for (const site of ['news', 'mail', 'music', 'maps', 'photos']) {
        for (let i = 0; i < 3; i++) await browse.goto(`http://${site}.test:${port}/page${i}`);
      }
      await browse.close();

      const page = await context.newPage();
      const external = [];
      page.on('request', (r) => { if (!/^(chrome-extension|blob|data):/.test(r.url())) external.push(r.url()); });
      await page.goto(NEWTAB_URL);
      await page.waitForSelector('body[data-ready="1"]');
      await openSettings(page);
      await page.click('label.toggle:has(#topSitesOn)');
      await closeSettings(page);

      // Chromium refreshes its "most visited" list on a timer (~15 s).
      let tiles = 0;
      for (let i = 0; i < 60 && tiles < 5; i++) {
        await page.waitForTimeout(1000);
        await page.reload();
        await page.waitForSelector('body[data-ready="1"]');
        tiles = await page.locator('.tile[href*=".test:"]').count();
      }
      assert.ok(tiles >= 5, `expected the visited sites as tiles, got ${tiles}`);
      const all = await page.locator('.tile').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
      assert.ok(all.every((u) => /^https?:/.test(u)), 'only real websites (not the new tab page itself)');
      assert.ok(all.length <= 6, 'at most 6 tiles');
      const favicon = await page.locator('.tile-icon img').first().getAttribute('src');
      assert.match(favicon, /^chrome-extension:\/\/[a-p]{32}\/_favicon\//, 'favicon comes from the local cache');
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(SHOTS, 'clock-off-topsites-on.png') });

      const first = await page.locator('.tile').first().getAttribute('href');
      await page.hover('.tile >> nth=0');
      await page.click('.tile >> nth=0 >> .tile-remove');
      await page.waitForTimeout(300);
      const hrefs = await page.locator('.tile').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
      assert.ok(!hrefs.includes(first), 'removed site is gone');
      await page.reload();
      await page.waitForSelector('body[data-ready="1"]');
      await page.waitForTimeout(300);
      const hrefs2 = await page.locator('.tile').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
      assert.ok(!hrefs2.includes(first), 'stays removed after reload');
      assert.deepEqual(external, [], 'the new tab page itself made no network requests');

      // Screenshot with everything turned on, for a look at the Brave-style widgets.
      await openSettings(page);
      await page.click('label.toggle:has(#clockOn)');
      await closeSettings(page);
      await page.screenshot({ path: path.join(SHOTS, 'clock-and-topsites-on.png') });
    } finally {
      await context.close();
      server.close();
    }
  });
});

describe('favourites', () => {
  const opacity = (page, id) => page.evaluate((i) => Number(getComputedStyle(document.getElementById(i)).opacity), id);

  test('hidden star in the top-left: hover to open, add, reorder, remove, persist', async () => {
    const { context, userDir } = await launch();
    const external = watchNetwork(context);
    let page = await openNewTab(context);
    try {
      assert.equal(await opacity(page, 'favBtn'), 0, 'invisible until hovered');
      // Near the corner (but not on the star): the star shows, the list stays closed.
      await page.mouse.move(130, 60);
      await page.waitForTimeout(400);
      assert.ok(await opacity(page, 'favBtn') > 0.3, 'shows when the mouse is near');
      assert.equal(await page.isVisible('#favPanel'), false, 'list not open yet');
      // On the star: the list drops down, no click needed.
      await page.hover('#favBtn');
      await page.waitForSelector('#favPanel', { state: 'visible', timeout: 1000 });
      assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('favPanel')).animationName), 'favOpen', 'opens with an animation');
      assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('favPanel')).backgroundImage + getComputedStyle(document.getElementById('favPanel')).backgroundColor), 'nonergba(0, 0, 0, 0)', 'no panel behind the list');
      // Moving from the star down into the list keeps it open.
      await page.mouse.move(40, 58, { steps: 4 });
      await page.hover('.fav-head'); await page.waitForTimeout(400);
      assert.equal(await page.isVisible('#favPanel'), true, 'stays open while moving into the list');
      assert.equal(await opacity(page, 'favEdit'), 1, 'Edit shows on hover');
      assert.equal(await page.isVisible('#favEmpty'), true, 'empty hint');
      // Moving away folds it up.
      await page.mouse.move(900, 600);
      await page.waitForSelector('#favPanel', { state: 'hidden', timeout: 2000 });

      await page.hover('#favBtn');
      await page.hover('.fav-head');
      await page.click('#favEdit');
      for (const [n, u] of [['YouTube', 'youtube.com'], ['', 'x.com'], ['Notion', 'https://www.notion.so/']]) {
        await page.fill('#favName', n);
        await page.fill('#favUrl', u);
        await page.click('#favForm button[type=submit]');
      }
      await page.mouse.move(900, 600); await page.waitForTimeout(600);
      assert.equal(await page.isVisible('#favPanel'), true, 'stays open while editing, even with the mouse away');
      await page.click('.fav-row:nth-child(3) button[title="Move up"]');
      await page.click('#favEdit');   // Done
      const rows = await page.locator('a.fav-row').evaluateAll((els) => els.map((e) => [e.textContent, e.getAttribute('href')]));
      assert.deepEqual(rows, [['YouTube', 'https://youtube.com/'], ['Notion', 'https://www.notion.so/'], ['X', 'https://x.com/']]);
      await page.screenshot({ path: path.join(SHOTS, 'favourites-open.png') });
      await page.mouse.move(900, 600);
      await page.waitForSelector('#favPanel', { state: 'hidden', timeout: 2000 });   // after the closing animation
      assert.equal(await page.isVisible('#favPanel'), false, 'moving away closes it');

      // While editing, a click outside closes it.
      await page.hover('#favBtn'); await page.hover('.fav-head');
      await page.click('#favEdit');
      await page.mouse.click(900, 600);
      await page.waitForSelector('#favPanel', { state: 'hidden', timeout: 2000 });
      await context.close();

      const again = await launch({ userDir });
      page = await openNewTab(again.context);
      await page.mouse.move(130, 60); await page.waitForTimeout(300);
      await page.hover('#favBtn');
      await page.hover('.fav-head');
      await page.click('#favEdit');
      await page.click('.fav-row:nth-child(1) button[title^="Remove"]');
      await page.click('#favEdit');
      const names = await page.locator('a.fav-row .fav-name').allTextContents();
      assert.deepEqual(names, ['Notion', 'X'], 'kept after restart, removal works');
      assert.equal(await page.evaluate(() => document.body.innerText.includes('Favourites')), true);
      await again.context.close();
      assert.deepEqual(external, []);
    } catch (e) { await context.close().catch(() => {}); throw e; }
  });

  test('one-click site next to the star: hidden until hovered, set up in settings, persists', async () => {
    const { context, userDir } = await launch();
    const external = watchNetwork(context);
    let page = await openNewTab(context);
    try {
      assert.equal(await opacity(page, 'quickLink'), 0, 'invisible until the mouse is near');
      await page.mouse.move(130, 60); await page.waitForTimeout(400);
      assert.ok(await opacity(page, 'quickLink') > 0.3, 'shows with the star');
      const star = await page.locator('#favBtn').boundingBox();
      const btn = await page.locator('#quickLink').boundingBox();
      assert.ok(btn.x > star.x + star.width && Math.abs(btn.y - star.y) < 2, 'sits right next to the star');
      // Hovering it does not open the favourites list.
      await page.hover('#quickLink'); await page.waitForTimeout(400);
      assert.equal(await page.isVisible('#favPanel'), false, 'favourites stay closed');
      // Not set up yet: clicking opens settings at the right box.
      assert.equal(await page.getAttribute('#quickLink', 'href'), null);
      await page.click('#quickLink');
      await page.waitForSelector('#panel', { state: 'visible' });
      assert.equal(await page.evaluate(() => document.activeElement.id), 'quickUrl', 'address box is ready to type in');
      await page.fill('#quickUrl', 'not a url');
      await page.click('#quickForm button[type=submit]');
      assert.equal(await page.evaluate(() => document.getElementById('quickStatus').classList.contains('error')), true, 'bad address is rejected');
      await page.fill('#quickUrl', 'youtube.com');
      await page.click('#quickForm button[type=submit]');
      assert.equal(await page.getAttribute('#quickLink', 'href'), 'https://youtube.com/');
      assert.equal(await page.getAttribute('#quickLink', 'title'), 'Youtube');
      assert.equal(await page.locator('#quickLink img').count(), 1, 'shows the site icon');
      await closeSettings(page);
      await page.mouse.move(130, 60); await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(SHOTS, 'one-click-site.png'), clip: { x: 0, y: 0, width: 320, height: 120 } });
      await context.close();

      const again = await launch({ userDir });
      page = await openNewTab(again.context);
      assert.equal(await page.getAttribute('#quickLink', 'href'), 'https://youtube.com/', 'kept after restart');
      await openSettings(page);
      assert.equal(await page.inputValue('#quickUrl'), 'https://youtube.com/');
      await page.click('#quickClear');
      assert.equal(await page.getAttribute('#quickLink', 'href'), null, 'can be removed');
      await again.context.close();
      assert.deepEqual(external, []);
    } catch (e) { await context.close().catch(() => {}); throw e; }
  });
});
