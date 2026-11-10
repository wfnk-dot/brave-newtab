# Brave New Tab — animated background

Replaces Brave's new tab page with one that looks like Brave's own, but with a **moving background** (a looping video or GIF).

- **Fills the window like Brave does.** The background is cropped to fit, never squished, and never gets black bars, on any screen shape: ultrawide, normal, or tall.
- **Plain.** Out of the box you see only the background. No clock, no shortcuts, no text. You can turn a clock and top sites on if you want them.
- **Light.** The video only plays while you're looking at the new tab. Switch to another tab and it pauses.
- **Private.** It never connects to the internet. Your videos are stored inside Brave on your computer.

It comes with a soft, slowly moving colour background so it works straight away. Add your own in Settings.

---

## Install (about 2 minutes)

1. **Download it.** On this page on GitHub, click the green **Code** button, then **Download ZIP**. Open the downloaded file so it unzips into a folder (on a Mac, double-click it).
   - Move the folder somewhere it can stay, such as your Documents folder. **Don't delete it later:** Brave loads the extension from this folder.
2. **Add it to Brave.**
   1. In Brave, type `brave://extensions` in the address bar and press Enter.
   2. Turn on **Developer mode** (the switch in the top-right corner).
   3. Click **Load unpacked** (top-left).
   4. Pick the folder you unzipped (the one that has `manifest.json` inside it) and click **Select**.
3. **Open a new tab.** You'll see the moving background.
   - If Brave asks whether you want to **keep** the change to your new tab page, click **Keep**.
4. **Add your own background.** Move your mouse to the **top-right corner** of the new tab. A faint **gear** appears. Click it, then click **Add background…** and pick your video.
5. **Turn vToad off.** Go back to `brave://extensions` and switch vToad off (or click **Remove**). Otherwise the two extensions fight over the new tab.

> **Tip:** the loops from your Screensaver project (`wfnk-dot/screensaver`) work directly as backgrounds. Just add them with **Add background…**.

---

## Using it

Everything is in the **gear**, which only appears when your mouse is in the top-right corner.

| Setting | What it does |
|---|---|
| **Background** | Your library. Click a picture to use it. Hover over one and click the small **×** to remove it. **Add background…** adds new ones; you can pick several at once. |
| **Very wide windows** | Optional. Choose a different background for ultrawide windows (wider than about 2.2 : 1), such as your ultrawide-edited loops. It switches automatically when you resize the window. |
| **Focus point** | Which part of the picture stays in view when the edges are cropped. Example: move *Top ↕ Bottom* to 40% to keep a bit more of the top. |
| **Darken** | Dims the background so the clock and sites are easier to read. |
| **Pause animation** | Stops the movement and shows a still picture. |
| **Show clock** | Brave-style clock in the top-left. You can switch it to 24-hour. |
| **Show top sites** | Your most-visited sites as Brave-style tiles. Hover over a tile and click **×** to remove a site. **Bring back removed sites** undoes this. |

Click outside the panel, or the **×** at its top, to close it. Settings save automatically.

### Favourites (your quick links)

Move your mouse to the **top-left corner**: a faint **star** appears (like the gear on the right). Click it for your favourite sites; click one to go there.

- **Add:** click the star → **Edit** → type a name (e.g. *YouTube*) and the address (e.g. *youtube.com*) → **Add**. Leave the name empty and it uses the site's name.
- **Reorder / remove:** in **Edit**, use the up/down arrows and the **×**. Click **Done** when finished.
- Click anywhere outside the list to close it. Nothing shows on the background until you open it.
- The list floats straight on the background (no panel), opens with a short smooth animation, and **Edit** only appears while your mouse is over it. Site icons are tinted purple (black logos like X turn into a purple shape); turn off **Purple favourite icons** in the gear's settings for normal colours.

Brave's own "show bookmarks bar only on the new tab page" can't appear on an extension's page, so this replaces it.

**Which files work?**
- **Best:** MP4 or WebM video. They're smooth and easy on your computer, and large files are fine.
- **Also fine:** GIF and animated WebP. They use more power than video, and a GIF can't really pause, so "Pause animation" shows a still picture of it.
- Some iPhone/Mac `.mov` (HEVC) videos won't play. If a video doesn't work, you'll see a message. Convert it to MP4 (H.264) and try again.

---

## Known limit: Brave's stats panel can't be shown

Brave's stats card (trackers blocked, bandwidth saved, time saved) **can't be shown** on this page. Brave keeps those numbers to itself and doesn't let extensions read them. **Any** extension that replaces the new tab page loses them, including vToad.

If you've seen the stats card over a custom picture, that was most likely **Brave's own new tab page** with a custom background image. Brave allows still images there, but not videos. So the choice is:
- the moving background (this extension) **without** stats, or
- Brave's own page **with** stats but a still picture.

This extension doesn't fake the numbers. The page stays plain instead. (Details of what was checked are in [`NOTES.md`](NOTES.md).)

---

## Updating or removing

- **Update:** download the new ZIP and replace the old folder's contents. Then on `brave://extensions`, click the circular **reload** arrow on this extension. Your backgrounds and settings are kept.
- **Remove:** on `brave://extensions`, click **Remove** on this extension. This also deletes the backgrounds you added.
- When Brave starts, it may show a notice about developer-mode extensions. That's normal for extensions installed this way. Just close it.

---

## For developers

- Manifest V3, `chrome_url_overrides.newtab`. Permissions: `topSites`, `favicon`, `storage`, `unlimitedStorage`. A strict content-security policy blocks all network connections (`connect-src 'none'`).
- Files: `newtab.html/.css/.js` (page), `boot.js` (sets the cached still image before first paint), `db.js` (IndexedDB library for uploads), `bg/` (built-in loop).
- Uploads are stored in IndexedDB as blobs. A still frame is captured **once** at upload time for the instant fallback image. Playback uses a plain `<video>` element (hardware decode), `object-fit: cover` with `object-position` for the focus point.
- Tests: `npm test` (needs Node 20+, ffmpeg, and Playwright's Chromium). They load the extension in Chromium and save screenshots to `test-shots/`.
