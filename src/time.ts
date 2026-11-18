/** Time in the user's own zone. Pure, so tests can load it without the Worker. */

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
	let format = formatters.get(zone);
	if (!format) {
		format = new Intl.DateTimeFormat("en-US", {
			timeZone: zone,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
		formatters.set(zone, format);
	}
	return format;
}

/**
 * The user's wall-clock time, written as if it were UTC. The Worker's own
 * clock is UTC, so stats.js, which counts days with local-time methods,
 * then counts the user's days.
 */
export function wallClock(t: number, zone: string): number {
	const parts = Object.fromEntries(formatter(zone).formatToParts(t).map((p) => [p.type, Number(p.value)]));
	return Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!) + (t % 1000);
}

/** "2026-11-04 08:30" in the user's zone. */
export function local(t: number, zone: string): string {
	return new Date(wallClock(t, zone)).toISOString().slice(0, 16).replace("T", " ");
}

/**
 * The real time (ms) of a wall-clock "YYYY-MM-DD HH:MM" (a "T" and ":SS" are
 * fine too) in the user's zone: the opposite of wallClock. Null when the text
 * is not a real date and time, or when the clock never showed that time
 * (the hour skipped when clocks go forward).
 */
export function fromLocal(text: string, zone: string): number | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
	if (!m) return null;
	const [year, month, day, hour, minute, second] = m.slice(1).map((n) => Number(n ?? 0)) as [number, number, number, number, number, number];
	const wall = Date.UTC(year, month - 1, day, hour, minute, second);
	// Date.UTC rolls 13/40 over into the next month: a real date comes back unchanged.
	const check = new Date(wall);
	if (
		check.getUTCFullYear() !== year ||
		check.getUTCMonth() !== month - 1 ||
		check.getUTCDate() !== day ||
		hour > 23 ||
		minute > 59 ||
		second > 59
	) {
		return null;
	}
	try {
		// The zone's offset at a first guess, then once more at the corrected
		// instant, in case the clocks changed between the two.
		const first = wall - (wallClock(wall, zone) - wall);
		const t = wall - (wallClock(first, zone) - first);
		return wallClock(t, zone) === wall ? t : null;
	} catch {
		// An unknown zone name.
		return null;
	}
}
