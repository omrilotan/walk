// Turns the pad's status stream into walks stored in IndexedDB.
//
// A walk starts when the belt starts, survives pauses and brief disconnects,
// and ends when the belt stops. The pad's counters (distance, time, steps,
// calories) reset when the belt stops or the pad restarts, so totals are kept
// as base + current, and the base absorbs any reset mid-walk.

import { addSample, addSession, getSessions, putSession } from "./db.js";

// The pad also reports "paused" while idle before the first start, so only
// starting/running opens a walk; paused merely keeps an open one alive.
const MOVING = new Set(["starting", "running"]);
const RESUME_WITHIN_MS = 15 * 60 * 1000;
const SAMPLE_EVERY_MS = 1000;
const SAVE_EVERY_MS = 5000;
const COUNTERS = ["distance", "seconds", "steps", "calories"];

export class Tracker extends EventTarget {
	session = null;
	last = null; // last raw status counters
	lastSampleAt = 0;
	lastSaveAt = 0;
	busy = Promise.resolve();

	/** Feed every decoded status here. */
	update(status) {
		this.busy = this.busy.then(() => this.handle(status)).catch(console.error);
		return this.busy;
	}

	async handle(status) {
		const now = Date.now();
		if (MOVING.has(status.state) && !this.session) await this.begin(now);
		if (this.session && (MOVING.has(status.state) || status.state === "paused")) {
			this.accumulate(status);
			this.session.maxSpeed = Math.max(this.session.maxSpeed, status.speed);
			this.session.updated = now;
			if (now - this.lastSampleAt >= SAMPLE_EVERY_MS) {
				this.lastSampleAt = now;
				await addSample({
					session: this.session.id,
					t: now,
					state: status.state,
					speed: status.speed,
					target: status.target,
					...this.totals(),
				});
			}
			if (now - this.lastSaveAt >= SAVE_EVERY_MS) await this.save(now);
		} else if (this.session) {
			await this.end(now);
		}
		this.emit(status);
	}

	async begin(now) {
		// Continue an unfinished walk (page reload, dropped connection).
		const [latest] = await getSessions(1);
		if (latest && !latest.end && now - latest.updated < RESUME_WITHIN_MS) {
			this.session = latest;
			// Compare against the pad's last raw counters: if they went
			// backwards the pad restarted, and accumulate() banks the difference.
			this.last = latest.raw ?? null;
			return;
		}
		this.session = {
			uid: crypto.randomUUID(),
			start: now,
			updated: now,
			end: null,
			maxSpeed: 0,
			base: Object.fromEntries(COUNTERS.map((k) => [k, 0])),
			totals: Object.fromEntries(COUNTERS.map((k) => [k, 0])),
		};
		this.session.id = await addSession(this.session);
		this.last = null;
	}

	accumulate(status) {
		const { base } = this.session;
		const next = {};
		for (const key of COUNTERS) {
			const last = this.last?.[key] ?? 0;
			const value = status[key];
			if (value === undefined) next[key] = last; // field missing in this frame
			else if (value >= last) next[key] = value;
			else if (value <= last / 2) {
				// Big drop: the pad reset its counter. Bank what we had.
				base[key] += last;
				next[key] = value;
			} else next[key] = last; // small dip: noise, ignore
		}
		this.last = next;
		this.session.raw = next;
		this.session.totals = this.totals();
	}

	totals() {
		const { base } = this.session;
		return Object.fromEntries(
			COUNTERS.map((k) => [k, base[k] + (this.last?.[k] ?? 0)]),
		);
	}

	async save(now) {
		this.lastSaveAt = now;
		await putSession(this.session);
	}

	async end(now) {
		this.session.end = now;
		await this.save(now);
		this.dispatchEvent(new CustomEvent("ended", { detail: this.session }));
		this.session = null;
		this.last = null;
	}

	/** Close a walk that was left open (e.g. pad switched off mid-walk). */
	async finishStale() {
		const [latest] = await getSessions(1);
		if (latest && !latest.end && Date.now() - latest.updated >= RESUME_WITHIN_MS) {
			latest.end = latest.updated;
			await putSession(latest);
		}
	}

	emit(status) {
		this.dispatchEvent(
			new CustomEvent("progress", {
				detail: { status, session: this.session },
			}),
		);
	}
}
