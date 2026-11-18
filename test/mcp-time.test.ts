import assert from "node:assert/strict";
import { test } from "node:test";
import { fromLocal, local, wallClock } from "../src/time.ts";

const text = (t: number) => new Date(wallClock(t, "UTC")).toISOString().slice(0, 16).replace("T", " ");

test("fromLocal and wallClock round-trip", () => {
	for (const [zone, when] of [
		["UTC", "2026-11-04 08:30"],
		["Europe/London", "2026-01-15 07:45"],
		["Europe/London", "2026-07-15 07:45"],
		["America/New_York", "2026-11-04 23:10"],
		["America/New_York", "2026-07-04 00:05"],
	] as const) {
		const t = fromLocal(when, zone);
		assert.notEqual(t, null, `${zone} ${when}`);
		assert.equal(local(t!, zone), when);
		assert.equal(wallClock(t!, zone), Date.UTC(+when.slice(0, 4), +when.slice(5, 7) - 1, +when.slice(8, 10), +when.slice(11, 13), +when.slice(14, 16)));
	}
});

test("fromLocal knows the zone's offset", () => {
	assert.equal(fromLocal("2026-07-15 08:00", "Europe/London"), Date.UTC(2026, 6, 15, 7, 0));
	assert.equal(fromLocal("2026-01-15 08:00", "Europe/London"), Date.UTC(2026, 0, 15, 8, 0));
	assert.equal(fromLocal("2026-01-15T08:00:30", "America/New_York"), Date.UTC(2026, 0, 15, 13, 0, 30));
});

test("fromLocal handles the days clocks change", () => {
	// London springs forward on 2026-03-29 at 01:00 UTC: 01:30 never happens.
	assert.equal(fromLocal("2026-03-29 01:30", "Europe/London"), null);
	assert.equal(fromLocal("2026-03-29 02:30", "Europe/London"), Date.UTC(2026, 2, 29, 1, 30));
	assert.equal(fromLocal("2026-03-29 00:30", "Europe/London"), Date.UTC(2026, 2, 29, 0, 30));
});

test("fromLocal rejects what is not a time", () => {
	for (const bad of ["2026-13-40 10:00", "tomorrow", "2026-02-30 10:00", "2026-11-04 24:00", "2026-11-04", "2026-11-04 10:60", ""]) {
		assert.equal(fromLocal(bad, "UTC"), null, bad);
	}
	assert.equal(fromLocal("2026-11-04 10:00", "Not/AZone"), null);
	assert.equal(text(0), "1970-01-01 00:00");
});
