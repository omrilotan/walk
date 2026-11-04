import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env, Props } from "./env.ts";
// The same arithmetic the app's dashboard uses, so the numbers agree.
import { summarize } from "../public/app/stats.js";

/**
 * The remote MCP server: what an assistant can do with a user's synced walks
 * from anywhere, with no browser open. It reads; the one change it can make,
 * the daily goal, needs the "goal" scope. Driving the pad is not here: that
 * needs the browser that holds the Bluetooth connection.
 */

interface Row {
	uid: string;
	start: number;
	end: number | null;
	distance: number;
	seconds: number;
	steps: number;
	calories: number;
	max_speed: number;
}

interface Session {
	start: number;
	end: number | null;
	maxSpeed: number;
	totals: { distance: number; seconds: number; steps: number; calories: number };
	/** The real start, for reporting; `start` is shifted to the user's wall clock. */
	at: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
	let format = formatters.get(zone);
	if (!format) {
		format = new Intl.DateTimeFormat("en-US", {
			timeZone: zone,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
		formatters.set(zone, format);
	}
	return format;
}

/**
 * The user's wall-clock time, written as if it were UTC. The Worker's own
 * clock is UTC, so stats.js, which counts days with local-time methods,
 * then counts the user's days.
 */
function wallClock(t: number, zone: string): number {
	const parts = Object.fromEntries(formatter(zone).formatToParts(t).map((p) => [p.type, Number(p.value)]));
	return Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!) + (t % 1000);
}

/** "2026-11-04 08:30" in the user's zone. */
function local(t: number, zone: string): string {
	return new Date(wallClock(t, zone)).toISOString().slice(0, 16).replace("T", " ");
}

export function createServer(env: Env, props: Props): McpServer {
	const server = new McpServer(
		{
			name: "walk",
			title: "Walk",
			version: "1.0.0",
			websiteUrl: env.SELF_URL,
			icons: [{ src: `${env.SELF_URL}/icon.svg`, mimeType: "image/svg+xml", sizes: ["any"] }],
		},
		{
			instructions:
				"Walk records walks on an under-desk walking pad. These tools read the user's walks as synced from their browser: a walk shows up here after Walk syncs it, usually when the walk ends. Times are in the user's own time zone. You cannot start or stop the pad from here.",
		},
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
			`SELECT uid, start, "end", distance, seconds, steps, calories, max_speed
			   FROM walks WHERE user_id = ? AND deleted = 0 ORDER BY start DESC`,
		)
			.bind(props.userId)
			.all<Row>();
		const sessions: Session[] = results.map((row) => ({
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
			start: local(s.at, zone),
			end: s.end ? local(s.end, zone) : null,
			...totals(s.totals),
			averageKmh: s.totals.seconds ? r2((s.totals.distance / s.totals.seconds) * 3600) : 0,
			topSpeedKmh: s.maxSpeed,
		};

	server.registerTool(
		"get_summary",
		{
			title: "Walking summary",
			description:
				"The user's walking stats: today (distance, minutes, steps, calories, walks), the daily goal in km and progress toward it, yesterday, this week (Monday to today) and the change versus the same days last week, the current streak in days, active days in the last 30, lifetime totals, personal records, and the last walk.",
			inputSchema: z.object({}),
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		},
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
		{
			title: "Daily totals",
			description:
				"Distance, minutes, steps and number of walks for each of the last N days, oldest first, ending today, with whether the daily goal was met. Days without walks are included with zeros.",
			inputSchema: z.object({
				days: z.number().int().min(1).max(366).default(14).describe("How many days, ending today. Default 14."),
			}),
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		},
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
		{
			title: "Walks",
			description:
				"Individual walks, newest first: start and end (local time), distance, minutes, steps, calories, average and top speed. Optionally between two dates (YYYY-MM-DD, inclusive, in the user's time zone).",
			inputSchema: z.object({
				from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("First day, YYYY-MM-DD."),
				to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Last day, YYYY-MM-DD."),
				limit: z.number().int().min(1).max(200).default(20).describe("At most this many. Default 20."),
			}),
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		},
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

	if (props.scopes.includes("goal")) {
		server.registerTool(
			"set_goal",
			{
				title: "Set daily goal",
				description:
					"Sets the user's daily walking goal in km. Every device with Walk picks it up on its next sync. Ask the user before changing it.",
				inputSchema: z.object({ km: z.number().min(0.5).max(50).describe("Daily goal in km.") }),
				annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			},
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

	return server;
}
