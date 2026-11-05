import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-ignore: plain browser module, no types
import { planImport } from "../public/app/db.js";

const totals = { distance: 1, seconds: 600, steps: 1000, calories: 50 };
const walk = (uid: string | undefined, start: number, updated: number) => ({ uid, start, updated, totals });
const uids = (walks: { session: { uid: string } }[]) => walks.map((w) => w.session.uid);

test("planImport sorts the file's walks into new, newer and already here", () => {
	const local = [
		{ id: 1, ...walk("a", 100, 10) },
		{ id: 2, ...walk("b", 200, 20) },
		{ id: 3, ...walk("c", 300, 30) },
	];
	const plan = planImport(
		{ sessions: [walk("a", 100, 10), walk("b", 200, 25), walk("c", 300, 5), walk("d", 400, 40)] },
		local,
	);
	assert.deepEqual(uids(plan.add), ["d"]);
	assert.deepEqual(uids(plan.update), ["b"]);
	assert.equal(plan.update[0].existing.id, 2);
	assert.deepEqual(uids(plan.keep), ["a", "c"]);
	assert.equal(plan.invalid, 0);
});

test("planImport matches walks without a uid by start time", () => {
	const plan = planImport({ sessions: [walk(undefined, 100, 50)] }, [{ id: 1, ...walk("a", 100, 10) }]);
	assert.equal(plan.update.length, 1);
	assert.equal(plan.update[0].existing.id, 1);
});

test("planImport counts a walk the file repeats once, newest copy", () => {
	const plan = planImport({ sessions: [walk("a", 100, 10), walk("a", 100, 30), walk("a", 100, 20)] }, []);
	assert.equal(plan.add.length, 1);
	assert.equal(plan.add[0].session.updated, 30);
});

test("planImport skips entries that aren't walks, and rejects files that aren't backups", () => {
	const plan = planImport({ sessions: [null, 5, { start: "x" }, { start: 1 }, walk("a", 100, 1)] }, []);
	assert.equal(plan.invalid, 4);
	assert.equal(plan.add.length, 1);
	assert.throws(() => planImport({}, []), /Not a Walk export file/);
	assert.throws(() => planImport(null, []), /Not a Walk export file/);
});

test("planImport drops local-only fields and keeps the samples", () => {
	const plan = planImport({ sessions: [{ ...walk("a", 100, 1), id: 9, dirty: 1, samples: [{ t: 1 }] }] }, []);
	assert.equal(plan.add[0].session.id, undefined);
	assert.equal(plan.add[0].session.dirty, undefined);
	assert.deepEqual(plan.add[0].samples, [{ t: 1 }]);
});
