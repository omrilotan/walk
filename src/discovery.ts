import { z } from "zod";
import type { Env } from "./env.ts";
import { htmlToMarkdown, PAGES, pageFor, wantsMarkdown } from "./markdown.ts";
import { INSTRUCTIONS, SERVER, TOOLS } from "./mcp.ts";

/**
 * How agents find their way around Walk without reading the page:
 * - each public page in Markdown (Accept: text/markdown, or its .md address),
 * - Link headers on those pages,
 * - the MCP server card and the API catalog under /.well-known/.
 *
 * Everything here is built from what already exists (the HTML pages, the MCP
 * tool definitions), so there is no second copy to keep in sync.
 */

const MCP_PROTOCOL = "2025-11-25";

/** Where an agent finds the rest. Sent on every public page. */
function links(page: string): string {
	return [
		`<${PAGES[page]}>; rel="alternate"; type="text/markdown"`,
		`</.well-known/api-catalog>; rel="api-catalog"`,
		`</llms.txt>; rel="describedby"; type="text/plain"`,
	].join(", ");
}

/** A public page: Markdown when asked for, HTML otherwise. Null if `path` isn't one. */
export async function page(request: Request, env: Env): Promise<Response | null> {
	const url = new URL(request.url);
	const asMarkdown = pageFor(url.pathname);
	const path = asMarkdown ?? (url.pathname in PAGES ? url.pathname : null);
	if (!path) return null;
	if (request.method !== "GET" && request.method !== "HEAD") return null;

	if (!asMarkdown && !wantsMarkdown(request.headers.get("accept"))) {
		const html = await env.ASSETS.fetch(request);
		const response = new Response(html.body, html);
		response.headers.append("vary", "accept");
		if (html.ok) response.headers.set("link", links(path));
		return response;
	}

	const html = await env.ASSETS.fetch(new Request(new URL(path, url), { headers: { accept: "text/html" } }));
	if (!html.ok) return html;
	const markdown = htmlToMarkdown(await html.text(), url.origin);
	return new Response(request.method === "HEAD" ? null : markdown, {
		headers: {
			"content-type": "text/markdown; charset=utf-8",
			// A rough count (about four characters a token), for agents budgeting context.
			"x-markdown-tokens": String(Math.ceil(markdown.length / 4)),
			"cache-control": "public, max-age=300",
			vary: "accept",
			link: links(path),
			"x-content-type-options": "nosniff",
			"access-control-allow-origin": "*",
		},
	});
}

const json = (value: unknown, type = "application/json") =>
	new Response(JSON.stringify(value, null, 2), {
		headers: {
			"content-type": type,
			"cache-control": "public, max-age=3600",
			"access-control-allow-origin": "*",
			"x-content-type-options": "nosniff",
		},
	});

/** The MCP server card: what the server at /mcp is and does, before connecting. */
export function serverCard(env: Env): Response {
	return json({
		version: "1.0",
		protocolVersion: MCP_PROTOCOL,
		serverInfo: { ...SERVER },
		description:
			"Read your walking pad walks from Walk, synced from your browser: daily totals, goal progress, streaks, records and individual walks. Optionally set your daily goal.",
		instructions: INSTRUCTIONS,
		iconUrl: `${env.SELF_URL}/icon.svg`,
		websiteUrl: env.SELF_URL,
		documentationUrl: `${env.SELF_URL}/#ai`,
		transport: { type: "streamable-http", endpoint: `${env.SELF_URL}/mcp` },
		authentication: {
			required: true,
			schemes: ["oauth2"],
			// The user signs in to Walk and approves; turning on cloud sync in Walk comes first.
			protectedResourceMetadata: `${env.SELF_URL}/.well-known/oauth-protected-resource/mcp`,
		},
		capabilities: { tools: {} },
		tools: Object.entries(TOOLS).map(([name, tool]) => ({
			name,
			title: tool.title,
			description: tool.description,
			inputSchema: z.toJSONSchema(tool.inputSchema, { io: "input" }),
			annotations: tool.annotations,
			...("scope" in tool ? { requiredScope: tool.scope } : {}),
		})),
	});
}

/** The API catalog (RFC 9727): Walk's one API for agents is the MCP server. */
export function apiCatalog(env: Env): Response {
	return json(
		{
			linkset: [
				{
					anchor: `${env.SELF_URL}/mcp`,
					"service-desc": [{ href: `${env.SELF_URL}/.well-known/mcp/server-card.json`, type: "application/json" }],
					"service-doc": [
						{ href: `${env.SELF_URL}/#ai`, type: "text/html" },
						{ href: `${env.SELF_URL}/index.md`, type: "text/markdown" },
					],
					"service-meta": [
						{ href: `${env.SELF_URL}/.well-known/oauth-protected-resource/mcp`, type: "application/json" },
					],
				},
			],
		},
		'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
	);
}
