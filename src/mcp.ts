import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env, Props } from "./env.ts";
// The same arithmetic the app's dashboard uses, so the numbers agree.
import { summarize } from "../public/app/stats.js";
// The rules for adding and correcting walks, shared with the page.
import { changedWalk, manualWalk, numbersOf, problemWith, rates } from "../public/app/walks.js";
import { fromLocal, local, wallClock } from "./time.ts";

export { fromLocal, wallClock };

/**
 * The remote MCP server: what an assistant can do with a user's synced walks
 * from anywhere, with no browser open. It reads. With the "goal" scope it
 * sets the daily goal; with the "edit" scope it adds, corrects and deletes
 * walks. Driving the pad is not here: that needs the browser that holds the
 * Bluetooth connection. A change made here reaches the user's browsers on
 * their next sync.
 */

type Origin = "manual" | "edited" | null;

interface Row {
	uid: string;
	start: number;
	end: number | null;
	distance: number;
	seconds: number;
	steps: number;
	calories: number;
	max_speed: number;
	origin: Origin;
	agent: number;
}

interface Session {
	uid: string;
	origin: Origin;
	agent: boolean;
	start: number;
	end: number | null;
	maxSpeed: number;
	totals: { distance: number; seconds: number; steps: number; calories: number };
	/** The real start, for reporting; `start` is shifted to the user's wall clock. */
	at: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Who the server is: shared by the MCP handshake and the server card. */
export const SERVER = { name: "walk", title: "Walk", version: "1.0.0" } as const;

export const INSTRUCTIONS =
	"Walk records walks on an under-desk walking pad. These tools read the user's walks as synced from their browser: a walk shows up here after Walk syncs it, usually when the walk ends. Times are in the user's own time zone. If the user allowed it, you can also set the daily goal, and add, correct and delete walks; ask the user before you change anything. A change reaches the user's browsers on their next sync. You cannot start or stop the pad from here.";

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

/**
 * The tools, described once: registered below, and listed in the server card
 * (src/discovery.ts). `scope` names the permission a tool needs beyond "read".
 */
export const TOOLS = {
	get_summary: {
		title: "Walking summary",
		description:
			"The user's walking stats: today (distance, minutes, steps, calories, walks), the daily goal in km and progress toward it, yesterday, this week (Monday to today) and the change versus the same days last week, the current streak in days, active days in the last 30, lifetime totals, personal records, and the last walk.",
		inputSchema: z.object({}),
		annotations: readOnly,
	},
	get_daily_totals: {
		title: "Daily totals",
		description:
			"Distance, minutes, steps and number of walks for each of the last N days, oldest first, ending today, with whether the daily goal was met. Days without walks are included with zeros.",
		inputSchema: z.object({
			days: z.number().int().min(1).max(366).default(14).describe("How many days, ending today. Default 14."),
		}),
		annotations: readOnly,
	},
	get_walks: {
		title: "Walks",
		description:
			"Individual walks, newest first: id, start and end (local time), distance, minutes, steps, calories, average and top speed. Each walk has an id, which edit_walk and delete_walk take. Optionally between two dates (YYYY-MM-DD, inclusive, in the user's time zone).",
		inputSchema: z.object({
			from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("First day, YYYY-MM-DD."),
			to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Last day, YYYY-MM-DD."),
			limit: z.number().int().min(1).max(200).default(20).describe("At most this many. Default 20."),
		}),
		annotations: readOnly,
	},
	set_goal: {
		title: "Set daily goal",
		description:
			"Sets the user's daily walking goal in km. Every device with Walk picks it up on its next sync. Ask the user before changing it.",
		inputSchema: z.object({ km: z.number().min(0.5).max(50).describe("Daily goal in km.") }),
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		scope: "goal",
	},
	add_walk: {
		title: "Add a walk",
		description:
			"Adds a walk the user did not record with the pad. Ask the user to confirm the details first. Give the start in the user's own time zone. Steps and calories are estimated from the user's recorded walks when left out. The walk is marked as an assistant's and does not count toward personal records.",
		inputSchema: z.object({
			start: z.string().describe("When the walk started, in the user's time zone: YYYY-MM-DD HH:MM."),
			minutes: z.number().gt(0).describe("Walking time in minutes."),
			distanceKm: z.number().gt(0).describe("Distance in km."),
			steps: z.number().int().optional().describe("Steps. Estimated if left out."),
			calories: z.number().int().optional().describe("Calories. Estimated if left out."),
			topSpeedKmh: z.number().optional().describe("Top speed in km/h. The average if left out."),
		}),
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
		scope: "edit",
	},
	edit_walk: {
		title: "Correct a walk",
		description:
			"Changes the numbers of a finished walk: give its id (from get_walks) and what to change. Ask the user before changing a walk. The walk is then marked as an assistant's and does not count toward personal records.",
		inputSchema: z.object({
			id: z.string().describe("The walk's id, from get_walks."),
			start: z.string().optional().describe("New start, in the user's time zone: YYYY-MM-DD HH:MM."),
			minutes: z.number().gt(0).optional().describe("New walking time in minutes."),
			distanceKm: z.number().gt(0).optional().describe("New distance in km."),
			steps: z.number().int().optional().describe("New steps."),
			calories: z.number().int().optional().describe("New calories."),
			topSpeedKmh: z.number().optional().describe("New top speed in km/h."),
		}),
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
		scope: "edit",
	},
	delete_walk: {
		title: "Delete a walk",
		description:
			"Deletes a finished walk by its id (from get_walks). Ask the user before deleting. The user can restore it in Walk for 30 days.",
		inputSchema: z.object({ id: z.string().describe("The walk's id, from get_walks.") }),
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
		scope: "edit",
	},
} as const;

export function createServer(env: Env, props: Props): McpServer {
	const server = new McpServer(
		{
			...SERVER,
			websiteUrl: env.SELF_URL,
			icons: [{ src: `${env.SELF_URL}/icon.svg`, mimeType: "image/svg+xml", sizes: ["any"] }],
		},
		{ instructions: INSTRUCTIONS },
	);

	const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
	const failure = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

	async function load() {
		const user = await env.DB.prepare("SELECT goal_km, time_zone FROM users WHERE id = ?")
			.bind(props.userId)
			.first<{ goal_km: number | null; time_zone: string | null }>();
		if (!user) return null;
		const zone = user.time_zone ?? "UTC";
		const { results } = await env.DB.prepare(
			`SELECT uid, start, "end", distance, seconds, steps, calories, max_speed, origin, agent
			   FROM walks WHERE user_id = ? AND deleted = 0 ORDER BY start DESC`,
		)
			.bind(props.userId)
			.all<Row>();
		const sessions: Session[] = results.map((row) => ({
			uid: row.uid,
			origin: row.origin,
			agent: row.agent === 1,
			start: wallClock(row.start, zone),
			end: row.end,
			at: row.start,
			maxSpeed: row.max_speed,
			totals: { distance: row.distance, seconds: row.seconds, steps: row.steps, calories: row.calories },
		}));
		return { goal: user.goal_km ?? 5, zone, sessions };
	}

	const gone = "This Walk account no longer exists. Disconnect Walk and connect again.";
	const totals = (t: Session["totals"]) => ({
		distanceKm: r2(t.distance),
		minutes: Math.round(t.seconds / 60),
		steps: Math.round(t.steps),
		calories: Math.round(t.calories),
	});
	const day = (d: { walks: number } & Session["totals"]) => ({ walks: d.walks, ...totals(d) });
	const walkInfo = (s: Session | null, zone: string) =>
		s && {
			id: s.uid,
			start: local(s.at, zone),
			end: s.end ? local(s.end, zone) : null,
			...totals(s.totals),
			averageKmh: s.totals.seconds ? r2((s.totals.distance / s.totals.seconds) * 3600) : 0,
			topSpeedKmh: s.maxSpeed,
			...(s.origin && { origin: s.origin }),
			...(s.agent && { byAssistant: true }),
		};

	/** A live, finished walk of this user as a session with real times, or the sentence to answer with. */
	async function findWalk(id: string): Promise<(Session & { updated: number }) | string> {
		const row = await env.DB.prepare(
			`SELECT uid, start, "end", updated, distance, seconds, steps, calories, max_speed, origin, agent
			   FROM walks WHERE user_id = ? AND uid = ? AND deleted = 0`,
		)
			.bind(props.userId, id)
			.first<Row & { updated: number }>();
		if (!row) return "No walk with that id. Use get_walks to see ids.";
		if (row.end === null) return "That walk is still being recorded.";
		return {
			uid: row.uid,
			origin: row.origin,
			agent: row.agent === 1,
			start: row.start,
			at: row.start,
			end: row.end,
			updated: row.updated,
			maxSpeed: row.max_speed,
			totals: { distance: row.distance, seconds: row.seconds, steps: row.steps, calories: row.calories },
		};
	}

	server.registerTool(
		"get_summary",
		TOOLS.get_summary,
		async () => {
			const data = await load();
			if (!data) return failure(gone);
			const { goal, zone, sessions } = data;
			const s = summarize(sessions, wallClock(Date.now(), zone));
			return text({
				timeZone: zone,
				now: local(Date.now(), zone),
				today: day(s.today),
				goalKm: goal,
				goalProgress: r2(s.today.distance / goal),
				yesterday: day(s.yesterday),
				thisWeek: day(s.thisWeek),
				changeVersusLastWeek: s.weekDelta === null ? null : r2(s.weekDelta),
				streakDays: s.streak,
				activeDaysLast30: s.activeDays30,
				lifetime: day(s.lifetime),
				records: {
					longestDistance: walkInfo(s.records.longest, zone),
					longestTime: walkInfo(s.records.longestTime, zone),
					fastestAverage: walkInfo(s.records.fastest, zone),
				},
				lastWalk: walkInfo(sessions[0] ?? null, zone),
			});
		},
	);

	server.registerTool(
		"get_daily_totals",
		TOOLS.get_daily_totals,
		async ({ days }) => {
			const data = await load();
			if (!data) return failure(gone);
			const { goal, zone, sessions } = data;
			const byDay = new Map<string, { walks: number } & Session["totals"]>();
			for (const s of sessions) {
				const key = new Date(s.start).toISOString().slice(0, 10);
				const d = byDay.get(key) ?? { walks: 0, distance: 0, seconds: 0, steps: 0, calories: 0 };
				d.walks++;
				d.distance += s.totals.distance;
				d.seconds += s.totals.seconds;
				d.steps += s.totals.steps;
				d.calories += s.totals.calories;
				byDay.set(key, d);
			}
			const today = new Date(wallClock(Date.now(), zone));
			const list = Array.from({ length: days }, (_, i) => {
				const t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (days - 1 - i)));
				const key = t.toISOString().slice(0, 10);
				const d = byDay.get(key) ?? { walks: 0, distance: 0, seconds: 0, steps: 0, calories: 0 };
				return { date: key, ...day(d), goalMet: d.distance >= goal };
			});
			return text({ timeZone: zone, goalKm: goal, days: list });
		},
	);

	server.registerTool(
		"get_walks",
		TOOLS.get_walks,
		async ({ from, to, limit }) => {
			const data = await load();
			if (!data) return failure(gone);
			const { zone, sessions } = data;
			const picked = sessions
				.filter((s) => {
					const key = new Date(s.start).toISOString().slice(0, 10);
					return (!from || key >= from) && (!to || key <= to);
				})
				.slice(0, limit);
			return text({ timeZone: zone, walks: picked.map((s) => walkInfo(s, zone)) });
		},
	);

	if (props.scopes.includes(TOOLS.set_goal.scope)) {
		server.registerTool(
			"set_goal",
			TOOLS.set_goal,
			async ({ km }) => {
				const goal = Math.round(km * 10) / 10;
				const result = await env.DB.prepare("UPDATE users SET goal_km = ?, goal_updated = ? WHERE id = ?")
					.bind(goal, Date.now(), props.userId)
					.run();
				if (!result.meta.changes) return failure(gone);
				return text({ goalKm: goal });
			},
		);
	}

	if (props.scopes.includes(TOOLS.add_walk.scope)) {
		server.registerTool(
			"add_walk",
			TOOLS.add_walk,
			async ({ start, minutes, distanceKm, steps, calories, topSpeedKmh }) => {
				const data = await load();
				if (!data) return failure(gone);
				const { zone, sessions } = data;
				const at = fromLocal(start, zone);
				if (at === null) return failure("Give the start as YYYY-MM-DD HH:MM, in the user's time zone.");
				const now = Date.now();
				const input = { start: at, seconds: minutes * 60, distance: distanceKm, steps, calories, maxSpeed: topSpeedKmh };
				const problem = problemWith(input, now);
				if (problem) return failure(problem);
				// Two walks can't start at the same moment: that is a walk added twice.
				const same = await env.DB.prepare("SELECT 1 AS found FROM walks WHERE user_id = ? AND start = ? AND deleted = 0")
					.bind(props.userId, at)
					.first();
				if (same) return failure("There is already a walk that started at that time.");
				// walks.js has no types: its `per` is inferred as null only.
				const walk = manualWalk(input, { now, per: rates(sessions) as null, agent: true });
				await env.DB.prepare(
					`INSERT INTO walks (user_id, uid, start, "end", updated, changed_at, deleted, distance, seconds, steps, calories, max_speed, origin, agent)
					 VALUES (?1, ?2, ?3, ?4, ?5, ?5, 0, ?6, ?7, ?8, ?9, ?10, 'manual', 1)`,
				)
					.bind(
						props.userId,
						walk.uid,
						walk.start,
						walk.end,
						now,
						walk.totals.distance,
						walk.totals.seconds,
						walk.totals.steps,
						walk.totals.calories,
						walk.maxSpeed,
					)
					.run();
				return text({ added: walkInfo({ ...walk, at: walk.start, origin: "manual", agent: true }, zone) });
			},
		);

		server.registerTool(
			"edit_walk",
			TOOLS.edit_walk,
			async ({ id, start, minutes, distanceKm, steps, calories, topSpeedKmh }) => {
				if (![start, minutes, distanceKm, steps, calories, topSpeedKmh].some((v) => v !== undefined)) {
					return failure("Say what to change: start, minutes, distanceKm, steps, calories or topSpeedKmh.");
				}
				const data = await load();
				if (!data) return failure(gone);
				const found = await findWalk(id);
				if (typeof found === "string") return failure(found);
				const now = Date.now();
				const changes: Record<string, number | undefined> = {
					seconds: minutes === undefined ? undefined : minutes * 60,
					distance: distanceKm,
					steps,
					calories,
					maxSpeed: topSpeedKmh,
				};
				if (start !== undefined) {
					const at = fromLocal(start, data.zone);
					if (at === null) return failure("Give the start as YYYY-MM-DD HH:MM, in the user's time zone.");
					changes.start = at;
				}
				const walk = changedWalk(found, changes, { now, agent: true });
				const problem = problemWith(numbersOf(walk), now);
				if (problem) return failure(problem);
				const result = await env.DB.prepare(
					`UPDATE walks SET start = ?1, "end" = ?2, updated = ?3, changed_at = ?4, distance = ?5, seconds = ?6,
					   steps = ?7, calories = ?8, max_speed = ?9, origin = ?10, agent = 1
					 WHERE user_id = ?11 AND uid = ?12 AND deleted = 0`,
				)
					.bind(
						walk.start,
						walk.end,
						walk.updated,
						now,
						walk.totals.distance,
						walk.totals.seconds,
						walk.totals.steps,
						walk.totals.calories,
						walk.maxSpeed,
						walk.origin,
						props.userId,
						id,
					)
					.run();
				// Deleted in the moment between looking and writing.
				if (!result.meta.changes) return failure("No walk with that id. Use get_walks to see ids.");
				return text({ changed: walkInfo({ ...walk, uid: id, at: walk.start, origin: walk.origin as Origin, agent: true }, data.zone) });
			},
		);

		server.registerTool(
			"delete_walk",
			TOOLS.delete_walk,
			async ({ id }) => {
				const data = await load();
				if (!data) return failure(gone);
				const found = await findWalk(id);
				if (typeof found === "string") return failure(found);
				const now = Date.now();
				// The same marker a browser writes: the data goes, the id stays, so every device deletes its copy.
				await env.DB.prepare(
					`UPDATE walks SET deleted = 1, updated = ?1, changed_at = ?1,
					   distance = 0, seconds = 0, steps = 0, calories = 0, max_speed = 0
					 WHERE user_id = ?2 AND uid = ?3 AND deleted = 0`,
				)
					.bind(now, props.userId, id)
					.run();
				return text({
					deleted: walkInfo(found, data.zone),
					note: "The user can restore it for 30 days: Menu, Deleted walks, in a browser where Walk had this walk.",
				});
			},
		);
	}

	return server;
}
