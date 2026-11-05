# Changelog

Walk is a web app, so changes are listed by date, not version.

## 2026-11-05

- Walk timer: set any number of minutes, or km, for this walk. When it's done, Walk chimes, or pauses the belt and chimes; you choose. The Time or Distance tile fills up as you go, and the timer shows what's left. It counts the walk's own totals, so pauses don't count. An AI agent in the browser can set it too.

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
