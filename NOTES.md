# Build notes

## 1. Brave stats (trackers blocked / bandwidth saved / time saved): not possible, left out

What was checked:
- Brave has a `chrome.braveShields` API inside Brave's source code (brave-core). Brave only allows its own built-in components to use it. Ordinary extensions, including unpacked ones, can't call it, and there's no permission to request it.
- Brave's developer docs and the Brave community forum have no public way to read these numbers. A forum user asked this exact question while building a custom new tab extension and got no answer.
- The numbers are stored in Brave's profile `Preferences` file. Extensions can't read that file, and reading it from outside the browser would mean a separate helper app. That isn't worth it and would break between Brave versions.
- The screenshot with the stats card over a custom background: Brave's **own** new tab page supports custom background images (Settings → New Tab Page → Background image). It shows the stats card on top of them. That is almost certainly what the screenshot was. It only supports still images, not video.

Decision: no Stats option. The spec also lists Brave stats as out of scope. Nothing is faked.

## 2. Testing "pause when the tab is hidden": real tab switching didn't work in the test browser (stopped after 2 tries)

The page pauses the video on the browser's `visibilitychange` signal, and doesn't load the video at all if the tab opens in the background. To test this for real, the test browser must report a tab as hidden. Playwright's Chromium never did:

1. **Headless browser**: opened a second tab, brought it to the front, and minimized the window. The new tab page still said `visible`.
2. **Real (headed) browser on a virtual screen (Xvfb)**: removed Playwright's "keep background tabs awake" flags, turned off its focus emulation, and opened the second tab with `window.open` and with `newPage`. It still said `visible`. Playwright deliberately keeps every page "visible".

Per the hard rule, I stopped there. What the tests do instead: they simulate the browser's signal (`document.visibilityState` set to `hidden`/`visible`, plus the `visibilitychange` event) and check that the video really stops (its playback position doesn't move) and resumes. They also check that a tab opened in the background loads no video until it's shown. This tests the page's own logic fully, but not Brave's part (actually sending the signal). That part is standard browser behaviour.

Options if a real end-to-end check is wanted later:
- **Manual check in Brave (easiest, 1 minute):** open a new tab, then `brave://media-internals`. Switch back and forth between the new tab and another tab, and watch the player's state change between playing and paused.
- Drive a real, non-Playwright Brave/Chrome through Chrome DevTools and switch tabs with `Target.activateTarget` on a desktop with a window manager.
- Use Puppeteer instead of Playwright. It doesn't force pages to stay visible.

## 3. Video formats

- The test browser (open-source Chromium) can't play MP4/H.264, so the automated tests use WebM. **Brave can play MP4/H.264**, so MP4 works there.
- HEVC (`.mov` from iPhones) depends on the computer's hardware. If a file can't be played, the upload shows a plain message instead of saving a broken background.

## 4. Other decisions

- **Built-in background.** The extension ships with a small (190 KB), seamless 12-second colour loop (`bg/default.webm`). A fresh install is still "just the animated background", with nothing else visible.
- **Instant still image.** At upload, one still frame is captured (a one-time canvas draw, not per frame). `boot.js` paints it before anything else on every new tab, so there's no flash while the video loads.
- **Top sites.** Shows up to 6 sites, http/https only. Chromium also lists the new tab page itself as a "top site", and that's filtered out. Favicons come from Brave's local favicon cache (`_favicon`), not the internet.
- **Mouse only.** There are no keyboard shortcuts.
