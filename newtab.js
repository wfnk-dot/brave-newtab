// Brave-style new tab with an animated background.
// Plain by default: only the background is visible. Everything else is opt-in.
(function () {
  'use strict';

  const DEFAULT_ID = 'default';
  const DEFAULT_BG = { src: 'bg/default.webm', poster: 'bg/default.jpg', kind: 'video' };
  const WIDE_RATIO = 2.2;          // wider than this counts as an "ultrawide" window
  const MAX_TOP_SITES = 6;
  const POSTER_MAX = 1920;         // still-image size cap (pixels on the long side)

  const DEFAULTS = {
    activeId: DEFAULT_ID,
    wideId: null,
    focusX: 50,
    focusY: 50,
    dim: 0,
    paused: false,
    clock: false,
    clock24: false,
    topSites: false,
    hiddenSites: [],
    favorites: [],     // [{ name, url }]
    favPurple: true,   // tint the favourite icons purple
  };

  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const video = $('bgVideo');
  const image = $('bgImage');

  let settings = { ...DEFAULTS };
  let library = [];                // [{ id, name, kind, poster, added }]
  let current = { id: null, kind: null };
  let objectUrl = null;
  let loadToken = 0;
  let clockTimer = null;
  const ownWrites = new Set();

  const isVisible = () => document.visibilityState === 'visible';

  // ---------------------------------------------------------------- settings

  async function loadSettings() {
    const res = await chrome.storage.local.get('settings');
    settings = { ...DEFAULTS, ...(res.settings || {}) };
  }

  let saveTimer = null;
  function save(immediate) {
    updateBootCache();
    clearTimeout(saveTimer);
    const write = () => {
      const json = JSON.stringify(settings);
      ownWrites.add(json);
      chrome.storage.local.set({ settings: JSON.parse(json) });
    };
    if (immediate) write(); else saveTimer = setTimeout(write, 250);
  }

  function posterFor(id) {
    if (!id || id === DEFAULT_ID) return DEFAULT_BG.poster;
    const item = library.find((x) => x.id === id);
    return (item && item.poster) || '';
  }

  // A small synchronous copy for boot.js so the next new tab paints instantly.
  function updateBootCache() {
    try {
      localStorage.setItem('boot', JSON.stringify({
        poster: posterFor(validId(settings.activeId)),
        widePoster: validWideId() ? posterFor(settings.wideId) : null,
        focusX: settings.focusX,
        focusY: settings.focusY,
        dim: settings.dim,
      }));
    } catch (e) { /* storage full: not important, only affects the first paint */ }
  }

  function applyLook() {
    root.style.setProperty('--fx', settings.focusX + '%');
    root.style.setProperty('--fy', settings.focusY + '%');
    root.style.setProperty('--dim', String(settings.dim / 100));
    document.body.classList.toggle('fav-purple', !!settings.favPurple);
  }

  // ---------------------------------------------------------------- background

  function validId(id) {
    return id === DEFAULT_ID || library.some((x) => x.id === id) ? id : DEFAULT_ID;
  }
  function validWideId() {
    const id = settings.wideId;
    return id && (id === DEFAULT_ID || library.some((x) => x.id === id)) ? id : null;
  }
  function isWideWindow() {
    return window.innerWidth / Math.max(1, window.innerHeight) > WIDE_RATIO;
  }
  function chooseId() {
    const wide = validWideId();
    return wide && isWideWindow() ? wide : validId(settings.activeId);
  }

  function setPoster(url) {
    root.style.setProperty('--poster', url ? 'url("' + url + '")' : 'none');
  }

  function clearMedia() {
    video.pause();
    video.classList.remove('ready');
    video.hidden = true;
    if (video.hasAttribute('src')) {
      video.removeAttribute('src');
      video.load();                 // frees the decoder
    }
    image.classList.remove('ready');
    image.hidden = true;
    image.removeAttribute('src');
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  }

  async function showBackground(id) {
    const token = ++loadToken;
    let src, kind, poster, blobUrl = null;

    if (id === DEFAULT_ID) {
      ({ src, kind, poster } = DEFAULT_BG);
    } else {
      let rec = null;
      try { rec = await BgDB.get(id); } catch (e) { rec = null; }
      if (token !== loadToken) return;
      if (!rec) return showBackground(DEFAULT_ID);
      blobUrl = URL.createObjectURL(rec.blob);
      src = blobUrl;
      kind = rec.kind;
      poster = rec.poster;
    }

    clearMedia();
    objectUrl = blobUrl;
    current = { id, kind };
    setPoster(poster);

    if (kind === 'video') {
      video.hidden = false;
      video.src = src;
    } else {
      image.hidden = settings.paused;
      image.src = src;
    }
    syncPlayback();
  }

  video.addEventListener('loadeddata', () => video.classList.add('ready'));
  video.addEventListener('error', () => video.classList.remove('ready')); // the still image stays
  image.addEventListener('load', () => image.classList.add('ready'));
  image.addEventListener('error', () => image.classList.remove('ready'));

  // Only play while this tab is on screen and not paused by the user.
  function syncPlayback() {
    if (current.kind === 'video') {
      if (isVisible() && !settings.paused) {
        const p = video.play();
        if (p) p.catch(() => {});
      } else {
        video.pause();
      }
    } else if (current.kind === 'image') {
      // A GIF can't be paused, so "paused" shows its still frame instead.
      image.hidden = settings.paused;
    }
  }

  // Load or switch the background, but never do it while the tab is hidden.
  function refreshBackground() {
    if (!isVisible()) return;
    const id = chooseId();
    if (id !== current.id) showBackground(id);
    else syncPlayback();
  }

  document.addEventListener('visibilitychange', () => {
    if (isVisible()) {
      refreshBackground();
      renderClock();
    } else {
      video.pause();
      clearTimeout(clockTimer);
    }
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(refreshBackground, 200);
  });

  // ---------------------------------------------------------------- clock

  const pad = (n) => String(n).padStart(2, '0');

  function renderClock() {
    clearTimeout(clockTimer);
    const el = $('clock');
    if (!settings.clock) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    const d = new Date();
    const h = d.getHours();
    el.textContent = settings.clock24
      ? pad(h) + ':' + pad(d.getMinutes())
      : ((h % 12) || 12) + ':' + pad(d.getMinutes());
    if (isVisible()) {
      const msToNextMinute = 60000 - d.getSeconds() * 1000 - d.getMilliseconds() + 50;
      clockTimer = setTimeout(renderClock, msToNextMinute);
    }
  }

  // ---------------------------------------------------------------- top sites

  function faviconUrl(pageUrl) {
    // Served from Brave's own local favicon cache — no network request.
    return chrome.runtime.getURL('/_favicon/') + '?pageUrl=' + encodeURIComponent(pageUrl) + '&size=64';
  }

  function siteName(site) {
    try {
      const host = new URL(site.url).hostname.replace(/^www\./, '');
      return site.title && site.title.length <= 24 ? site.title : host;
    } catch (e) { return site.title || site.url; }
  }

  async function renderTopSites() {
    const nav = $('topSites');
    $('restoreSites').hidden = !(settings.topSites && settings.hiddenSites.length);
    if (!settings.topSites) { nav.hidden = true; nav.textContent = ''; return; }
    let sites = [];
    try { sites = await chrome.topSites.get(); } catch (e) { sites = []; }
    const hidden = new Set(settings.hiddenSites);
    sites = sites.filter((s) => /^https?:/i.test(s.url) && !hidden.has(s.url)).slice(0, MAX_TOP_SITES);

    nav.textContent = '';
    for (const site of sites) {
      const a = document.createElement('a');
      a.className = 'tile';
      a.href = site.url;
      a.title = site.title || site.url;

      const icon = document.createElement('span');
      icon.className = 'tile-icon';
      const img = document.createElement('img');
      img.alt = '';
      img.src = faviconUrl(site.url);
      icon.appendChild(img);

      const name = document.createElement('span');
      name.className = 'tile-name';
      name.textContent = siteName(site);

      const remove = document.createElement('button');
      remove.className = 'tile-remove';
      remove.type = 'button';
      remove.title = 'Remove this site';
      remove.setAttribute('aria-label', 'Remove ' + siteName(site));
      remove.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7a1 1 0 1 0-1.4 1.4l4.9 4.9-4.9 4.9a1 1 0 1 0 1.4 1.4l4.9-4.9 4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4z"/></svg>';
      remove.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!settings.hiddenSites.includes(site.url)) settings.hiddenSites = [...settings.hiddenSites, site.url];
        save(true);
        renderTopSites();
      });

      a.append(icon, name, remove);
      nav.appendChild(a);
    }
    nav.hidden = sites.length === 0;
  }

  function renderWidgets() {
    renderClock();
    renderTopSites();
  }

  // ---------------------------------------------------------------- settings panel

  const panel = $('panel');
  const scrim = $('scrim');

  function openPanel() {
    syncControls();
    renderLibrary();
    panel.hidden = false;
    scrim.hidden = false;
  }
  function closePanel() {
    panel.hidden = true;
    scrim.hidden = true;
  }
  $('gear').addEventListener('click', openPanel);
  $('closePanel').addEventListener('click', closePanel);
  scrim.addEventListener('click', closePanel);

  function syncControls() {
    $('focusX').value = settings.focusX;
    $('focusY').value = settings.focusY;
    $('dim').value = settings.dim;
    $('focusXOut').textContent = settings.focusX + '%';
    $('focusYOut').textContent = settings.focusY + '%';
    $('dimOut').textContent = settings.dim + '%';
    $('paused').checked = settings.paused;
    $('clockOn').checked = settings.clock;
    $('clock24').checked = settings.clock24;
    $('clock24Row').hidden = !settings.clock;
    $('topSitesOn').checked = settings.topSites;
    $('favPurple').checked = settings.favPurple;
    $('restoreSites').hidden = !(settings.topSites && settings.hiddenSites.length);
    renderWideSelect();
  }

  function bindSlider(id, key) {
    $(id).addEventListener('input', (e) => {
      settings[key] = Number(e.target.value);
      $(id + 'Out').textContent = settings[key] + '%';
      applyLook();
      save();
    });
  }
  bindSlider('focusX', 'focusX');
  bindSlider('focusY', 'focusY');
  bindSlider('dim', 'dim');

  $('focusReset').addEventListener('click', () => {
    settings.focusX = 50;
    settings.focusY = 50;
    applyLook();
    syncControls();
    save(true);
  });

  $('paused').addEventListener('change', (e) => {
    settings.paused = e.target.checked;
    save(true);
    syncPlayback();
  });
  $('clockOn').addEventListener('change', (e) => {
    settings.clock = e.target.checked;
    $('clock24Row').hidden = !settings.clock;
    save(true);
    renderClock();
  });
  $('clock24').addEventListener('change', (e) => {
    settings.clock24 = e.target.checked;
    save(true);
    renderClock();
  });
  $('favPurple').addEventListener('change', (e) => {
    settings.favPurple = e.target.checked;
    save(true);
    applyLook();
  });
  $('topSitesOn').addEventListener('change', (e) => {
    settings.topSites = e.target.checked;
    save(true);
    renderTopSites();
  });
  $('restoreSites').addEventListener('click', () => {
    settings.hiddenSites = [];
    save(true);
    renderTopSites();
  });

  function allBackgrounds() {
    return [{ id: DEFAULT_ID, name: 'Built-in', poster: DEFAULT_BG.poster }, ...library];
  }

  function renderWideSelect() {
    const sel = $('wideSelect');
    sel.textContent = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'Same as the normal background';
    sel.appendChild(none);
    for (const item of allBackgrounds()) {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item.name;
      sel.appendChild(opt);
    }
    sel.value = validWideId() || '';
  }

  $('wideSelect').addEventListener('change', (e) => {
    settings.wideId = e.target.value || null;
    save(true);
    renderLibrary();
    refreshBackground();
  });

  function renderLibrary() {
    const box = $('library');
    box.textContent = '';
    const activeId = validId(settings.activeId);
    const wideId = validWideId();
    for (const item of allBackgrounds()) {
      const el = document.createElement('div');
      el.className = 'lib-item' + (item.id === activeId ? ' active' : '');
      el.title = item.name;
      el.dataset.id = item.id;
      if (item.poster) el.style.backgroundImage = 'url("' + item.poster + '")';

      const name = document.createElement('span');
      name.className = 'lib-name';
      name.textContent = item.name;
      el.appendChild(name);

      if (item.id === wideId) {
        const badge = document.createElement('span');
        badge.className = 'lib-badge';
        badge.textContent = 'WIDE';
        badge.title = 'Used for very wide windows';
        el.appendChild(badge);
      }

      if (item.id !== DEFAULT_ID) {
        const del = document.createElement('button');
        del.className = 'lib-delete';
        del.type = 'button';
        del.title = 'Remove from library';
        del.setAttribute('aria-label', 'Remove ' + item.name);
        del.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7a1 1 0 1 0-1.4 1.4l4.9 4.9-4.9 4.9a1 1 0 1 0 1.4 1.4l4.9-4.9 4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4z"/></svg>';
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          removeBackground(item);
        });
        el.appendChild(del);
      }

      el.addEventListener('click', () => {
        settings.activeId = item.id;
        save(true);
        renderLibrary();
        refreshBackground();
      });
      box.appendChild(el);
    }
  }

  async function removeBackground(item) {
    if (!window.confirm('Remove "' + item.name + '" from your backgrounds?')) return;
    await BgDB.remove(item.id);
    library = await BgDB.list();
    if (settings.activeId === item.id) settings.activeId = DEFAULT_ID;
    if (settings.wideId === item.id) settings.wideId = null;
    save(true);
    renderLibrary();
    renderWideSelect();
    refreshBackground();
  }

  // ---------------------------------------------------------------- favourites

  const favPanel = $('favPanel');
  const favScrim = $('favScrim');
  let favEditing = false;

  function normalizeUrl(raw) {
    let u = String(raw || '').trim();
    if (!u) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
    try {
      const p = new URL(u);
      return /^(https?|file|ftp):$/.test(p.protocol) ? p.href : null;
    } catch (e) { return null; }
  }

  function hostName(url) {
    try {
      const h = new URL(url).hostname.replace(/^www\./, '');
      const base = h.split('.').slice(-2, -1)[0] || h;
      return base.charAt(0).toUpperCase() + base.slice(1);
    } catch (e) { return url; }
  }

  const svgX = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7a1 1 0 1 0-1.4 1.4l4.9 4.9-4.9 4.9a1 1 0 1 0 1.4 1.4l4.9-4.9 4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4z"/></svg>';
  const svgUp = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 8l6 6-1.4 1.4L12 10.8l-4.6 4.6L6 14z"/></svg>';
  const svgDown = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 16l-6-6 1.4-1.4 4.6 4.6 4.6-4.6L18 10z"/></svg>';

  function iconButton(svg, title, onClick, disabled) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-btn';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = svg;
    b.disabled = !!disabled;
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
    return b;
  }

  function moveFav(i, d) {
    const list = [...settings.favorites];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    settings.favorites = list;
    save(true);
    renderFavs();
  }

  function renderFavs() {
    const box = $('favList');
    box.textContent = '';
    const list = settings.favorites || [];
    list.forEach((f, i) => {
      const row = document.createElement(favEditing ? 'div' : 'a');
      row.className = 'fav-row';
      if (!favEditing) { row.href = f.url; row.title = f.url; }
      const img = document.createElement('img');
      img.alt = '';
      img.src = faviconUrl(f.url);
      img.addEventListener('load', () => purpleGlyph(img), { once: true });
      const name = document.createElement('span');
      name.className = 'fav-name';
      name.textContent = f.name;
      row.append(img, name);
      if (favEditing) {
        row.append(
          iconButton(svgUp, 'Move up', () => moveFav(i, -1), i === 0),
          iconButton(svgDown, 'Move down', () => moveFav(i, 1), i === list.length - 1),
          iconButton(svgX, 'Remove ' + f.name, () => {
            settings.favorites = list.filter((_, k) => k !== i);
            save(true);
            renderFavs();
          }));
      }
      box.appendChild(row);
    });
    $('favEmpty').hidden = list.length > 0 || favEditing;
    $('favForm').hidden = !favEditing;
    $('favEdit').textContent = favEditing ? 'Done' : 'Edit';
    favPanel.classList.toggle('editing', favEditing);
  }

  // A mostly-black logo (like X) can't be tinted, so draw its light shape in purple.
  function purpleGlyph(img) {
    if (!settings.favPurple || img.dataset.glyph) return;
    try {
      const n = 32, c = document.createElement('canvas');
      c.width = c.height = n;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, n, n);
      const d = g.getImageData(0, 0, n, n), p = d.data;
      let solid = 0, dark = 0;
      for (let i = 0; i < p.length; i += 4) {
        if (p[i + 3] > 128) { solid++; if (0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2] < 60) dark++; }
      }
      if (!solid || dark / solid < 0.6) return;
      for (let i = 0; i < p.length; i += 4) {
        const l = (0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2]) / 255;
        p[i] = 214; p[i + 1] = 170; p[i + 2] = 255;
        p[i + 3] = Math.round(p[i + 3] * Math.min(1, l * 1.3));
      }
      g.putImageData(d, 0, 0);
      img.dataset.glyph = '1';
      img.classList.add('glyph');
      img.src = c.toDataURL();
    } catch (e) { /* leave the icon as it is */ }
  }

  function openFavs() {
    favEditing = false;
    renderFavs();
    favPanel.classList.remove('closing', 'opening');
    favPanel.hidden = false;
    void favPanel.offsetWidth;            // restart the animation
    favPanel.classList.add('opening');
    favScrim.hidden = false;
    $('favBtn').classList.add('open');
  }
  function closeFavs() {
    if (favPanel.hidden || favPanel.classList.contains('closing')) return;
    favScrim.hidden = true;
    $('favBtn').classList.remove('open');
    favPanel.classList.remove('opening');
    favPanel.classList.add('closing');
    const done = () => { favPanel.classList.remove('closing'); favPanel.hidden = true; };
    favPanel.addEventListener('animationend', done, { once: true });
    setTimeout(() => { if (favPanel.classList.contains('closing')) done(); }, 400);
  }
  $('favBtn').addEventListener('click', () => (favPanel.hidden || favPanel.classList.contains('closing') ? openFavs() : closeFavs()));
  favScrim.addEventListener('click', closeFavs);
  $('favEdit').addEventListener('click', () => { favEditing = !favEditing; renderFavs(); });
  $('favForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = normalizeUrl($('favUrl').value);
    if (!url) { $('favUrl').focus(); return; }
    const name = $('favName').value.trim() || hostName(url);
    settings.favorites = [...(settings.favorites || []), { name, url }];
    save(true);
    $('favName').value = '';
    $('favUrl').value = '';
    renderFavs();
  });

  // ---------------------------------------------------------------- upload

  function setStatus(text, isError) {
    const el = $('uploadStatus');
    el.hidden = !text;
    el.textContent = text || '';
    el.classList.toggle('error', !!isError);
  }

  function drawPoster(source, w, h) {
    const scale = Math.min(1, POSTER_MAX / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  }

  // One-time still frame for the instant fallback image (not per frame).
  function videoPoster(url) {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      const done = (fn, arg) => {
        clearTimeout(timer);
        v.removeAttribute('src');
        v.load();
        fn(arg);
      };
      const timer = setTimeout(() => done(reject, new Error("couldn't read this video (it took too long).")), 30000);
      v.addEventListener('error', () => done(reject, new Error("Brave can't play this video. Try MP4 (H.264) or WebM.")), { once: true });
      v.addEventListener('loadeddata', () => { v.currentTime = 0.01; }, { once: true });
      v.addEventListener('seeked', () => {
        try {
          const poster = drawPoster(v, v.videoWidth, v.videoHeight);
          done(resolve, { poster, width: v.videoWidth, height: v.videoHeight });
        } catch (e) {
          done(resolve, { poster: '', width: v.videoWidth, height: v.videoHeight });
        }
      }, { once: true });
      v.src = url;
    });
  }

  function imagePoster(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          resolve({ poster: drawPoster(img, img.naturalWidth, img.naturalHeight), width: img.naturalWidth, height: img.naturalHeight });
        } catch (e) {
          resolve({ poster: '', width: img.naturalWidth, height: img.naturalHeight });
        }
      };
      img.onerror = () => reject(new Error("Brave can't open this image."));
      img.src = url;
    });
  }

  async function prepare(file) {
    const isVideo = /^video\//.test(file.type) || /\.(mp4|m4v|webm|mov)$/i.test(file.name);
    const isImage = !isVideo && (/^image\//.test(file.type) || /\.(gif|webp|png|jpe?g)$/i.test(file.name));
    if (!isVideo && !isImage) throw new Error('this file type isn\'t supported. Use MP4, WebM, GIF or WebP.');
    const url = URL.createObjectURL(file);
    let meta;
    try {
      meta = isVideo ? await videoPoster(url) : await imagePoster(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    return {
      id: 'bg-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      name: file.name.replace(/\.[^.]+$/, ''),
      kind: isVideo ? 'video' : 'image',
      type: file.type,
      blob: file,
      poster: meta.poster,
      width: meta.width,
      height: meta.height,
      added: Date.now(),
    };
  }

  $('upload').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const label = $('uploadLabel');
    label.classList.add('busy');
    const errors = [];
    let lastId = null;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const mb = (f.size / 1048576).toFixed(f.size > 10485760 ? 0 : 1);
      setStatus('Saving ' + (files.length > 1 ? (i + 1) + ' of ' + files.length + ': ' : '') + f.name + ' (' + mb + ' MB)…');
      try {
        const rec = await prepare(f);
        await BgDB.put(rec);
        lastId = rec.id;
      } catch (err) {
        errors.push(f.name + ': ' + (err && err.message ? err.message : 'could not be saved.'));
      }
    }
    library = await BgDB.list();
    if (lastId) {
      settings.activeId = lastId;
      save(true);
    }
    label.classList.remove('busy');
    renderLibrary();
    renderWideSelect();
    refreshBackground();
    setStatus(errors.length ? errors.join(' ') : 'Saved. It\'s now your background.', errors.length > 0);
    document.body.dataset.uploaded = String(Date.now()); // marker used by the automated tests
  });

  // ---------------------------------------------------------------- sync between tabs

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    const json = JSON.stringify(changes.settings.newValue || {});
    if (ownWrites.delete(json)) return;   // our own save echoing back
    settings = { ...DEFAULTS, ...(changes.settings.newValue || {}) };
    library = await BgDB.list();
    applyLook();
    renderWidgets();
    if (!panel.hidden) { syncControls(); renderLibrary(); }
    if (!favPanel.hidden) renderFavs();
    refreshBackground();
  });

  // ---------------------------------------------------------------- start

  async function init() {
    await loadSettings();
    try { library = await BgDB.list(); } catch (e) { library = []; }
    applyLook();
    updateBootCache();
    renderWidgets();
    refreshBackground();               // does nothing until the tab is visible
    document.body.dataset.ready = '1'; // marker used by the automated tests
  }

  init();
})();
