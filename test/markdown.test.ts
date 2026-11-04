import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { htmlToMarkdown, wantsMarkdown } from "../src/markdown.ts";

const origin = "https://walk.omrilotan.com";

test("Accept header: Markdown only when named with a nonzero weight", () => {
	assert.equal(wantsMarkdown("text/markdown"), true);
	assert.equal(wantsMarkdown("text/markdown, text/html;q=0.9"), true);
	assert.equal(wantsMarkdown("text/html, text/markdown;q=0.5"), true);
	assert.equal(wantsMarkdown("text/markdown;q=0, text/html"), false);
	assert.equal(wantsMarkdown("text/html,*/*"), false);
	assert.equal(wantsMarkdown(null), false);
});

test("front matter, headings, lists, links and inline code", () => {
	const md = htmlToMarkdown(
		`<html><head><title>T &amp; U</title><meta name="description" content="D" /><link rel="canonical" href="${origin}/x/" /></head>
		<body><header>skip me</header><main>
			<h1>Hello <span class="accent">there</span></h1>
			<p>Press <kbd>↑</kbd><kbd>↓</kbd> or <a href="/app/">open <b>Walk</b></a>.</p>
			<ol class="steps"><li><span>One</span></li><li><span>Two <i class="ph ph-x"></i></span></li></ol>
			<ul><li><b>Bold</b>Text after</li></ul>
			<span aria-hidden="true">hidden</span>
			<button class="copy-chip" data-copy="${origin}/mcp"><code>walk.omrilotan.com/mcp</code></button>
			<script>no()</script>
		</main></body></html>`,
		origin,
	);
	assert.match(md, /^---\ntitle: "T & U"\ndescription: "D"\nurl: https:\/\/walk\.omrilotan\.com\/x\/\n---\n/);
	assert.match(md, /^# Hello there$/m);
	assert.match(md, /Press `↑` `↓` or \[open \*\*Walk\*\*\]\(https:\/\/walk\.omrilotan\.com\/app\/\)\./);
	assert.match(md, /^1\. One\n2\. Two$/m);
	assert.match(md, /^- \*\*Bold\*\* Text after$/m);
	assert.match(md, /`https:\/\/walk\.omrilotan\.com\/mcp`/);
	assert.doesNotMatch(md, /skip me|hidden|no\(\)|walk\.omrilotan\.com\/mcp`<|ph-x/);
});

test("tables keep their header row", () => {
	const md = htmlToMarkdown(
		`<main><table><thead><tr><th>What</th><th>Why</th></tr></thead><tbody><tr><td>Email</td><td>A | B</td></tr></tbody></table></main>`,
		origin,
	);
	assert.match(md, /\| What \| Why \|\n\| --- \| --- \|\n\| Email \| A \\\| B \|/);
});

test("every public page converts with its title and no leftover tags", () => {
	for (const file of ["public/index.html", "public/privacy/index.html", "public/terms/index.html"]) {
		const md = htmlToMarkdown(readFileSync(file, "utf8"), origin);
		assert.match(md, /^---\ntitle: ".+"/, file);
		assert.match(md, /^# .+/m, file);
		assert.doesNotMatch(md, /<\/?[a-z][^>]*>/i, file);
	}
});
