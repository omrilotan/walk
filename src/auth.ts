import type { Env, User } from "./env.ts";
import { sendCode } from "./email.ts";
import { callerNetwork, take } from "./rate-limit.ts";
import { hashToken, newToken, now, ok, problem } from "./util.ts";

/**
 * Sign-in by emailed code, typed into the page that asked. There is no link:
 * signing in never opens another tab, so the Walk page holding the pad's
 * Bluetooth connection never has to reload or navigate.
 *
 * Asking for a code answers the same whether or not the address has an
 * account, so the form cannot tell anyone who uses Walk. The account is made
 * when the code is used.
 */

export const COOKIE = "__Host-walk";
/** The terms and privacy notice in force (public/privacy/, public/terms/). Bump when they change. */
export const POLICY_VERSION = "2026-11-04";
const SESSION_DAYS = 180;
const CODE_MINUTES = 15;
/** Wrong tries a browser gets per code. */
const CODE_TRIES = 5;

const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[^\s@<>"']{2,}$/;
/** The asking browser's random id: the code works only alongside it. */
const BROWSER = /^[A-Za-z0-9_-]{20,100}$/;

/** The signed-in user, from the session cookie. */
export async function currentUser(request: Request, env: Env): Promise<User | null> {
	const token = readCookie(request, COOKIE);
	if (!token) return null;
	const at = now();
	const row = await env.DB.prepare(
		`SELECT u.id, u.email, s.id AS session_id
		   FROM sessions s JOIN users u ON u.id = s.user_id
		  WHERE s.token_hash = ? AND s.expires_at > ?`,
	)
		.bind(await hashToken(token), at)
		.first<{ id: string; email: string; session_id: string }>();
	if (!row) return null;
	return { id: row.id, email: row.email, sessionId: row.session_id };
}

function readCookie(request: Request, name: string): string | null {
	const header = request.headers.get("cookie") ?? "";
	for (const part of header.split(";")) {
		const [key, ...value] = part.trim().split("=");
		if (key === name) return value.join("=") || null;
	}
	return null;
}

export function sessionCookie(token: string, maxAge: number): string {
	return `${COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

async function createSession(env: Env, userId: string): Promise<string> {
	const token = newToken();
	const at = now();
	await env.DB.prepare(
		`INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
		 VALUES (?, ?, ?, ?, ?)`,
	)
		.bind(crypto.randomUUID(), userId, await hashToken(token), at, at + SESSION_DAYS * 86_400)
		.run();
	return token;
}

/**
 * The account for an address, made on first sign-in. Every sign-in records
 * consent to the current terms and privacy notice, which the form asks for.
 */
async function userFor(env: Env, email: string): Promise<string> {
	const row = await env.DB.prepare(
		`INSERT INTO users (id, email, created_at, consented_at, policy_version) VALUES (?1, ?2, ?3, ?3, ?4)
		 ON CONFLICT (email) DO UPDATE SET consented_at = excluded.consented_at, policy_version = excluded.policy_version
		 RETURNING id`,
	)
		.bind(crypto.randomUUID(), email, now(), POLICY_VERSION)
		.first<{ id: string }>();
	return row!.id;
}

/** Uniform over 00000000–99999999. */
function eightDigits(): string {
	const limit = 0x1_0000_0000 - (0x1_0000_0000 % 100_000_000);
	for (;;) {
		const [value] = crypto.getRandomValues(new Uint32Array(1));
		if (value! < limit) return String(value! % 100_000_000).padStart(8, "0");
	}
}

/**
 * POST /api/auth/start {email, browser}: emails a code.
 *
 * Guessing: a code allows CODE_TRIES guesses, only from the browser that
 * asked, and an address gets at most 10 codes a day, so a stranger has
 * about one chance in two million a day, and the owner sees the emails.
 */
export async function startSignIn(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
	const browser = typeof body?.browser === "string" ? body.browser : "";
	if (!EMAIL.test(email) || email.length > 254) return problem(422, "Enter a valid email address.");
	if (!BROWSER.test(browser)) return problem(422, "Invalid request.");
	if (body?.consent !== true) return problem(422, "Please agree to the terms and privacy notice first.");

	// The caller's network first, so a caller turned away spends nothing of
	// the address's allowance; then the address, so nobody can flood an inbox.
	const network = await take(env, { bucket: "code:net", subject: callerNetwork(request), allow: 10, per: 3600 });
	if (!network.ok) return tooMany("Too many sign-in attempts from here. Try again later.", network.retryAfter);
	const short = await take(env, { bucket: "code:email", subject: email, allow: 3, per: 900 });
	if (!short.ok) return tooMany("Three codes in fifteen minutes is the limit. Check your inbox and spam folder.", short.retryAfter);
	const day = await take(env, { bucket: "code:email:day", subject: email, allow: 10, per: 86_400 });
	if (!day.ok) return tooMany("That address has had enough sign-in codes for today.", day.retryAfter);

	const code = eightDigits();
	const at = now();
	await env.DB.prepare(
		`INSERT INTO sign_in_codes (id, email, browser_hash, code_hash, created_at, expires_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			crypto.randomUUID(),
			email,
			await hashToken(browser),
			await hashToken(`${browser}:${code}`),
			at,
			at + CODE_MINUTES * 60,
		)
		.run();

	if (env.DEV_AUTH === "true") {
		await sendCode(env, email, code, CODE_MINUTES);
		return ok({ ok: true, debugCode: code });
	}
	ctx.waitUntil(
		sendCode(env, email, code, CODE_MINUTES).catch((error: unknown) =>
			console.error("[auth] sign-in email not sent", error),
		),
	);
	return ok({ ok: true });
}

function tooMany(title: string, retryAfter: number): Response {
	return problem(429, title, { "retry-after": String(retryAfter) });
}

/** POST /api/auth/code {browser, code}: the code from the email, in the browser that asked. */
export async function enterCode(request: Request, env: Env): Promise<Response> {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const browser = typeof body?.browser === "string" ? body.browser : "";
	const code = typeof body?.code === "string" ? body.code.replace(/\D/g, "") : "";
	if (!BROWSER.test(browser) || code.length !== 8) return problem(422, "Enter the eight-digit code.");

	// Every attempt spends a try on each live code this browser holds, in one
	// statement, so attempts made at once cannot share a try.
	const { results } = await env.DB.prepare(
		`UPDATE sign_in_codes SET tries = tries + 1
		  WHERE browser_hash = ? AND expires_at > ? AND tries < ?
		  RETURNING id, code_hash`,
	)
		.bind(await hashToken(browser), now(), CODE_TRIES)
		.all<{ id: string; code_hash: string }>();
	const wanted = await hashToken(`${browser}:${code}`);
	const match = results.find((row) => row.code_hash === wanted);
	const row = match
		? await env.DB.prepare("DELETE FROM sign_in_codes WHERE id = ? RETURNING email") // used: gone
				.bind(match.id)
				.first<{ email: string }>()
		: null;
	if (!row) return problem(400, "That code didn't work. Check it, or ask for a new one.");
	const session = await createSession(env, await userFor(env, row.email));
	return ok({ ok: true, email: row.email }, { headers: { "set-cookie": sessionCookie(session, SESSION_DAYS * 86_400) } });
}

/** POST /api/auth/signout */
export async function signOut(request: Request, env: Env): Promise<Response> {
	const token = readCookie(request, COOKIE);
	if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await hashToken(token)).run();
	return ok({ ok: true }, { headers: { "set-cookie": sessionCookie("", 0) } });
}
