import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-ignore: plain browser module, no types
import { aliasLegacy } from "../public/app/agent.js";

test("points the old WebMCP name at the same context", () => {
	const context = { registerTool() {} };
	const nav: { modelContext?: unknown } = {};
	assert.equal(aliasLegacy(context, nav), true);
	assert.equal(nav.modelContext, context);
});

test("leaves a browser's own navigator.modelContext alone", () => {
	const own = {};
	const nav = { modelContext: own };
	assert.equal(aliasLegacy({}, nav), false);
	assert.equal(nav.modelContext, own);
});

test("does nothing without a context, or where navigator can't be extended", () => {
	const nav: { modelContext?: unknown } = {};
	assert.equal(aliasLegacy(null, nav), false);
	assert.equal("modelContext" in nav, false);
	assert.equal(aliasLegacy({}, Object.freeze({})), false);
});
