import type { Env } from "./env.ts";
import { hashToken, now } from "./util.ts";

export interface Limit {
	/** What is being limited; names the counter. */
	bucket: string;
	/** Who or what is counted: an email address, a network. */
	subject: string;
	/** Calls allowed inside one window. */
	allow: number;
	/** Window length in seconds. */
	per: number;
}

export interface Verdict {
	ok: boolean;
	/** Seconds until the window resets. */
	retryAfter: number;
	remaining: number;
}

/**
 * A fixed window per (bucket, subject), counted in D1. A caller can spend two
 * windows' worth across a boundary; that is fine for stopping somebody from
 * filling another person's inbox.
 */
export async function take(env: Env, limit: Limit): Promise<Verdict> {
	const at = now();
	const row = await env.DB.prepare(
		`INSERT INTO rate_limits (bucket, subject, window_end, count)
		 VALUES (?1, ?2, ?3, 1)
		 ON CONFLICT (bucket, subject) DO UPDATE SET
		   count = CASE WHEN rate_limits.window_end <= ?4 THEN 1 ELSE rate_limits.count + 1 END,
		   window_end = CASE WHEN rate_limits.window_end <= ?4 THEN ?3 ELSE rate_limits.window_end END
		 RETURNING count, window_end`,
	)
		// Who is counted is kept only as a hash: no email address or IP in this table.
		.bind(limit.bucket, await hashToken(`${limit.bucket}:${limit.subject}`), at + limit.per, at)
		.first<{ count: number; window_end: number }>();
	const count = row?.count ?? 1;
	const windowEnd = row?.window_end ?? at + limit.per;
	return {
		ok: count <= limit.allow,
		retryAfter: Math.max(1, windowEnd - at),
		remaining: Math.max(0, limit.allow - count),
	};
}

/** The caller's network: an IPv4 address as is, an IPv6 address as its /64. */
export function callerNetwork(request: Request): string {
	const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
	if (!ip.includes(":")) return ip;
	if (ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1);
	const [head = "", tail] = ip.toLowerCase().split("::");
	const left = head ? head.split(":") : [];
	const right = tail ? tail.split(":") : [];
	const groups =
		tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
	return `${groups
		.slice(0, 4)
		.map((group) => group.replace(/^0+(?=.)/, ""))
		.join(":")}::/64`;
}

/** How long a deletion is kept so other browsers learn of it. */
const TOMBSTONE_DAYS = 90;
/** Accounts with no sync and no sign-in for this long are deleted. */
const INACTIVE_DAYS = 2 * 365;

/** Daily housekeeping: keep nothing longer than it's needed (public/privacy/). */
export async function prune(env: Env): Promise<void> {
	const at = now();
	const inactive = at - INACTIVE_DAYS * 86_400;
	await env.DB.batch([
		env.DB.prepare("DELETE FROM rate_limits WHERE window_end <= ?").bind(at),
		env.DB.prepare("DELETE FROM sign_in_codes WHERE expires_at <= ?").bind(at),
		env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(at),
		env.DB.prepare("DELETE FROM walks WHERE deleted = 1 AND changed_at <= ?").bind((at - TOMBSTONE_DAYS * 86_400) * 1000),
		// Abandoned accounts: nothing synced and no sign-in for two years.
		env.DB.prepare(
			`DELETE FROM users WHERE created_at <= ?1
			   AND NOT EXISTS (SELECT 1 FROM walks w WHERE w.user_id = users.id AND w.changed_at > ?1 * 1000)
			   AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = users.id AND s.created_at > ?1)`,
		).bind(inactive),
	]);
}
