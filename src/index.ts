import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { currentUser, enterCode, signOut, startSignIn } from "./auth.ts";
import { apiCatalog, page, serverCard } from "./discovery.ts";
import { SCOPES, type Env, type Props } from "./env.ts";
import { createServer } from "./mcp.ts";
import { authorize, consent } from "./oauth.ts";
import { prune } from "./rate-limit.ts";
import { assistants, deleteAccount, disconnect, exportData, me, resetWalks, sync } from "./sync.ts";
import { problem, sameOrigin } from "./util.ts";

/**
 * One Worker for the site, the sync API and the MCP server.
 *
 * Static files in public/ never reach this code (wrangler.jsonc lists the
 * paths that do). Everything that does goes through the OAuth provider: it
 * answers /token, /register and the OAuth metadata, checks the bearer token
 * on /mcp, and hands every other request to the site's own routes.
 */

/** Behind the OAuth gate: every request carries a grant's props. */
const mcpHandler = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const props = (ctx as ExecutionContext & { props: Props }).props;
		// A fresh server per request: stateless, nothing kept between calls.
		return createMcpHandler(() => createServer(env, props))(request, env, ctx);
	},
};

/** The site's own routes. */
const site = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		const method = request.method;

		if (path === "/authorize") return authorize(request, env);
		if (path === "/oauth/consent") return consent(request, env);

		if (path.startsWith("/api/")) {
			// Anything that changes something must come from this site's pages.
			if (method !== "GET" && method !== "HEAD" && !sameOrigin(request, env)) return problem(403, "Forbidden");

			if (path === "/api/auth/start" && method === "POST") return startSignIn(request, env, ctx);
			if (path === "/api/auth/code" && method === "POST") return enterCode(request, env);
			if (path === "/api/auth/signout" && method === "POST") return signOut(request, env);

			const user = await currentUser(request, env);
			if (!user) return problem(401, "Not signed in");
			if (path === "/api/me" && method === "GET") return me(env, user);
			if (path === "/api/me" && method === "DELETE") return deleteAccount(env, user);
			if (path === "/api/sync" && method === "POST") return sync(request, env, user);
			if (path === "/api/walks" && method === "DELETE") return resetWalks(env, user);
			if (path === "/api/me/assistants" && method === "GET") return assistants(env, user);
			if (path === "/api/me/export" && method === "GET") return exportData(env, user);
			const grant = path.match(/^\/api\/me\/assistants\/([A-Za-z0-9_-]{1,100})$/);
			if (grant && method === "DELETE") return disconnect(env, user, grant[1]!);
			return problem(404, "Not found");
		}

		if (path === "/.well-known/mcp/server-card.json") return serverCard(env);
		if (path === "/.well-known/api-catalog") return apiCatalog(env);

		return (await page(request, env)) ?? env.ASSETS.fetch(request);
	},
};

let provider: OAuthProvider | undefined;
function oauth(env: Env): OAuthProvider {
	provider ??= new OAuthProvider({
		apiRoute: "/mcp",
		apiHandler: mcpHandler as never,
		defaultHandler: site as never,
		authorizeEndpoint: "/authorize",
		tokenEndpoint: "/token",
		clientRegistrationEndpoint: "/register",
		scopesSupported: [...SCOPES],
		resourceMetadata: { resource: `${env.SELF_URL}/mcp`, resource_name: "Walk" },
		// Listed in the resource metadata and the 401 challenge. Both, so a client that
		// asks for exactly these gets what it got by asking for nothing: read, and the
		// goal. The consent page still names each one.
		requiredScopes: [...SCOPES],
		// Access tokens last an hour; refresh tokens keep the connection for a
		// month of disuse. Disconnecting in Walk ends both.
		accessTokenTTL: 3600,
		refreshTokenTTL: 30 * 86_400,
	});
	return provider;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		// Registering asks nothing of the caller and writes to storage: rationed per address.
		if (url.pathname === "/register" && request.method === "POST" && env.REGISTER_LIMIT) {
			const { success } = await env.REGISTER_LIMIT.limit({ key: request.headers.get("cf-connecting-ip") ?? "unknown" });
			if (!success) {
				return Response.json(
					{ error: "temporarily_unavailable", error_description: "Too many registrations. Try again in a minute." },
					{ status: 429, headers: { "retry-after": "60" } },
				);
			}
		}
		// The MCP server's metadata lives at /.well-known/oauth-protected-resource/mcp
		// (RFC 9728). Clients that look at the bare address get the same document.
		if (url.pathname === "/.well-known/oauth-protected-resource") {
			url.pathname += "/mcp";
			return oauth(env).fetch(new Request(url, request), env, ctx);
		}
		return oauth(env).fetch(request, env, ctx);
	},

	async scheduled(_event: ScheduledController, env: Env): Promise<void> {
		await prune(env);
	},
} satisfies ExportedHandler<Env>;
