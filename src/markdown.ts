/**
 * Markdown for agents: the site's own pages, turned into Markdown when an
 * agent asks for it (`Accept: text/markdown`, or the page's `.md` address).
 *
 * The HTML in public/ stays the only copy of the text: this converts it on
 * the way out, so the Markdown can never drift from what people read. It is
 * made for those pages (well-formed, hand-written HTML), not for any HTML.
 */

/** Pages with a Markdown version, by path. The app is not one of them. */
export const PAGES: Record<string, string> = {
	"/": "/index.md",
	"/privacy/": "/privacy/index.md",
	"/terms/": "/terms/index.md",
};

/** The HTML page behind a `.md` address, if there is one. */
export function pageFor(markdownPath: string): string | undefined {
	return Object.keys(PAGES).find((page) => PAGES[page] === markdownPath);
}

/** Whether the request prefers Markdown: it names text/markdown with a nonzero weight. */
export function wantsMarkdown(accept: string | null): boolean {
	if (!accept) return false;
	return accept.split(",").some((part) => {
		const [type, ...params] = part.trim().toLowerCase().split(";");
		if (type?.trim() !== "text/markdown") return false;
		const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
		return !q || Number(q.slice(2)) > 0;
	});
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·" };

function decode(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
		if (name[0] === "#") {
			const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
		}
		return ENTITIES[name.toLowerCase()] ?? whole;
	});
}

function attribute(attrs: string, name: string): string | undefined {
	const match = attrs.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
	return match ? decode(match[1] ?? match[2] ?? "") : undefined;
}

/** Elements whose content is left out: code, styling and pictures of text. */
const SKIP = new Set(["script", "style", "svg", "noscript", "template", "head"]);
/** Elements that never have a closing tag. */
const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "source", "wbr"]);
const BLOCK = new Set([
	"p",
	"div",
	"section",
	"article",
	"figure",
	"figcaption",
	"details",
	"footer",
	"header",
	"main",
	"nav",
	"aside",
	"blockquote",
]);

interface Frame {
	tag: string;
	/** Text gathered inside an inline wrapper (link, bold, code) or a table cell. */
	buffer?: string;
	href?: string;
}

/**
 * Converts one page to Markdown: front matter from the title, description and
 * canonical address, then the content of <main>.
 */
export function htmlToMarkdown(html: string, origin: string): string {
	const title = decode(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
	const description = attribute(html.match(/<meta\s+name="description"[^>]*>/i)?.[0] ?? "", "content")?.trim();
	const canonical = attribute(html.match(/<link\s+rel="canonical"[^>]*>/i)?.[0] ?? "", "href");

	const start = html.search(/<main[\s>]/i);
	const end = html.lastIndexOf("</main>");
	const body = start >= 0 && end > start ? html.slice(start, end + 7) : html;

	const absolute = (href: string) => {
		try {
			return new URL(href, origin + "/").href;
		} catch {
			return href;
		}
	};

	let out = "";
	const stack: Frame[] = [];
	const lists: { ordered: boolean; count: number }[] = [];
	let skipping = 0;
	let table: string[][] | null = null;
	let headRows = 0;
	/** Set after bold text or a span closes: a word right after it needs a space. */
	let spaceNext = false;

	/** Where text goes now: the innermost buffer, or the page. */
	const write = (text: string) => {
		for (let i = stack.length - 1; i >= 0; i--) {
			const frame = stack[i]!;
			if (frame.buffer !== undefined) {
				frame.buffer += text;
				return;
			}
		}
		out += text;
	};
	const block = () => write("\n\n");

	const tokens = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>|([^<]+)/g;
	for (const match of body.matchAll(tokens)) {
		const [, closing, rawTag, attrs = "", selfClosing, text] = match;
		if (text !== undefined) {
			if (skipping) continue;
			const clean = decode(text).replace(/\s+/g, " ");
			write(spaceNext && /^[\p{L}\p{N}]/u.test(clean) ? ` ${clean}` : clean);
			spaceNext = false;
			continue;
		}
		if (!rawTag) continue; // A comment.
		const tag = rawTag.toLowerCase();
		if (tag !== "span" || closing) spaceNext = false;

		if (!closing) {
			// A copy button: what it copies is the useful part (the full address).
			const copies = tag === "button" ? attribute(attrs, "data-copy") : undefined;
			if (copies && !skipping) write(` \`${copies}\``);
			const hidden = copies !== undefined || /\saria-hidden\s*=\s*"true"/i.test(attrs);
			if (skipping || SKIP.has(tag) || hidden) {
				if (!VOID.has(tag) && !selfClosing) {
					skipping++;
					stack.push({ tag: `skip:${tag}` });
				}
				continue;
			}
			if (VOID.has(tag) || selfClosing) {
				if (tag === "br") write("  \n");
				if (tag === "hr") write("\n\n---\n\n");
				if (tag === "img") {
					const alt = attribute(attrs, "alt") ?? "";
					const src = attribute(attrs, "src");
					if (src) write(`![${alt.replace(/[[\]]/g, "")}](${absolute(src)})`);
				}
				continue;
			}
			const frame: Frame = { tag };
			if (/^h[1-6]$/.test(tag)) {
				block();
				write("#".repeat(Number(tag[1])) + " ");
			} else if (tag === "summary") {
				block();
				write("### ");
			} else if (BLOCK.has(tag)) {
				block();
				if (tag === "blockquote") write("> ");
			} else if (tag === "ul" || tag === "ol") {
				if (!lists.length) block();
				lists.push({ ordered: tag === "ol", count: 0 });
			} else if (tag === "li") {
				const list = lists[lists.length - 1];
				const indent = "   ".repeat(Math.max(lists.length - 1, 0));
				if (list) list.count++;
				write(`\n${indent}${list?.ordered ? `${list.count}.` : "-"} `);
			} else if (tag === "span") {
				// Labels and captions set side by side: keep them apart.
				write(" ");
			} else if (tag === "a") {
				frame.buffer = "";
				frame.href = attribute(attrs, "href");
			} else if (["b", "strong", "em", "i", "code", "kbd"].includes(tag)) {
				frame.buffer = "";
			} else if (tag === "table") {
				block();
				table = [];
				headRows = 0;
			} else if (tag === "tr" && table) {
				table.push([]);
			} else if ((tag === "td" || tag === "th") && table) {
				frame.buffer = "";
			}
			stack.push(frame);
			continue;
		}

		// A closing tag: unwind to its opening.
		const at = stack.map((f) => f.tag.replace(/^skip:/, "")).lastIndexOf(tag);
		if (at < 0) continue;
		while (stack.length > at + 1) stack.pop();
		const frame = stack.pop()!;
		if (frame.tag.startsWith("skip:")) {
			skipping--;
			continue;
		}
		const inner = (frame.buffer ?? "").replace(/\s+/g, " ").trim();
		if (tag === "a") {
			if (inner) write(frame.href ? `[${inner}](${absolute(frame.href)})` : inner);
		} else if (tag === "span") {
			spaceNext = true;
		} else if (tag === "b" || tag === "strong") {
			if (inner) write(`**${inner}**`);
			spaceNext = true;
		} else if (tag === "em" || tag === "i") {
			if (inner) write(`*${inner}*`);
		} else if (tag === "code" || tag === "kbd") {
			// Keys side by side (↑ ↓) stay two pieces of code, not one broken one.
			if (inner) write(` \`${inner}\``);
		} else if ((tag === "td" || tag === "th") && table) {
			table[table.length - 1]?.push(inner.replace(/\|/g, "\\|"));
		} else if (tag === "thead" && table) {
			headRows = table.length;
		} else if (tag === "table" && table) {
			const rows = table.filter((row) => row.length);
			const width = Math.max(...rows.map((row) => row.length));
			const line = (row: string[]) => `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;
			const head = rows.slice(0, Math.max(headRows, 1));
			write(
				[...head.map(line), line(Array(width).fill("---")), ...rows.slice(head.length).map(line)].join("\n"),
			);
			block();
			table = null;
		} else if (tag === "ul" || tag === "ol") {
			lists.pop();
			if (!lists.length) block();
		} else if (/^h[1-6]$/.test(tag) || tag === "summary" || BLOCK.has(tag)) {
			block();
		}
	}

	const content = out
		.split("\n")
		.map((line) => line.replace(/[ \t]+$/, "").replace(/^ +(?=\S)(?![-0-9])/, ""))
		.join("\n")
		.replace(/(\S) {2,}(?=\S)/g, "$1 ")
		.replace(/^(#+ |- |\d+\. |> )\s+/gm, "$1")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

	const front = [
		"---",
		title && `title: ${JSON.stringify(title)}`,
		description && `description: ${JSON.stringify(description)}`,
		canonical && `url: ${canonical}`,
		"---",
	].filter(Boolean);
	return `${front.join("\n")}\n\n${content}\n`;
}
