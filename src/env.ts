import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
	/** The static site in public/. */
	ASSETS: Fetcher;
	DB: D1Database;
	/** OAuth clients, grants and tokens for assistants (workers-oauth-provider). */
	OAUTH_KV: KVNamespace;
	/** Injected by the OAuth provider on every request it hands on. */
	OAUTH_PROVIDER: OAuthHelpers;
	/** Cloudflare Email Sending. Absent locally: links are logged instead. */
	EMAIL?: SendEmail;
	/** Dynamic client registrations allowed per caller address. */
	REGISTER_LIMIT?: RateLimit;
	/** This site's public origin, e.g. https://walk.omrilotan.com. */
	SELF_URL: string;
	FROM_ADDRESS: string;
	FROM_NAME: string;
	/** "true" only in local development (.dev.vars): sign-in links are returned, not emailed. */
	DEV_AUTH?: string;
}

/** What an assistant may do. Reading is always granted; changing the goal is asked separately. */
export const SCOPES = ["read", "goal"] as const;
export type Scope = (typeof SCOPES)[number];

/** What a grant carries into every MCP request. Encrypted at rest by the provider. */
export interface Props extends Record<string, unknown> {
	userId: string;
	scopes: Scope[];
	clientName: string;
}

export interface User {
	id: string;
	email: string;
	sessionId: string;
}
