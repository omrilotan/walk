// Optional sync with a Walk account. The browser keeps the main copy; the
// server holds walk totals so other browsers and assistants can read them.
// Per-second readings never leave the browser.

import { deleteAllWalks, deleteSession, getSessions, getSetting, putSynced, setSetting } from "./db.js";

const BATCH = 200;

let account = null; // { email, mcp } when signed in
let running = null;

/** Who is signed in, or null. Never throws: offline means "not now". */
export async function checkAccount() {
	try {
		const response = await fetch("/api/me", { headers: { accept: "application/json" } });
		// A server error is not a sign-out: keep what we knew.
		if (response.ok || response.status === 401) account = response.ok ? await response.json() : null;
		remember(account);
	} catch {
		// Offline: still signed in as far as we know. Sync waits for the network.
		account = recalled();
	}
	return account;
}

function remember(value) {
	try {
		if (value) localStorage.setItem("walk:account", JSON.stringify(value));
		else localStorage.removeItem("walk:account");
	} catch {}
}

function recalled() {
	try {
		return JSON.parse(localStorage.getItem("walk:account") ?? "null");
	} catch {
		return null;
	}
}

export const signedIn = () => Boolean(account);

/** The signed-in account ({ email, mcp }), or null. */
export const currentAccount = () => account;

/** Deleting a walk here deletes it on the server and in the user's other browsers too. */
export async function recordDeletion(session) {
	if (!session.uid) return;
	const deleted = await getSetting("sync:deleted", []);
	deleted.push({ uid: session.uid, at: Date.now() });
	await setSetting("sync:deleted", deleted);
}

/**
 * Deletes every walk: in the account first, so a failure there leaves this
 * browser untouched (it would only pull the walks back), then here. The user's
 * other signed-in browsers delete theirs on their next sync.
 */
export async function resetAll() {
	await running;
	if (account) {
		const response = await fetch("/api/walks", { method: "DELETE" });
		if (response.status === 401) account = null;
		else if (!response.ok) throw new Error(`Couldn't reset your account's walks (${response.status}). Nothing was deleted.`);
	}
	await deleteAllWalks();
	await setSetting("sync:deleted", []);
}

const toServer = (s) => ({
	uid: s.uid,
	start: s.start,
	end: s.end ?? null,
	updated: s.updated ?? s.start,
	maxSpeed: s.maxSpeed ?? 0,
	totals: s.totals,
});

/**
 * Push local changes, pull everybody else's. Returns what changed locally,
 * so the page can redraw: { walks, goal }.
 * One at a time: a second call while one runs waits for that one.
 */
export function sync() {
	running ??= run().finally(() => (running = null));
	return running;
}

async function run() {
	if (!account) return { walks: 0, goal: null };

	// A different account than last time: start over, and offer it everything.
	if ((await getSetting("sync:account", null)) !== account.email) {
		await setSetting("sync:cursor", 0);
		await setSetting("sync:deleted", []);
		for (const session of await getSessions()) await putSynced({ ...session, dirty: 1 });
		await setSetting("sync:account", account.email);
	}

	const local = await getSessions();
	const dirty = local.filter((s) => s.dirty && s.uid && s.totals);
	const deleted = await getSetting("sync:deleted", []);
	const goalKm = await getSetting("goal", 5);
	const goalUpdated = await getSetting("goalUpdated", 0);
	const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

	let cursor = await getSetting("sync:cursor", 0);
	let changed = 0;
	let goal = null;
	let more = true;
	let first = true;

	while (more || first) {
		const walks = dirty.splice(0, BATCH);
		const gone = first ? deleted : [];
		const response = await fetch("/api/sync", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				cursor,
				walks: walks.map(toServer),
				deleted: gone,
				settings: first ? { goalKm, goalUpdated, timeZone } : {},
			}),
		});
		if (response.status === 401) {
			account = null;
			return { walks: changed, goal };
		}
		if (!response.ok) throw new Error(`Sync failed (${response.status})`);
		const data = await response.json();

		// Pushed: clear the mark, unless the walk changed again meanwhile.
		const now = new Map((await getSessions()).map((s) => [s.uid, s]));
		for (const pushed of walks) {
			const current = now.get(pushed.uid);
			if (current && current.updated === pushed.updated) await putSynced({ ...current, dirty: 0 });
		}
		if (first && gone.length) {
			const left = (await getSetting("sync:deleted", [])).filter((d) => !gone.some((g) => g.uid === d.uid));
			await setSetting("sync:deleted", left);
		}

		// Pulled: newer copies replace ours. Walks still in progress elsewhere
		// wait until they end, so the tracker never resumes another browser's walk.
		for (const remote of data.walks) {
			if (remote.end === null) continue;
			const mine = now.get(remote.uid);
			if (mine && (mine.updated ?? 0) >= remote.updated) continue;
			const { id, samples, ...rest } = mine ?? {};
			await putSynced({ ...(mine ? { id } : {}), ...rest, ...remote, dirty: 0 });
			changed++;
		}
		for (const uid of data.deleted) {
			const mine = now.get(uid);
			if (mine) {
				await deleteSession(mine.id);
				changed++;
			}
		}

		const server = data.settings;
		if (first && server.goalKm !== null && server.goalUpdated > goalUpdated) {
			goal = server.goalKm;
			await setSetting("goal", goal);
			await setSetting("goalUpdated", server.goalUpdated);
		}

		cursor = data.cursor;
		more = data.more || dirty.length > 0;
		first = false;
	}
	await setSetting("sync:cursor", cursor);
	await setSetting("sync:at", Date.now());
	return { walks: changed, goal };
}
