// Walks added or corrected by hand: the rules, in one place. The page, its
// agent tools (agent.js) and the remote MCP server (src/mcp.ts) all use this
// module, so a walk one of them accepts is a walk the others accept.
//
// A walk the pad recorded has no `origin`. One added by hand has
// origin "manual"; a recorded one whose numbers were changed has "edited".
// `agent: true` says the last change was an AI assistant's. Personal records
// (stats.js) count only walks as the pad recorded them.

const DAY = 24 * 60 * 60 * 1000;

/** A deleted walk waits this long in Deleted walks before it is gone for good. */
export const TRASH_DAYS = 30;

export const LIMITS = {
	/** km in one walk. */
	distance: 100,
	/** Walking time in one walk: a day. */
	seconds: 24 * 60 * 60,
	steps: 300_000,
	calories: 20_000,
	/** Average km/h: above this the distance or the time is a typo. */
	speed: 25,
	/** Nothing before this: a year typed short, or a date picker left at its start. */
	earliest: Date.UTC(2000, 0, 1),
};

const round1 = (n) => Math.round(n * 10) / 10;
const isCount = (n, max) => Number.isFinite(n) && n >= 0 && n <= max;

/**
 * What is wrong with a walk's numbers, as a sentence for whoever typed them,
 * or null. `start` is in ms, `seconds` is walking time, `distance` is km.
 */
export function problemWith({ start, seconds, distance, steps = 0, calories = 0, maxSpeed = 0 } = {}, now = Date.now()) {
	if (!Number.isFinite(start) || start < LIMITS.earliest) return "Give the day and time the walk started.";
	if (start > now) return "A walk can't start in the future.";
	if (!(seconds >= 1)) return "Give how long the walk took.";
	if (seconds > LIMITS.seconds) return "A walk can't be longer than 24 hours.";
	if (start + seconds * 1000 > now + 60_000) return "A walk can't end in the future.";
	if (!(distance > 0)) return "Give the distance in km.";
	if (distance > LIMITS.distance) return `A walk can't be longer than ${LIMITS.distance} km.`;
	const average = (distance / seconds) * 3600;
	if (average > LIMITS.speed) return `That is ${round1(average)} km/h on average. Check the distance and the time.`;
	if (!isCount(steps, LIMITS.steps)) return `Steps must be between 0 and ${LIMITS.steps}.`;
	if (!isCount(calories, LIMITS.calories)) return `Calories must be between 0 and ${LIMITS.calories}.`;
	if (!isCount(maxSpeed, LIMITS.speed)) return `Top speed must be between 0 and ${LIMITS.speed} km/h.`;
	return null;
}

/**
 * Steps and calories per km, from the walks the pad recorded: what to fill in
 * when a walk added by hand leaves them out. Null with nothing to learn from.
 */
export function rates(sessions) {
	// Recorded walks first. Without any, recorded walks that were corrected:
	// their steps are still the pad's. Never walks typed in by hand, whose
	// numbers may be estimates themselves.
	for (const wanted of [undefined, "edited"]) {
		let distance = 0;
		let steps = 0;
		let calories = 0;
		for (const { origin, totals } of sessions) {
			if ((origin ?? undefined) !== wanted || !(totals?.distance > 0)) continue;
			distance += totals.distance;
			steps += totals.steps ?? 0;
			calories += totals.calories ?? 0;
		}
		if (distance) return { stepsPerKm: steps / distance, caloriesPerKm: calories / distance };
	}
	return null;
}

const estimate = (given, perKm, distance) => (given === undefined || given === null ? Math.round((perKm ?? 0) * distance) : Math.round(given));

/**
 * A walk added by hand. `input`: { start, seconds, distance, steps?, calories?,
 * maxSpeed? }, already checked with problemWith. Steps and calories left out
 * are estimated from `per` (see rates), or 0 without it.
 */
export function manualWalk(input, { now = Date.now(), per = null, agent = false, uid = crypto.randomUUID() } = {}) {
	const { start, distance } = input;
	const seconds = Math.round(input.seconds);
	return {
		uid,
		start,
		end: start + seconds * 1000,
		updated: now,
		maxSpeed: input.maxSpeed ?? round1((distance / seconds) * 3600),
		totals: {
			distance,
			seconds,
			steps: estimate(input.steps, per?.stepsPerKm, distance),
			calories: estimate(input.calories, per?.caloriesPerKm, distance),
		},
		origin: "manual",
		...(agent && { agent: true }),
	};
}

/**
 * A copy of `session` with `changes` applied: any of start, seconds,
 * distance, steps, calories, maxSpeed. Everything else about the walk stays
 * (its id, its uid, its per-second readings). Check the result's numbers
 * with problemWith(numbersOf(result)) before saving it.
 */
export function changedWalk(session, changes, { now = Date.now(), agent = false } = {}) {
	const totals = { ...session.totals };
	for (const key of ["distance", "seconds", "steps", "calories"]) {
		if (changes[key] !== undefined && changes[key] !== null) totals[key] = key === "distance" ? changes[key] : Math.round(changes[key]);
	}
	const start = changes.start ?? session.start;
	// A recorded walk keeps the time it spent paused; one typed in has none.
	const elapsed = session.origin === "manual" ? 0 : (session.end ?? session.start) - session.start;
	const average = totals.seconds ? (totals.distance / totals.seconds) * 3600 : 0;
	const { agent: _, ...rest } = session;
	return {
		...rest,
		start,
		end: start + Math.max(elapsed, totals.seconds * 1000),
		updated: Math.max(now, (session.updated ?? 0) + 1),
		maxSpeed: changes.maxSpeed ?? Math.max(session.maxSpeed ?? 0, round1(average)),
		totals,
		origin: session.origin === "manual" ? "manual" : "edited",
		...(agent && { agent: true }),
	};
}

/** A walk's numbers, in the shape problemWith and the forms use. */
export const numbersOf = (session) => ({
	start: session.start,
	seconds: session.totals.seconds,
	distance: session.totals.distance,
	steps: session.totals.steps,
	calories: session.totals.calories,
	maxSpeed: session.maxSpeed ?? 0,
});

/** Whether a deleted walk's time in Deleted walks is up. */
export const trashExpired = (session, now = Date.now()) => Boolean(session.deleted) && now - session.deleted >= TRASH_DAYS * DAY;

/** Whole days a deleted walk has left before it is gone for good. */
export const trashDaysLeft = (session, now = Date.now()) => Math.max(0, Math.ceil((session.deleted + TRASH_DAYS * DAY - now) / DAY));
