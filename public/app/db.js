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

// Every local change marks the walk for the next sync. Walks always get a uid.
const touched = (session) => {
	session.uid ??= crypto.randomUUID();
	session.dirty = 1;
	return session;
};

export const addSession = async (session) => done((await store("sessions", "readwrite")).add(touched(session)));

export const putSession = async (session) => done((await store("sessions", "readwrite")).put(touched(session)));

/** Writes a walk as it came from sync, without marking it for the next one. */
export const putSynced = async (session) => done((await store("sessions", "readwrite")).put(session));

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

/** Deletes every walk and its per-second readings. Settings stay. */
export async function deleteAllWalks() {
	const tx = (await open()).transaction(["sessions", "samples"], "readwrite");
	tx.objectStore("sessions").clear();
	tx.objectStore("samples").clear();
	return completed(tx);
}

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
		delete session.dirty;
	}
	return { format: "walk/1", exported: new Date().toISOString(), sessions };
}

/**
 * What importing a backup would do, without doing it: which of the file's walks
 * are new here (`add`), newer in the file (`update`, with the copy they
 * replace), or already here as the same or a newer copy (`keep`). A walk
 * matches by uid, or by start time. `invalid` counts entries that aren't walks.
 */
export function planImport(data, local) {
	if (!Array.isArray(data?.sessions)) throw new Error("Not a Walk export file");
	const byUid = new Map(local.filter((s) => s.uid).map((s) => [s.uid, s]));
	const byStart = new Map(local.map((s) => [s.start, s]));

	// The file's walks by uid; a walk the file repeats counts once, newest copy.
	const incoming = new Map();
	let invalid = 0;
	for (const entry of data.sessions) {
		const { samples, id: _, dirty: __, ...session } = entry ?? {};
		if (typeof session.start !== "number" || !session.totals) {
			invalid++;
			continue;
		}
		session.uid ??= crypto.randomUUID();
		const seen = incoming.get(session.uid);
		if (!seen || (session.updated ?? 0) > (seen.session.updated ?? 0)) {
			incoming.set(session.uid, { session, samples: Array.isArray(samples) ? samples : [] });
		}
	}

	const plan = { add: [], update: [], keep: [], invalid };
	for (const walk of incoming.values()) {
		const existing = byUid.get(walk.session.uid) ?? byStart.get(walk.session.start);
		if (!existing) plan.add.push(walk);
		else if ((existing.updated ?? 0) >= (walk.session.updated ?? 0)) plan.keep.push(walk);
		else plan.update.push({ ...walk, existing });
	}
	return plan;
}

/**
 * Merges a backup into this database: adds the walks that aren't here and
 * replaces older copies with the file's newer ones. It never deletes a walk.
 *
 * `fresh` gives every walk a new uid. Use it after a reset in a signed-in
 * browser: the account keeps the old uids as deletions, and would delete the
 * imported walks again on the next sync.
 */
export async function importAll(data, { fresh = false } = {}) {
	const plan = planImport(data, await getSessions());
	for (const { session, existing } of plan.update) {
		// The copy here keeps its uid, so the account updates that walk too.
		if (existing.uid) session.uid = existing.uid;
		await deleteSession(existing.id);
	}
	for (const { session, samples } of [...plan.add, ...plan.update]) {
		if (fresh) session.uid = crypto.randomUUID();
		const id = await addSession(session);
		const tx = (await open()).transaction("samples", "readwrite");
		for (const sample of samples) tx.objectStore("samples").add({ ...sample, session: id });
		await completed(tx);
	}
	return { added: plan.add.length, updated: plan.update.length, skipped: plan.keep.length + plan.invalid };
}
