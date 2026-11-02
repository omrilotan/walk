// Number and date formatting.

const pad2 = (n) => String(n).padStart(2, "0");
export const int = new Intl.NumberFormat();

export function clock(seconds) {
	const s = Math.floor(seconds % 60);
	const m = Math.floor(seconds / 60) % 60;
	const h = Math.floor(seconds / 3600);
	return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

export function minutes(seconds) {
	const m = Math.round(seconds / 60);
	return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export const km = (n) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2));

export const fmt = {
	when: new Intl.DateTimeFormat(undefined, {
		weekday: "short",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}),
	weekday: new Intl.DateTimeFormat(undefined, { weekday: "short" }),
	date: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }),
	full: new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }),
};
