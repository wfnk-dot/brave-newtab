// Shared helpers for the Playwright tests (run with: npm test).
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const { chromium } = require('playwright');

const EXT_DIR = path.resolve(__dirname, '..');

// Chromium derives an unpacked extension's ID from its folder path.
function extensionId(dir) {
  const hash = crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32);
  return hash.replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
}
const EXT_ID = extensionId(EXT_DIR);
const NEWTAB_URL = `chrome-extension://${EXT_ID}/newtab.html`;

async function launch(opts = {}) {
  const userDir = opts.userDir || fs.mkdtempSync(path.join(os.tmpdir(), 'bnt-profile-'));
  const context = await chromium.launchPersistentContext(userDir, {
    headless: opts.headless !== false,
    channel: 'chromium',
    viewport: opts.viewport || { width: 1920, height: 1080 },
    // Let Chromium mark covered/background tabs as hidden, like a real browser does.
    ignoreDefaultArgs: ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      '--autoplay-policy=no-user-gesture-required',
      ...(opts.extraArgs || []),
    ],
  });
  return { context, userDir };
}

async function openNewTab(context, viewport) {
  const page = context.pages()[0] && context.pages()[0].url() === 'about:blank' ? context.pages()[0] : await context.newPage();
  if (viewport) await page.setViewportSize(viewport);
  await page.goto(NEWTAB_URL);
  await page.waitForSelector('body[data-ready="1"]');
  return page;
}

// Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced) so tests need no extra packages.
function decodePng(buf) {
  let pos = 8, width, height, colorType, idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + x] = v & 255;
    }
  }
  return { width, height, bpp, pixel: (x, y) => { const i = y * stride + x * bpp; return [out[i], out[i + 1], out[i + 2]]; } };
}

module.exports = { EXT_DIR, EXT_ID, NEWTAB_URL, launch, openNewTab, decodePng };
