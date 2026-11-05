import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-ignore: plain browser module, no types
import { crossed, describe, normalize, progress } from "../public/app/timer.js";

test("normalize keeps what's valid and fixes the rest", () => {
	assert.deepEqual(normalize({}), { kind: "off", minutes: 30, km: 2, end: "chime" });
	assert.deepEqual(normalize({ kind: "time", minutes: 42, end: "pause" }), { kind: "time", minutes: 42, km: 2, end: "pause" });
	assert.equal(normalize({ kind: "nap" }).kind, "off");
	assert.equal(normalize({ kind: "time", minutes: -3 }).minutes, 30);
	assert.equal(normalize({ kind: "time", minutes: 0.2 }).minutes, 1);
	assert.equal(normalize({ kind: "distance", km: 1.234 }).km, 1.23);
	assert.equal(normalize({ end: "explode" }).end, "chime");
});

test("progress counts the walk's own time or distance", () => {
	const time = normalize({ kind: "time", minutes: 30 });
	assert.equal(progress(time, { seconds: 900, distance: 1 }), 0.5);
	assert.equal(progress(time, { seconds: 4000, distance: 1 }), 1);
	const distance = normalize({ kind: "distance", km: 2 });
	assert.equal(progress(distance, { seconds: 900, distance: 1 }), 0.5);
	assert.equal(progress(normalize({}), { seconds: 900, distance: 1 }), null);
});

test("fires once, on the update that reaches the target", () => {
	const timer = normalize({ kind: "time", minutes: 30 });
	assert.equal(crossed(timer, 1799, 1800), true);
	assert.equal(crossed(timer, 1800, 1801), false, "already past");
	assert.equal(crossed(timer, 100, 101), false, "not yet");
	assert.equal(crossed(timer, null, 1800), false, "first look, e.g. after a reload");
	assert.equal(crossed(normalize({}), 1799, 1800), false, "off");
});

test("describe", () => {
	assert.equal(describe(normalize({ kind: "time", minutes: 45 })), "45 min");
	assert.equal(describe(normalize({ kind: "distance", km: 2.5 })), "2.5 km");
	assert.equal(describe(normalize({})), "Off");
});
