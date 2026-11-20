// The walk timer: after so many minutes, or so many km, Walk chimes or pauses
// the belt.
//
// The amount is counted one of two ways. "From now": 10 more minutes, half a
// km more, counted from the moment the timer is set. "In total": the walk as
// a whole reaches 30 minutes, or 3.5 km, however much of it is already done.
// Before a walk starts the two are the same.
//
// Either way it counts the walk's own totals, so pauses don't count. It's
// checked on every status from the pad (about one a second), not with
// setTimeout: browsers slow timers in background tabs, while Bluetooth
// updates keep coming.

import { clock } from "./format.js";

export const KINDS = {
	time: { unit: "min", step: 5, min: 1, max: 600, initial: 30 },
	distance: { unit: "km", step: 0.5, min: 0.1, max: 100, initial: 2 },
};
export const ENDS = ["chime", "pause"];
/** Where the amount is counted from: this moment, or the start of the walk. */
export const FROMS = ["now", "start"];

export const DEFAULT_TIMER = {
	kind: "off",
	minutes: KINDS.time.initial,
	km: KINDS.distance.initial,
	from: "now",
	end: "chime",
};

const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;

/** A stored or agent-supplied timer, made safe to use. */
export function normalize(timer = {}) {
	const kind = timer.kind in KINDS ? timer.kind : "off";
	const clamp = (value, { min, max, initial }) => {
		const n = Number(value);
		return Number.isFinite(n) && n > 0 ? Math.min(max, Math.max(min, n)) : initial;
	};
	return {
		kind,
		minutes: round(clamp(timer.minutes, KINDS.time), 1),
		km: round(clamp(timer.km, KINDS.distance), 2),
		from: FROMS.includes(timer.from) ? timer.from : "now",
		end: ENDS.includes(timer.end) ? timer.end : "chime",
	};
}

/** The number the user set for the chosen kind: minutes or km. */
export const amount = (timer) => (timer.kind === "time" ? timer.minutes : timer.km);

/** The amount in the totals' own units: seconds, or km. */
export const goal = (timer) => (timer.kind === "time" ? timer.minutes * 60 : timer.km);

/** How far along a walk's totals are: seconds, or km. */
export const done = (timer, totals) => (timer.kind === "time" ? totals?.seconds : totals?.distance) ?? 0;

/**
 * Where in the walk the count begins: seconds, or km. `base` is the walk's
 * totals when a "from now" timer was set; without one, and always for
 * "in total", the count begins where the walk does.
 */
export const origin = (timer, base) => (timer.from === "now" ? done(timer, base) : 0);

/** Where in the walk the timer ends: seconds, or km of the walk as a whole. */
export const target = (timer, base) => round(origin(timer, base) + goal(timer), 4);

/** What's left to walk: seconds, or km. Never below zero. */
export const left = (timer, totals, base) => Math.max(0, target(timer, base) - done(timer, totals));

/** 0 to 1, or null when the timer is off. */
export function progress(timer, totals, base) {
	if (timer.kind === "off") return null;
	if (left(timer, totals, base) === 0) return 1;
	const share = (done(timer, totals) - origin(timer, base)) / goal(timer);
	return Math.min(1, Math.max(0, share));
}

/**
 * True once, on the update that reaches the target: the walk was short of it
 * before and isn't now. Setting a target the walk has already passed doesn't
 * fire, and raising it re-arms the timer.
 */
export function crossed(timer, before, after, base) {
	if (timer.kind === "off" || before === null) return false;
	const end = target(timer, base);
	return before < end && after >= end;
}

/** "30 min" or "2 km". */
export function describe(timer) {
	if (timer.kind === "off") return "Off";
	return `${amount(timer)} ${KINDS[timer.kind].unit}`;
}

/** The walk total the timer ends at: "30 min", "22:30", "1:02:30" or "3.9 km". */
export function describeTarget(timer, base) {
	if (timer.kind === "off") return "Off";
	const end = target(timer, base);
	if (timer.kind === "distance") return `${round(end, 2)} km`;
	const seconds = Math.round(end);
	return seconds % 60 === 0 ? `${seconds / 60} min` : clock(seconds);
}

/**
 * The next amount one tap of − or + gives. It snaps to the step: 32 goes to
 * 35 or 30. For "in total", + from an amount the walk has already passed
 * goes to the first step ahead of the walk: 3.4 km walked gives 3.5.
 */
export function stepped(timer, direction, totals) {
	const { step } = KINDS[timer.kind];
	const now = amount(timer);
	if (direction < 0) return Math.ceil(now / step - 1e-9) * step - step;
	const walked = timer.from === "start" ? done(timer, totals) / (timer.kind === "time" ? 60 : 1) : 0;
	return Math.floor(Math.max(now, walked) / step + 1e-9) * step + step;
}

// ---------------------------------------------------------------- chime

let audio = null;

/**
 * Browsers start audio only after a tap on the page. Call this from taps
 * (Start, the timer controls) so the chime can play later, unattended.
 */
export function primeChime() {
	try {
		audio ??= new AudioContext();
		if (audio.state === "suspended") audio.resume();
	} catch {}
}

/** Three soft rising notes, made in the page: no sound files. */
export function chime() {
	primeChime();
	if (!audio) return;
	const start = audio.currentTime + 0.05;
	[659.25, 830.61, 987.77].forEach((frequency, i) => {
		const at = start + i * 0.18;
		const tone = audio.createOscillator();
		const level = audio.createGain();
		tone.type = "sine";
		tone.frequency.value = frequency;
		level.gain.setValueAtTime(0, at);
		level.gain.linearRampToValueAtTime(0.25, at + 0.02);
		level.gain.exponentialRampToValueAtTime(0.001, at + 1.2);
		tone.connect(level).connect(audio.destination);
		tone.start(at);
		tone.stop(at + 1.25);
	});
	navigator.vibrate?.([180, 90, 180]);
}
