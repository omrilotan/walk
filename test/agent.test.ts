import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-ignore: plain browser module, no types
import { aliasLegacy, plainSurface } from "../public/app/agent.js";

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

const tools = [
	{ name: "get_status", description: "State.", inputSchema: { type: "object", properties: {} }, execute: async () => "own" },
	{ name: "set_goal", description: "Goal.", inputSchema: { type: "object" }, execute: async ({ km }: { km: number }) => ({ km }) },
];

test("lists the tools as plain data that survives JSON", () => {
	const { tools: list } = plainSurface({}, tools);
	assert.deepEqual(JSON.parse(JSON.stringify(list)), [
		{ name: "get_status", description: "State.", inputSchema: { type: "object", properties: {} } },
		{ name: "set_goal", description: "Goal.", inputSchema: { type: "object" } },
	]);
});

test("runs a tool through the browser's executeTool and answers with a string", async () => {
	const window = {}; // what makes the browser's own tool objects circular
	const calls: unknown[] = [];
	const context = {
		getTools: async () => tools.map(({ name }) => ({ name, window })),
		executeTool: async (tool: { name: string }, input: unknown) => {
			calls.push([tool.name, input]);
			return "from the browser";
		},
	};
	const surface = plainSurface(context, tools);
	assert.equal(await surface.run("get_status"), "from the browser");
	assert.deepEqual(calls, [["get_status", {}]]);
});

test("falls back to the tool itself, and names the tools when asked for an unknown one", async () => {
	const surface = plainSurface({}, tools);
	assert.equal(await surface.run("get_status"), "own");
	assert.equal(await surface.run("set_goal", { km: 5 }), '{"km":5}');
	assert.equal(await surface.run("fly"), "No tool named fly. Tools: get_status, set_goal.");
});
