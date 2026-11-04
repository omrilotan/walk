import type { Env } from "./env.ts";

/** Seconds since the epoch: what every expiry here is measured in. */
export const now = (): number => Math.floor(Date.now() / 1000);

/** 32 random bytes, URL-safe. Sign-in links, sessions and codes start here. */
export function newToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
}

/** Only hashes are stored: a copy of the database signs nobody in. */
export async function hashToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function escapeHtml(value: string): string {
	return value.replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
	);
}

/** Problem details, as JSON. */
export function problem(status: number, title: string, headers: HeadersInit = {}): Response {
	return Response.json({ status, title }, { status, headers: { ...noStore, ...headers } });
}

export const noStore = { "cache-control": "no-store" };

export function ok(body: unknown, init: ResponseInit = {}): Response {
	const headers = new Headers(init.headers);
	headers.set("cache-control", "no-store");
	return Response.json(body, { ...init, headers });
}

/**
 * Requests that change something must come from this site's own pages. The
 * session cookie is SameSite=Lax already; this also stops a form on another
 * site, and a page that signs the visitor into someone else's account.
 */
export function sameOrigin(request: Request, _env?: Env): boolean {
	return request.headers.get("origin") === new URL(request.url).origin;
}

/** The page shell for the few pages the Worker writes itself. */
export function page(title: string, body: string, status = 200, script?: string): Response {
	return new Response(
		`<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<meta name="robots" content="noindex" />
		<title>${escapeHtml(title)} | Walk</title>
		<link rel="icon" href="/icon.svg" type="image/svg+xml" />
		<link rel="stylesheet" href="/app/app.css" />
		<link rel="stylesheet" href="/app/plain.css" />
		${script ? `<script type="module" src="${escapeHtml(script)}"></script>` : ""}
	</head>
	<body class="plain">
		<main class="plain-card">
			<a class="plain-brand" href="/"><img src="/icon.svg" alt="" width="32" height="32" />Walk</a>
			${body}
		</main>
	</body>
</html>`,
		{
			status,
			headers: {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-store",
				"x-frame-options": "DENY",
				// No form-action: the consent form's answer redirects to the assistant.
				"content-security-policy":
					"default-src 'self'; frame-ancestors 'none'; base-uri 'none'",
				"referrer-policy": "no-referrer",
			},
		},
	);
}
