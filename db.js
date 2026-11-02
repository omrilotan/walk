// IndexedDB storage: walks (sessions), per-second samples, settings.

let opening;

function open() {
	opening ??= new Promise((resolve, reject) => {
		const request = indexedDB.open("walk", 1);
		request.onupgradeneeded = () => {
			const db = request.result;
			db.createObjectStore("sessions", { keyPath: "id", autoIncrement: true }).createIndex("start", "start");
			db.createObjectStore("samples", { autoIncrement: true }).createIndex("session", "session");
			db.createObjectStore("settings", { keyPath: "key" });
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	return opening;
}

const done = (request) =>
	new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});

const completed = (tx) =>
	new Promise((resolve, reject) => {
		tx.oncomplete = resolve;
		tx.onerror = () => reject(tx.error);
	});

const store = async (name, mode = "readonly") => (await open()).transaction(name, mode).objectStore(name);

export const addSession = async (session) => done((await store("sessions", "readwrite")).add(session));

export const putSession = async (session) => done((await store("sessions", "readwrite")).put(session));

export const addSample = async (sample) => done((await store("samples", "readwrite")).add(sample));

const getSamples = async (session) => done((await store("samples")).index("session").getAll(session));

export async function deleteSession(id) {
	const tx = (await open()).transaction(["sessions", "samples"], "readwrite");
	tx.objectStore("sessions").delete(id);
	const samples = tx.objectStore("samples");
	for (const key of await done(samples.index("session").getAllKeys(id))) samples.delete(key);
	return completed(tx);
}

/** Most recent first. */
export async function getSessions(limit = Infinity) {
	const request = (await store("sessions")).index("start").openCursor(null, "prev");
	const result = [];
	return new Promise((resolve, reject) => {
		request.onsuccess = () => {
			const cursor = request.result;
			if (!cursor || result.length >= limit) return resolve(result);
			result.push(cursor.value);
			cursor.continue();
		};
		request.onerror = () => reject(request.error);
	});
}

export async function getSetting(key, fallback) {
	const row = await done((await store("settings")).get(key));
	return row ? row.value : fallback;
}

export const setSetting = async (key, value) => done((await store("settings", "readwrite")).put({ key, value }));

// ---------------------------------------------------------------- export / import

/** Full backup. Walks carry a stable uid; old walks get one on first export. */
export async function exportAll() {
	const sessions = await getSessions();
	for (const session of sessions) {
		if (!session.uid) {
			session.uid = crypto.randomUUID();
			await putSession(session);
		}
		session.samples = (await getSamples(session.id)).map(({ session: _, ...sample }) => sample);
		delete session.id; // local key, meaningless elsewhere
	}
	return { format: "walk/1", exported: new Date().toISOString(), sessions };
}

/**
 * Merge a backup into this database. Walks match by uid, or by start time for
 * walks without one; on a match the more recently updated copy wins.
 */
export async function importAll(data) {
	if (!Array.isArray(data?.sessions)) throw new Error("Not a Walk export file");
	const local = await getSessions();
	const byUid = new Map(local.filter((s) => s.uid).map((s) => [s.uid, s]));
	const byStart = new Map(local.map((s) => [s.start, s]));
	const result = { added: 0, updated: 0, skipped: 0 };

	for (const { samples = [], id: _, ...session } of data.sessions) {
		if (typeof session.start !== "number" || !session.totals) {
			result.skipped++;
			continue;
		}
		session.uid ??= crypto.randomUUID();
		const existing = byUid.get(session.uid) ?? byStart.get(session.start);
		if (existing && (existing.updated ?? 0) >= (session.updated ?? 0)) {
			result.skipped++;
			continue;
		}
		if (existing) await deleteSession(existing.id);
		result[existing ? "updated" : "added"]++;

		const id = await addSession(session);
		const tx = (await open()).transaction("samples", "readwrite");
		for (const sample of samples) tx.objectStore("samples").add({ ...sample, session: id });
		await completed(tx);
	}
	return result;
}
