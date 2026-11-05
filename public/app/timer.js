// The walk timer: when this walk reaches so many minutes, or so many km, Walk
// chimes or pauses the belt.
//
// It counts the walk's own totals, so a walk already under way counts what's
// done, and pauses don't count. It's checked on every status from the pad
// (about one a second), not with setTimeout: browsers slow timers in
// background tabs, while Bluetooth updates keep coming.

export const KINDS = {
	time: { unit: "min", step: 5, min: 1, max: 600, initial: 30 },
	distance: { unit: "km", step: 0.5, min: 0.1, max: 100, initial: 2 },
};
export const ENDS = ["chime", "pause"];

export const DEFAULT_TIMER = { kind: "off", minutes: KINDS.time.initial, km: KINDS.distance.initial, end: "chime" };

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
		end: ENDS.includes(timer.end) ? timer.end : "chime",
	};
}

/** The number the user set for the chosen kind: minutes or km. */
export const amount = (timer) => (timer.kind === "time" ? timer.minutes : timer.km);

/** The target in the totals' own units: seconds, or km. */
export const goal = (timer) => (timer.kind === "time" ? timer.minutes * 60 : timer.km);

/** How far along a walk's totals are: seconds, or km. */
export const done = (timer, totals) => (timer.kind === "time" ? totals?.seconds : totals?.distance) ?? 0;

/** 0 to 1, or null when the timer is off. */
export function progress(timer, totals) {
	if (timer.kind === "off") return null;
	return Math.min(1, done(timer, totals) / goal(timer));
}

/**
 * True once, on the update that reaches the target: the walk was short of it
 * before and isn't now. Setting a target the walk has already passed doesn't
 * fire, and raising it re-arms the timer.
 */
export function crossed(timer, before, after) {
	if (timer.kind === "off" || before === null) return false;
	return before < goal(timer) && after >= goal(timer);
}

/** "30 min" or "2 km". */
export function describe(timer) {
	if (timer.kind === "off") return "Off";
	return `${amount(timer)} ${KINDS[timer.kind].unit}`;
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
