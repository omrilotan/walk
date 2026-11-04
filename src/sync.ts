import { z } from "zod";
import type { Env, User } from "./env.ts";
import { ok, problem } from "./util.ts";

/**
 * Two-way sync of walk totals. The browser is the main copy; this is where
 * a user's devices meet, and what assistants read.
 *
 * Each walk is one row, keyed by the uid the browser gave it. The copy that
 * changed last on its own device wins (`updated`). Deletions are rows too,
 * so other devices learn about them. A device pulls every row that changed
 * here since its cursor, the server's own clock, so clocks on devices never
 * decide what is missed.
 */

const MAX_WALKS = 500;
const PAGE = 1000;

const Walk = z.object({
	uid: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
	start: z.number().int().min(0),
	end: z.number().int().min(0).nullable(),
	updated: z.number().int().min(0),
	maxSpeed: z.number().min(0).max(50).default(0),
	totals: z.object({
		distance: z.number().min(0).max(1000),
		seconds: z.number().min(0).max(7 * 86_400),
		steps: z.number().min(0).max(10_000_000),
		calories: z.number().min(0).max(1_000_000),
	}),
});

const SyncRequest = z.object({
	cursor: z.number().int().min(0).default(0),
	walks: z.array(Walk).max(MAX_WALKS).default([]),
	deleted: z
		.array(z.object({ uid: z.string().regex(/^[A-Za-z0-9-]{8,64}$/), at: z.number().int().min(0) }))
		.max(MAX_WALKS)
		.default([]),
	settings: z
		.object({
			goalKm: z.number().min(0.5).max(50).optional(),
			goalUpdated: z.number().int().min(0).optional(),
			timeZone: z.string().max(64).optional(),
		})
		.default({}),
});

interface WalkRow {
	uid: string;
	start: number;
	end: number | null;
	updated: number;
	changed_at: number;
	deleted: number;
	distance: number;
	seconds: number;
	steps: number;
	calories: number;
	max_speed: number;
}

export const toWalk = (row: WalkRow) => ({
	uid: row.uid,
	start: row.start,
	end: row.end,
	updated: row.updated,
	maxSpeed: row.max_speed,
	totals: { distance: row.distance, seconds: row.seconds, steps: row.steps, calories: row.calories },
});

function validZone(zone: string): boolean {
	try {
		new Intl.DateTimeFormat("en", { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

/** POST /api/sync */
export async function sync(request: Request, env: Env, user: User): Promise<Response> {
	if (Number(request.headers.get("content-length") ?? 0) > 1_000_000) return problem(413, "Too much at once.");
	const parsed = SyncRequest.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return problem(422, "Invalid sync request.");
	const { cursor, walks, deleted, settings } = parsed.data;
	const at = Date.now();

	const writes: D1PreparedStatement[] = [];
	for (const walk of walks) {
		writes.push(
			env.DB.prepare(
				`INSERT INTO walks (user_id, uid, start, "end", updated, changed_at, deleted, distance, seconds, steps, calories, max_speed)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8, ?9, ?10, ?11)
				 ON CONFLICT (user_id, uid) DO UPDATE SET
				   start = excluded.start, "end" = excluded."end", updated = excluded.updated,
				   changed_at = excluded.changed_at, deleted = 0, distance = excluded.distance,
				   seconds = excluded.seconds, steps = excluded.steps, calories = excluded.calories,
				   max_speed = excluded.max_speed
				 WHERE excluded.updated > walks.updated AND walks.deleted = 0`,
			).bind(
				user.id,
				walk.uid,
				walk.start,
				walk.end,
				walk.updated,
				at,
				walk.totals.distance,
				Math.round(walk.totals.seconds),
				Math.round(walk.totals.steps),
				Math.round(walk.totals.calories),
				walk.maxSpeed,
			),
		);
	}
	for (const { uid, at: when } of deleted) {
		// A deletion stays deleted: the walk's data goes, the uid remains so
		// other devices delete their copies too.
		writes.push(
			env.DB.prepare(
				`INSERT INTO walks (user_id, uid, start, updated, changed_at, deleted) VALUES (?1, ?2, 0, ?3, ?4, 1)
				 ON CONFLICT (user_id, uid) DO UPDATE SET
				   deleted = 1, updated = excluded.updated, changed_at = excluded.changed_at,
				   distance = 0, seconds = 0, steps = 0, calories = 0, max_speed = 0
				 WHERE walks.deleted = 0`,
			).bind(user.id, uid, when, at),
		);
	}
	if (settings.goalKm !== undefined && settings.goalUpdated !== undefined) {
		writes.push(
			env.DB.prepare(
				"UPDATE users SET goal_km = ?, goal_updated = ? WHERE id = ? AND goal_updated < ?",
			).bind(settings.goalKm, settings.goalUpdated, user.id, settings.goalUpdated),
		);
	}
	if (settings.timeZone && validZone(settings.timeZone)) {
		writes.push(env.DB.prepare("UPDATE users SET time_zone = ? WHERE id = ?").bind(settings.timeZone, user.id));
	}
	for (let i = 0; i < writes.length; i += 100) await env.DB.batch(writes.slice(i, i + 100));

	// At or after the cursor: rows written in the cursor's own millisecond are
	// sent again rather than missed. Applying a row twice changes nothing.
	const { results } = await env.DB.prepare(
		`SELECT uid, start, "end", updated, changed_at, deleted, distance, seconds, steps, calories, max_speed
		   FROM walks WHERE user_id = ? AND changed_at >= ? ORDER BY changed_at LIMIT ?`,
	)
		.bind(user.id, cursor, PAGE + 1)
		.all<WalkRow>();
	const more = results.length > PAGE;
	const page = results.slice(0, PAGE);
	const me = await env.DB.prepare("SELECT goal_km, goal_updated FROM users WHERE id = ?")
		.bind(user.id)
		.first<{ goal_km: number | null; goal_updated: number }>();

	return ok({
		cursor: page.length ? page[page.length - 1]!.changed_at : cursor,
		more,
		walks: page.filter((row) => !row.deleted).map(toWalk),
		deleted: page.filter((row) => row.deleted).map((row) => row.uid),
		settings: { goalKm: me?.goal_km ?? null, goalUpdated: me?.goal_updated ?? 0 },
	});
}

/**
 * DELETE /api/walks: reset. Every walk becomes a deletion, so the user's other
 * browsers delete their copies on their next sync. The account stays.
 */
export async function resetWalks(env: Env, user: User): Promise<Response> {
	const at = Date.now();
	const result = await env.DB.prepare(
		`UPDATE walks SET deleted = 1, updated = ?1, changed_at = ?1,
		   distance = 0, seconds = 0, steps = 0, calories = 0, max_speed = 0
		 WHERE user_id = ?2 AND deleted = 0`,
	)
		.bind(at, user.id)
		.run();
	return ok({ ok: true, deleted: result.meta.changes ?? 0 });
}

/** GET /api/me */
export async function me(env: Env, user: User): Promise<Response> {
	const counts = await env.DB.prepare(
		"SELECT COUNT(*) AS walks, MAX(changed_at) AS last FROM walks WHERE user_id = ? AND deleted = 0",
	)
		.bind(user.id)
		.first<{ walks: number; last: number | null }>();
	return ok({ email: user.email, walks: counts?.walks ?? 0, lastChange: counts?.last ?? null, mcp: `${env.SELF_URL}/mcp` });
}

/** GET /api/me/export: everything stored about this user, as one JSON file (access and portability). */
export async function exportData(env: Env, user: User): Promise<Response> {
	const account = await env.DB.prepare(
		"SELECT email, created_at, goal_km, time_zone, consented_at, policy_version FROM users WHERE id = ?",
	)
		.bind(user.id)
		.first<Record<string, unknown>>();
	const { results } = await env.DB.prepare(
		`SELECT uid, start, "end", updated, changed_at, deleted, distance, seconds, steps, calories, max_speed
		   FROM walks WHERE user_id = ? AND deleted = 0 ORDER BY start`,
	)
		.bind(user.id)
		.all<WalkRow>();
	const connected = (await (await assistants(env, user)).json()) as { assistants: unknown[] };
	const seconds = (t: unknown) => (typeof t === "number" ? new Date(t * 1000).toISOString() : null);
	return new Response(
		JSON.stringify(
			{
				exported: new Date().toISOString(),
				account: {
					email: account?.email,
					created: seconds(account?.created_at),
					dailyGoalKm: account?.goal_km ?? null,
					timeZone: account?.time_zone ?? null,
					consented: seconds(account?.consented_at),
					policyVersion: account?.policy_version,
				},
				walks: results.map(toWalk),
				assistants: connected.assistants,
			},
			null,
			2,
		),
		{
			headers: {
				"content-type": "application/json; charset=utf-8",
				"content-disposition": 'attachment; filename="walk-account.json"',
				"cache-control": "no-store",
			},
		},
	);
}

/** GET /api/me/assistants: the assistants this user has connected. */
export async function assistants(env: Env, user: User): Promise<Response> {
	const list: unknown[] = [];
	let cursor: string | undefined;
	do {
		const page = await env.OAUTH_PROVIDER.listUserGrants(user.id, { cursor, limit: 100 });
		for (const grant of page.items) {
			const client = await env.OAUTH_PROVIDER.lookupClient(grant.clientId);
			list.push({
				id: grant.id,
				name: (grant.metadata as { clientName?: string })?.clientName ?? client?.clientName ?? "An assistant",
				scopes: grant.scope,
				connected: grant.createdAt,
			});
		}
		cursor = page.cursor;
	} while (cursor);
	return ok({ assistants: list });
}

/** DELETE /api/me/assistants/:id */
export async function disconnect(env: Env, user: User, grantId: string): Promise<Response> {
	await env.OAUTH_PROVIDER.revokeGrant(grantId, user.id);
	return ok({ ok: true });
}

/** DELETE /api/me: the account, its walks, its sessions and every assistant's access. */
export async function deleteAccount(env: Env, user: User): Promise<Response> {
	let cursor: string | undefined;
	do {
		const page = await env.OAUTH_PROVIDER.listUserGrants(user.id, { cursor, limit: 100 });
		for (const grant of page.items) await env.OAUTH_PROVIDER.revokeGrant(grant.id, user.id);
		cursor = page.cursor;
	} while (cursor);
	await env.DB.batch([
		env.DB.prepare("DELETE FROM walks WHERE user_id = ?").bind(user.id),
		env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
		env.DB.prepare("DELETE FROM sign_in_codes WHERE email = ?").bind(user.email),
		env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
	]);
	return ok(
		{ ok: true },
		{ headers: { "set-cookie": "__Host-walk=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax" } },
	);
}
