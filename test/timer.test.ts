import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-ignore: plain browser module, no types
import { crossed, describe, describeTarget, left, normalize, progress, stepped, target } from "../public/app/timer.js";

test("normalize keeps what's valid and fixes the rest", () => {
	assert.deepEqual(normalize({}), { kind: "off", minutes: 30, km: 2, from: "now", end: "chime" });
	assert.deepEqual(normalize({ kind: "time", minutes: 42, from: "start", end: "pause" }), {
		kind: "time",
		minutes: 42,
		km: 2,
		from: "start",
		end: "pause",
	});
	assert.equal(normalize({ from: "yesterday" }).from, "now");
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

// 3.4 km and 20 minutes into a walk when the timer is set.
const base = { seconds: 1200, distance: 3.4 };

test("from now: the amount is counted from when the timer was set", () => {
	const timer = normalize({ kind: "distance", km: 0.5, from: "now" });
	assert.equal(target(timer, base), 3.9);
	assert.equal(left(timer, { seconds: 1260, distance: 3.5 }, base).toFixed(2), "0.40");
	assert.equal(progress(timer, { seconds: 1260, distance: 3.65 }, base).toFixed(2), "0.50");
	assert.equal(crossed(timer, 3.49, 3.5, base), false, "half a km is not walked yet");
	assert.equal(crossed(timer, 3.89, 3.9, base), true);
	assert.equal(describeTarget(timer, base), "3.9 km");

	const time = normalize({ kind: "time", minutes: 10, from: "now" });
	assert.equal(target(time, base), 1800);
	assert.equal(crossed(time, 1799, 1800, base), true);
	assert.equal(describeTarget(time, base), "30 min");
	assert.equal(describeTarget(time, { seconds: 1230, distance: 3.4 }), "30:30");
});

test("from now, with no walk under way, counts from the walk's start", () => {
	const timer = normalize({ kind: "time", minutes: 10, from: "now" });
	assert.equal(target(timer, null), 600);
	assert.equal(crossed(timer, 599, 600, null), true);
});

test("in total: the amount is the walk as a whole", () => {
	const timer = normalize({ kind: "distance", km: 3.5, from: "start" });
	assert.equal(target(timer, base), 3.5, "what was walked before it was set counts");
	assert.equal(left(timer, { seconds: 1200, distance: 3.4 }, base).toFixed(2), "0.10");
	assert.equal(crossed(timer, 3.49, 3.5, base), true);
	assert.equal(progress(timer, { seconds: 1200, distance: 1.75 }, base), 0.5);
	assert.equal(describeTarget(timer, base), "3.5 km");
});

test("in total: a total the walk has already passed does not fire", () => {
	const timer = normalize({ kind: "distance", km: 3, from: "start" });
	assert.equal(crossed(timer, 3.4, 3.41, base), false);
	assert.equal(left(timer, { seconds: 1200, distance: 3.4 }, base), 0);
	assert.equal(progress(timer, { seconds: 1200, distance: 3.4 }, base), 1);
});

test("the − and + buttons snap to the step", () => {
	const time = normalize({ kind: "time", minutes: 32 });
	assert.equal(stepped(time, 1), 35);
	assert.equal(stepped(time, -1), 30);
	assert.equal(stepped(normalize({ kind: "distance", km: 2 }), 1), 2.5);
});

test("in total, + skips ahead of what's already walked", () => {
	const walked = { seconds: 1200, distance: 3.4 };
	assert.equal(stepped(normalize({ kind: "distance", km: 2, from: "start" }), 1, walked), 3.5);
	assert.equal(stepped(normalize({ kind: "time", minutes: 5, from: "start" }), 1, walked), 25);
	assert.equal(stepped(normalize({ kind: "distance", km: 5, from: "start" }), 1, walked), 5.5, "already ahead");
	assert.equal(stepped(normalize({ kind: "distance", km: 2, from: "now" }), 1, walked), 2.5, "from now counts no walked km");
	assert.equal(stepped(normalize({ kind: "distance", km: 2, from: "start" }), 1, null), 2.5, "not walking");
});
