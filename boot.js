// Runs synchronously in <head>, before the first paint.
// Reads a small cached copy of the look (still image, focus point, darkness)
// so the page never flashes while the real settings and video load.
(function () {
  var cache = null;
  try { cache = JSON.parse(localStorage.getItem('boot') || 'null'); } catch (e) { cache = null; }
  cache = cache || {};
  var root = document.documentElement;
  var wide = !!cache.widePoster && window.innerWidth / Math.max(1, window.innerHeight) > 2.2;
  var poster = wide ? cache.widePoster : cache.poster;
  if (poster === undefined || poster === null) poster = 'bg/default.jpg';
  root.style.setProperty('--poster', poster ? 'url("' + poster + '")' : 'none');
  root.style.setProperty('--fx', (cache.focusX != null ? cache.focusX : 50) + '%');
  root.style.setProperty('--fy', (cache.focusY != null ? cache.focusY : 50) + '%');
  root.style.setProperty('--dim', String((cache.dim || 0) / 100));
})();
