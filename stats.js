// Aggregations over stored walks for the dashboard.

const DAY = 24 * 60 * 60 * 1000;
const pad2 = (n) => String(n).padStart(2, "0");

const dayKey = (t) => {
	const d = new Date(t);
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

const startOfDay = (t) => {
	const d = new Date(t);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
};

/** Monday 00:00 of the week containing t. */
const startOfWeek = (t) => {
	const d = new Date(startOfDay(t));
	d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
	return d.getTime();
};

const addDays = (t, n) => {
	const d = new Date(t);
	d.setDate(d.getDate() + n);
	return d.getTime();
};

const empty = () => ({ walks: 0, distance: 0, seconds: 0, calories: 0, steps: 0 });

function add(into, session) {
	const t = session.totals;
	into.walks += 1;
	into.distance += t.distance;
	into.seconds += t.seconds;
	into.calories += t.calories;
	into.steps += t.steps;
	return into;
}

function byDay(sessions) {
	const days = new Map();
	for (const session of sessions) {
		const key = dayKey(session.start);
		days.set(key, add(days.get(key) ?? empty(), session));
	}
	return days;
}

export function summarize(sessions, now = Date.now()) {
	const days = byDay(sessions);
	const day = (t) => days.get(dayKey(t)) ?? empty();
	const sum = (from, to) => {
		const total = empty();
		for (let t = from; t < to; t = addDays(t, 1)) {
			const d = day(t);
			for (const k of Object.keys(total)) total[k] += d[k];
		}
		return total;
	};

	const today = startOfDay(now);
	const week = startOfWeek(now);
	const daysIntoWeek = Math.round((today - week) / DAY) + 1;

	const thisWeek = sum(week, addDays(week, 7));
	const lastWeekSoFar = sum(addDays(week, -7), addDays(week, -7 + daysIntoWeek));

	const weekDays = Array.from({ length: 7 }, (_, i) => {
		const t = addDays(week, i);
		return { t, ...day(t), future: t > today, today: t === today };
	});

	const last7 = Array.from({ length: 7 }, (_, i) => {
		const t = addDays(today, i - 6);
		return { t, ...day(t) };
	});

	const weeks = Array.from({ length: 12 }, (_, i) => {
		const t = addDays(week, (i - 11) * 7);
		return { t, ...sum(t, addDays(t, 7)) };
	});

	// 26 columns of Monday..Sunday, ending with the current week.
	const heatStart = addDays(week, -25 * 7);
	const heat = Array.from({ length: 26 }, (_, w) =>
		Array.from({ length: 7 }, (_, d) => {
			const t = addDays(heatStart, w * 7 + d);
			return { t, minutes: day(t).seconds / 60, future: t > today };
		}),
	);

	let activeDays30 = 0;
	for (let i = 0; i < 30; i++) if (day(addDays(today, -i)).walks) activeDays30++;

	let streak = 0;
	for (let t = day(today).walks ? today : addDays(today, -1); day(t).walks; t = addDays(t, -1)) {
		streak++;
	}

	const lifetime = sessions.reduce(add, empty());
	const finished = sessions.filter((s) => s.totals.seconds >= 60);
	const best = (fn) => finished.reduce((top, s) => (!top || fn(s) > fn(top) ? s : top), null);

	return {
		today: day(today),
		yesterday: day(addDays(today, -1)),
		thisWeek,
		weekDelta: lastWeekSoFar.distance
			? (thisWeek.distance - lastWeekSoFar.distance) / lastWeekSoFar.distance
			: null,
		weekDays,
		last7,
		weeks,
		heat,
		activeDays30,
		streak,
		lifetime,
		records: {
			longest: best((s) => s.totals.distance),
			longestTime: best((s) => s.totals.seconds),
			fastest: best((s) => s.totals.distance / s.totals.seconds),
		},
	};
}
