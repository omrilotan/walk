import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-ignore: plain browser module, no types
import { changedWalk, manualWalk, numbersOf, problemWith, rates, trashDaysLeft, trashExpired, TRASH_DAYS } from "../public/app/walks.js";
// @ts-ignore: plain browser module, no types
import { summarize } from "../public/app/stats.js";
// @ts-ignore: plain browser module, no types
import { numbers, startOf } from "../public/app/agent.js";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);
const HOUR_AGO = NOW - 3_600_000;
const good = { start: HOUR_AGO, seconds: 1800, distance: 1.5 };

test("accepts an ordinary walk", () => {
	assert.equal(problemWith(good, NOW), null);
	assert.equal(problemWith({ ...good, steps: 2500, calories: 120, maxSpeed: 4 }, NOW), null);
});

test("says what is wrong with a walk's numbers", () => {
	const wrong = (changes: object) => problemWith({ ...good, ...changes }, NOW);
	assert.match(wrong({ start: NaN }), /day and time/);
	assert.match(wrong({ start: 0 }), /day and time/);
	assert.match(wrong({ start: NOW + 1000 }), /future/);
	assert.match(wrong({ seconds: 0 }), /how long/);
	assert.match(wrong({ seconds: 25 * 3600 }), /24 hours/);
	assert.match(wrong({ start: NOW - 60_000, seconds: 1800 }), /end in the future/);
	assert.match(wrong({ distance: 0 }), /distance/);
	assert.match(wrong({ distance: 101, seconds: 86_400, start: NOW - 2 * DAY }), /100 km/);
	// 1.5 km in a minute is a typo, not a walk.
	assert.match(wrong({ seconds: 60 }), /90 km\/h/);
	assert.match(wrong({ steps: -1 }), /Steps/);
	assert.match(wrong({ calories: 1e9 }), /Calories/);
	assert.match(problemWith(undefined, NOW), /day and time/);
});

const recorded = [
	{ start: 1, totals: { distance: 2, seconds: 2400, steps: 3400, calories: 160 } },
	{ start: 2, totals: { distance: 1, seconds: 1200, steps: 1700, calories: 80 } },
];

test("learns steps and calories per km from the walks the pad recorded", () => {
	assert.deepEqual(rates(recorded), { stepsPerKm: 1700, caloriesPerKm: 80 });
	// A walk typed in by hand teaches nothing: its numbers may be estimates themselves.
	const typed = { start: 3, origin: "manual", totals: { distance: 10, seconds: 600, steps: 1, calories: 1 } };
	assert.deepEqual(rates([...recorded, typed]), { stepsPerKm: 1700, caloriesPerKm: 80 });
	assert.equal(rates([typed]), null);
	assert.equal(rates([]), null);
	// With no walk left as recorded, a corrected one still has the pad's steps.
	const corrected = { start: 4, origin: "edited", totals: { distance: 2, seconds: 1200, steps: 3000, calories: 100 } };
	assert.deepEqual(rates([typed, corrected]), { stepsPerKm: 1500, caloriesPerKm: 50 });
	assert.deepEqual(rates([...recorded, corrected]), { stepsPerKm: 1700, caloriesPerKm: 80 });
});

test("builds a walk added by hand, estimating what was left out", () => {
	const walk = manualWalk(good, { now: NOW, per: rates(recorded), uid: "u-1" });
	assert.deepEqual(walk, {
		uid: "u-1",
		start: HOUR_AGO,
		end: HOUR_AGO + 1800_000,
		updated: NOW,
		maxSpeed: 3,
		totals: { distance: 1.5, seconds: 1800, steps: 2550, calories: 120 },
		origin: "manual",
	});
	assert.equal(problemWith(numbersOf(walk), NOW), null);
});

test("keeps the numbers it was given, and marks an assistant's walk", () => {
	const walk = manualWalk({ ...good, steps: 10, calories: 0, maxSpeed: 5.5 }, { now: NOW, per: rates(recorded), agent: true, uid: "u-2" });
	assert.deepEqual(walk.totals, { distance: 1.5, seconds: 1800, steps: 10, calories: 0 });
	assert.equal(walk.maxSpeed, 5.5);
	assert.equal(walk.agent, true);
	// With no recorded walks to learn from, what was left out is zero.
	assert.deepEqual(manualWalk(good, { now: NOW, uid: "u-3" }).totals, { distance: 1.5, seconds: 1800, steps: 0, calories: 0 });
});

const padWalk = {
	id: 7,
	uid: "p-1",
	start: HOUR_AGO,
	// Ten minutes of pauses on top of the walking time.
	end: HOUR_AGO + 2400_000,
	updated: NOW - 1000,
	maxSpeed: 3.5,
	base: { distance: 0 },
	totals: { distance: 0.064, seconds: 83, steps: 114, calories: 5 },
};

test("corrects a recorded walk and keeps everything else about it", () => {
	const walk = changedWalk(padWalk, { distance: 0.65, seconds: 784 }, { now: NOW });
	assert.equal(walk.id, 7);
	assert.equal(walk.uid, "p-1");
	assert.deepEqual(walk.base, { distance: 0 });
	assert.deepEqual(walk.totals, { distance: 0.65, seconds: 784, steps: 114, calories: 5 });
	assert.equal(walk.origin, "edited");
	assert.equal(walk.agent, undefined);
	assert.equal(walk.updated, NOW);
	// The pauses stay: the walk still ends when it ended.
	assert.equal(walk.end, padWalk.end);
	assert.equal(walk.maxSpeed, 3.5);
	// The walk it was made from is untouched.
	assert.equal(padWalk.totals.distance, 0.064);
});

test("moves the end with the start, and stretches it for a longer walk", () => {
	const moved = changedWalk(padWalk, { start: padWalk.start - 600_000 }, { now: NOW });
	assert.equal(moved.end, padWalk.end - 600_000);
	const longer = changedWalk(padWalk, { seconds: 3000 }, { now: NOW });
	assert.equal(longer.end, padWalk.start + 3000_000);
});

test("a typed-in walk stays manual, and an assistant's mark follows the last change", () => {
	const typed = manualWalk(good, { now: NOW - 10, uid: "m-1", agent: true });
	const byHand = changedWalk(typed, { distance: 2 }, { now: NOW });
	assert.equal(byHand.origin, "manual");
	assert.equal(byHand.agent, undefined);
	// No pauses in a typed walk: a shorter time ends it sooner.
	assert.equal(changedWalk(typed, { seconds: 600 }, { now: NOW }).end, typed.start + 600_000);
	assert.equal(changedWalk(padWalk, { steps: 200 }, { now: NOW, agent: true }).agent, true);
	// Top speed is never below the average the new numbers give.
	assert.equal(changedWalk(typed, { distance: 3 }, { now: NOW }).maxSpeed, 6);
});

test("a change is always newer than the copy it replaces", () => {
	const ahead = { ...padWalk, updated: NOW + 5000 };
	assert.equal(changedWalk(ahead, { steps: 1 }, { now: NOW }).updated, NOW + 5001);
});

test("personal records count only walks as the pad recorded them", () => {
	const at = (start: number, distance: number, extra = {}) => ({ start, end: start + 1, totals: { distance, seconds: 1200, steps: 0, calories: 0 }, ...extra });
	const sessions = [at(NOW - 3 * DAY, 2), at(NOW - 2 * DAY, 9, { origin: "manual" }), at(NOW - DAY, 8, { origin: "edited" })];
	const s = summarize(sessions, NOW);
	assert.equal(s.records.longest.totals.distance, 2);
	assert.equal(s.records.fastest.totals.distance, 2);
	// Totals count every walk.
	assert.equal(s.lifetime.distance, 19);
	assert.equal(s.lifetime.walks, 3);
});

test("a deleted walk waits thirty days", () => {
	assert.equal(TRASH_DAYS, 30);
	const deleted = { deleted: NOW - 29 * DAY - 1000 };
	assert.equal(trashExpired(deleted, NOW), false);
	assert.equal(trashDaysLeft(deleted, NOW), 1);
	assert.equal(trashExpired({ deleted: NOW - 30 * DAY }, NOW), true);
	assert.equal(trashDaysLeft({ deleted: NOW - 31 * DAY }, NOW), 0);
	assert.equal(trashDaysLeft({ deleted: NOW }, NOW), 30);
	assert.equal(trashExpired({}, NOW), false);
});

test("reads an agent's start time as the user's local time", () => {
	assert.equal(startOf("2026-11-18T09:41"), new Date(2026, 10, 18, 9, 41).getTime());
	assert.equal(startOf("2026-11-18 09:41"), new Date(2026, 10, 18, 9, 41).getTime());
	for (const junk of ["yesterday", "", "09:41", "2026-13-45T99:99", undefined, 1794994886528]) assert.equal(startOf(junk), null);
});

test("turns an agent's numbers into the app's, leaving out what it left out", () => {
	assert.deepEqual(numbers({ minutes: 13.07, distanceKm: 0.65 }), { seconds: 784, distance: 0.65 });
	assert.deepEqual(numbers({ steps: 0 }), { steps: 0 });
	assert.deepEqual(numbers({}), {});
	assert.deepEqual(numbers(), {});
});
