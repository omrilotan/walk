// Offline support for the installed app. Everything the app needs to open
// and run the pad is cached; Web Bluetooth itself needs no internet. Sign-in,
// sync and the MCP server are never cached: they need the network, and sync
// catches up when it's back.
//
// Walk's pages and files: network first, so online you always get the latest
// Walk, and the cached copy when offline. Everything is served from Walk's own
// address: no third-party requests.

const VERSION = "walk-2026-11-04b";

const PRECACHE = [
	"/app/",
	"/app/app.css",
	"/app/app.js",
	"/app/agent.js",
	"/app/auth.js",
	"/app/charts.js",
	"/app/db.js",
	"/app/format.js",
	"/app/pad.js",
	"/app/stats.js",
	"/app/sync.js",
	"/app/tracker.js",
	"/icon.svg",
	"/icon-192.png",
	"/theme.js",
	"/manifest.webmanifest",
	"/vendor/phosphor/regular.css",
	"/vendor/phosphor/Phosphor.woff2",
	"/vendor/phosphor/bold.css",
	"/vendor/phosphor/Phosphor-Bold.woff2",
	"/vendor/phosphor/fill.css",
	"/vendor/phosphor/Phosphor-Fill.woff2",
	"/vendor/geist/Geist-Variable.woff2",
];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(VERSION)
			.then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" }))))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET") return;
	const url = new URL(request.url);
	const local = url.origin === self.location.origin;

	if (!local || url.pathname.startsWith("/api/") || url.pathname.startsWith("/mcp")) return; // live only
	// Icons and the font never change at their address: cached copy first.
	event.respondWith(url.pathname.startsWith("/vendor/") ? cacheFirst(request, event) : networkFirst(request));
});

async function networkFirst(request) {
	const cache = await caches.open(VERSION);
	try {
		const response = await fetch(request);
		if (response.ok) cache.put(request, response.clone());
		return response;
	} catch {
		const cached = await cache.match(request, { ignoreSearch: true });
		if (cached) return cached;
		return request.mode === "navigate" ? ((await cache.match("/app/")) ?? Response.error()) : Response.error();
	}
}

async function cacheFirst(request, event) {
	const cache = await caches.open(VERSION);
	const cached = await cache.match(request, { ignoreVary: true });
	const refresh = fetch(request)
		.then((response) => {
			if (response.ok || response.type === "opaque") cache.put(request, response.clone());
			return response;
		})
		.catch(() => null);
	if (cached) {
		event.waitUntil(refresh);
		return cached;
	}
	return (await refresh) ?? Response.error();
}
