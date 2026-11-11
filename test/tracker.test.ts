import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-ignore: plain browser module, no types
import { Tracker } from "../public/app/tracker.js";

const frame = (distance: number, seconds: number, steps: number, calories: number) => ({ distance, seconds, steps, calories });

/** Open a walk on the first frame and feed the rest, like handle() does. */
function walk(frames: ReturnType<typeof frame>[], state = "starting") {
	const tracker = new Tracker();
	tracker.start(0, { state, ...frames[0] });
	for (const f of frames) tracker.accumulate(f);
	return tracker.totals();
}

const round = (totals: Record<string, number>) => Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));

test("a fresh pad starts the walk at zero", () => {
	assert.deepEqual(walk([frame(0, 0, 0, 0), frame(0.1, 60, 120, 4)]), frame(0.1, 60, 120, 4));
});

test("the last walk's counters, shown before the pad resets them, don't count", () => {
	// Real frames from 2026-11-11: the pad showed the previous walk's
	// 4.303 km and 5076 s at start, then reset them once the belt ran.
	const totals = walk([
		frame(4.303, 5076, 0, 0),
		frame(4.303, 5076, 0, 0),
		frame(0, 0, 0, 0),
		frame(0, 2, 2, 0),
		frame(0.158, 196, 278, 13),
	]);
	assert.deepEqual(round(totals), frame(0.158, 196, 278, 13));
});

test("a pad that keeps counting from the last walk adds only the difference", () => {
	const totals = walk([frame(4.303, 5076, 7344, 356), frame(4.461, 5272, 7622, 369)]);
	assert.deepEqual(round(totals), frame(0.158, 196, 278, 13));
});

test("a walk that opens on a running belt counts what the pad shows", () => {
	// Real frames from 2026-11-11: Walk opened the walk 79 s into the belt run.
	const totals = walk([frame(0.06, 79, 111, 5), frame(0.333, 406, 583, 27)], "running");
	assert.deepEqual(totals, frame(0.333, 406, 583, 27));
});

test("a reset mid-walk is still banked", () => {
	const totals = walk([frame(0, 0, 0, 0), frame(1, 600, 1000, 50), frame(0, 0, 0, 0), frame(0.5, 300, 500, 25)]);
	assert.deepEqual(totals, frame(1.5, 900, 1500, 75));
});
