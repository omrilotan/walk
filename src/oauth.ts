import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { currentUser } from "./auth.ts";
import { SCOPES, type Env, type Props, type Scope } from "./env.ts";
import { escapeHtml, newToken, page, problem, sameOrigin } from "./util.ts";

/**
 * Connecting an assistant: /authorize → (sign in) → consent → back to the
 * assistant. The authorization request waits in KV under a random id, so the
 * consent page shows only what the client registered (its name, and the host
 * the answer goes to), and the answer can only finish a request that started
 * here.
 */

const PENDING_TTL = 15 * 60;

interface Pending {
	auth: AuthRequest;
	clientName: string;
	redirectHost: string;
	/** Must come back with the form: the page that shows the request posts the answer. */
	csrf: string;
}

const key = (id: string) => `consent:${id}`;

async function load(env: Env, id: string | null): Promise<Pending | null> {
	if (!id || !/^[0-9a-f-]{36}$/.test(id)) return null;
	return env.OAUTH_KV.get<Pending>(key(id), "json");
}

/** Reading is the point of connecting; the goal is asked for separately. */
function grantedScopes(requested: string[]): Scope[] {
	const known = requested.filter((s): s is Scope => (SCOPES as readonly string[]).includes(s));
	return [...new Set<Scope>(["read", ...(known.length ? known : SCOPES)])];
}

/** GET /authorize */
export async function authorize(request: Request, env: Env): Promise<Response> {
	let auth: AuthRequest;
	try {
		auth = await env.OAUTH_PROVIDER.parseAuthRequest(request);
	} catch (error) {
		return problem(400, `Bad authorization request: ${String(error)}`);
	}
	const client = await env.OAUTH_PROVIDER.lookupClient(auth.clientId);
	if (!client) return problem(400, "Unknown client.");
	const id = crypto.randomUUID();
	const pending: Pending = {
		auth,
		clientName: (client.clientName ?? "").trim().slice(0, 80) || "An assistant",
		redirectHost: new URL(auth.redirectUri).host,
		csrf: newToken(),
	};
	await env.OAUTH_KV.put(key(id), JSON.stringify(pending), { expirationTtl: PENDING_TTL });
	// Signing in, if needed, happens on the consent page itself.
	return Response.redirect(new URL(`/oauth/consent?req=${id}`, env.SELF_URL).href, 302);
}

const SCOPE_TEXT: Record<Scope, string> = {
	read: "Read your walks and stats: distance, time, steps, calories, streaks and records.",
	goal: "Change your daily distance goal.",
};

/** GET and POST /oauth/consent */
export async function consent(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const user = await currentUser(request, env);

	if (request.method === "GET") {
		const id = url.searchParams.get("req");
		const pending = await load(env, id);
		if (!pending) return expired();
		if (!user) {
			// Sign in right here: the page asks for a code and reloads itself once signed in.
			return page(
				"Sign in to connect",
				`<h1>Sign in to connect ${escapeHtml(pending.clientName)}</h1>
				<p class="muted">${escapeHtml(pending.clientName)} wants to read your walks in Walk. Sign in with the email address you use in Walk. We'll email you a code.</p>
				<form id="email-form">
					<label>Email<input id="email" type="email" autocomplete="email" required maxlength="254" /></label>
					<label class="consent"><input id="consent" type="checkbox" required /><span>I'm 16 or over, I agree to the <a href="/terms/" target="_blank">terms</a>, and I consent to Walk storing my email address and walk totals as the <a href="/privacy/" target="_blank">privacy notice</a> describes.</span></label>
					<button class="btn-primary" type="submit">Email me a code</button>
				</form>
				<form id="code-form" hidden>
					<p>We sent a code to <b id="sent-to"></b>.</p>
					<label>Code<input id="code" class="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="9" required /></label>
					<button class="btn-primary" type="submit">Sign in</button>
				</form>
				<p id="error" class="error" role="alert"></p>`,
				200,
				"/app/consent.js",
			);
		}
		const scopes = grantedScopes(pending.auth.scope);
		return page(
			"Connect an assistant",
			`<h1>Connect ${escapeHtml(pending.clientName)} to Walk?</h1>
			<p>Signed in as <b>${escapeHtml(user.email)}</b>.</p>
			<p>${escapeHtml(pending.clientName)} will be able to:</p>
			<ul class="plain-list">${scopes.map((s) => `<li>${escapeHtml(SCOPE_TEXT[s])}</li>`).join("")}</ul>
			<p class="muted small">It can't start or stop your walking pad, and it can't delete anything. It sees walks Walk has synced from your browser. You can disconnect it any time in Walk, under Menu, Sync and assistants.</p>
			<p class="muted small">After you answer, you go back to <b>${escapeHtml(pending.redirectHost)}</b>.</p>
			<form method="post" action="/oauth/consent" class="plain-actions">
				<input type="hidden" name="req" value="${escapeHtml(id!)}" />
				<input type="hidden" name="csrf" value="${escapeHtml(pending.csrf)}" />
				<button class="btn-primary" type="submit" name="answer" value="allow">Allow</button>
				<button class="btn" type="submit" name="answer" value="deny">Deny</button>
			</form>`,
		);
	}

	if (request.method !== "POST" || !sameOrigin(request, env)) return refused();
	if (!user) return expired();
	const form = await request.formData().catch(() => null);
	const id = String(form?.get("req") ?? "");
	const pending = await load(env, id);
	if (!pending) return expired();
	if (String(form?.get("csrf") ?? "") !== pending.csrf) return refused();
	await env.OAUTH_KV.delete(key(id));

	if (form?.get("answer") !== "allow") {
		const back = new URL(pending.auth.redirectUri);
		back.searchParams.set("error", "access_denied");
		if (pending.auth.state) back.searchParams.set("state", pending.auth.state);
		return Response.redirect(back.href, 302);
	}

	const scopes = grantedScopes(pending.auth.scope);
	const props: Props = { userId: user.id, scopes, clientName: pending.clientName };
	const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
		request: pending.auth,
		userId: user.id,
		metadata: { clientName: pending.clientName },
		scope: scopes,
		props,
	});
	return Response.redirect(redirectTo, 302);
}

function refused(): Response {
	return page(
		"Couldn't connect",
		"<h1>That didn't go through</h1><p>Start connecting again from your assistant.</p>",
		403,
	);
}

function expired(): Response {
	return page(
		"Request expired",
		"<h1>This request has expired</h1><p>Start connecting again from your assistant.</p>",
		410,
	);
}
