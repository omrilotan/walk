# Changelog

Walk is a web app, so changes are listed by date, not version.

## 2026-11-18

- Add a walk by hand, for one Walk missed: the day, the start, minutes and km. Steps and calories left empty are estimated from your own walks. The button is under Recent walks.
- Edit a walk: the pencil next to it corrects its start, time, distance, steps or calories. Show more, under the list, reaches older walks.
- A deleted walk now waits 30 days in Menu, Deleted walks, where you can restore it or delete it for good. This holds in every browser that had the walk.
- A walk added or changed by hand says so in the list. It counts in every total. Personal records count only walks as the pad recorded them.
- AI assistants can fix your history too, if you allow it: add a walk, correct one, delete one. Through remote MCP this is a new permission, shown on the approval screen; an assistant you connected earlier needs to be disconnected and connected again to get it. In the browser (WebMCP), Walk asks on screen before every deletion and says what the assistant did. Their changes are marked as an assistant's.
- A click on a window's edge no longer closes it; only a click outside it does.

## 2026-11-17

- About lists the keyboard shortcuts: Space to start or pause, ↑ and ↓ for speed, Esc to stop. The buttons say their key when you hover them.
- Fixed: pressing Esc to close a window (About, the menu, sync) also stopped the belt. Shortcuts now wait until no window is open.
- Fixed: an assistant in the browser could miss Walk's tools, because it looked for WebMCP under its older name. Walk now answers there too. An assistant that runs scripts in the page, such as Claude for Chrome, could find the tools but not read the list; `window.walkTools` now gives it the same tools as plain data, and the Connect your AI agent window says so.
- A small "Tip me" button in About, for anyone who wants to buy a coffee. It's a plain link to Ko-fi; nothing is loaded from Ko-fi.

## 2026-11-11

- Fixed: a new walk could start with the previous walk's distance and time already on it, when the pad still showed them as the belt started. Each walk now counts only itself.

## 2026-11-06

- Tap any day or week on the dashboard — a square in the activity grid, a week bar, or a day of this week — to open its full stats: distance, walks, time, steps and calories for that day or week.
- The walk timer now counts from the moment you set it, not from the start of the walk. Change it (or switch off and back on) and it starts again from now, so you can set a fresh target mid-walk.
- When a timer ends and Walk isn't the tab in front, you get a system notification. When it is in front, a banner slides in, so the chime always has a visible source.
- The daily goal is now a clear − / + control under the today ring, instead of a small tucked-away field.

## 2026-11-05

- Walk timer: set any number of minutes, or km, for this walk. When it's done, Walk chimes, or pauses the belt and chimes; you choose. The Time or Distance tile fills up as you go, and the timer shows what's left. It counts the walk's own totals, so pauses don't count. An AI agent in the browser can set it too.
- Import asks how: merge (recommended: adds new walks, updates older copies, deletes nothing) or replace all (deletes every walk here and in your account, then imports the file). Before you choose, it shows how many walks are new, newer in the file, or already here.
- New logo: WALK, with the A drawn as a person walking. It's in the app's header, the About window and the home page, with a new app icon and a sharper favicon for small sizes. Android gets a home-screen icon that fits its round crop.
- The home page's soft green glow now runs from the top of the window, with no visible edge.
- Fixed: importing a newer copy of a walk that matched by start time now updates that walk in your account, instead of adding a second one.

## 2026-11-04

- Moved to [walk.omrilotan.com](https://walk.omrilotan.com/), on Cloudflare Workers. The About page is the home page; the app is at `/app/`.
- Optional account: sign in with an emailed code to sync walks between browsers. Only walk totals leave the device.
- Connect an AI assistant from anywhere through remote MCP at `/mcp`, with simple steps in the app and on the home page.
- Works offline once installed: the app opens and runs the pad without internet, and syncs when back online.
- Everything happens on one page, so the pad never disconnects. Leaving asks first while it's connected.
- New menu for sync, import, export, reset, theme and About.
- One button for connecting and the pad's name; disconnecting takes two taps.
- Reset my data: deletes all walks, here and in your account.
- Privacy notice and terms. Sign-up asks for consent, the account stores only what sync needs, nothing is logged, and you can download your data. Fonts and icons are served by Walk itself. Security headers on every page.
- Fixed: Start goes to your target speed instead of 1 km/h.
- For AI agents: every public page in Markdown (ask with `Accept: text/markdown`, or add `index.md`), `llms.txt`, an MCP server card, an API catalog, and Content Signals in robots.txt.

## 2026-11-03

- About page.
- WebMCP: an AI assistant in your browser can read your walks and help run the pad, with you approving each start.

## 2026-11-02

- First version: control a PitPat walking pad from the browser and track every walk.
