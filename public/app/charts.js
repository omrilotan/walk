// Dashboard charts as HTML/SVG strings.

import { fmt } from "./format.js";

/** Full totals as data-* attributes, so a click opens the day/week detail. */
export const detailData = (d, kind) =>
	`data-detail="${kind}" data-t="${d.t}" data-walks="${d.walks}" data-distance="${d.distance}" data-seconds="${d.seconds}" data-calories="${d.calories}" data-steps="${d.steps}"`;

function smoothPath(points) {
	// Catmull-Rom to cubic Bezier for a soft line through every point.
	let d = `M${points[0][0]},${points[0][1]}`;
	for (let i = 0; i < points.length - 1; i++) {
		const p0 = points[i - 1] ?? points[i];
		const p1 = points[i];
		const p2 = points[i + 1];
		const p3 = points[i + 2] ?? p2;
		// Clamp control points between their neighbours so the curve never
		// overshoots, e.g. below zero next to a day without walks.
		const clamp = (y) => Math.min(Math.max(y, Math.min(p1[1], p2[1])), Math.max(p1[1], p2[1]));
		const c1 = [p1[0] + (p2[0] - p0[0]) / 6, clamp(p1[1] + (p2[1] - p0[1]) / 6)];
		const c2 = [p2[0] - (p3[0] - p1[0]) / 6, clamp(p2[1] - (p3[1] - p1[1]) / 6)];
		d += ` C${c1[0].toFixed(2)},${c1[1].toFixed(2)} ${c2[0].toFixed(2)},${c2[1].toFixed(2)} ${p2[0]},${p2[1].toFixed(2)}`;
	}
	return d;
}

export function areaChart(days) {
	const max = Math.max(1, ...days.map((d) => d.distance)) * 1.15;
	const points = days.map((d, i) => [(i / (days.length - 1)) * 100, 50 - (d.distance / max) * 46]);
	const line = smoothPath(points);
	return `
		<svg viewBox="0 0 100 50" preserveAspectRatio="none" aria-hidden="true">
			<line class="grid-line" x1="0" x2="100" y1="50" y2="50" />
			<path class="area-fill" d="${line} L100,50 L0,50 Z" />
			<path class="area-line" d="${line}" />
		</svg>
		<div class="area-points">
			${days
				.map(
					(d, i) => `<span style="--x:${points[i][0]}%;--y:${(points[i][1] / 50) * 100}%" title="${fmt.date.format(d.t)}: ${d.distance.toFixed(2)} km"></span>`,
				)
				.join("")}
		</div>
		<div class="axis">${days.map((d) => `<span>${fmt.weekday.format(d.t)}</span>`).join("")}</div>`;
}

function niceMax(value) {
	if (value <= 0) return 4;
	const exp = 10 ** Math.floor(Math.log10(value));
	const n = value / exp;
	const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 5 ? 5 : 10;
	return step * exp;
}

export function barChart(weeks) {
	const max = niceMax(Math.max(...weeks.map((w) => w.distance)));
	const ticks = [max, (max * 3) / 4, max / 2, max / 4, 0];
	return `
		<div class="bars-y">${ticks.map((t, i) => `<span style="--i:${i}">${+t.toFixed(1)}</span>`).join("")}</div>
		<div class="bars-plot">
			${weeks
				.map(
					(w, i) => `
				<div class="bar" data-current="${i === weeks.length - 1}"${w.walks ? ` role="button" tabindex="0" ${detailData(w, "week")}` : ""} title="Week of ${fmt.date.format(w.t)}: ${w.distance.toFixed(2)} km, ${w.walks} walks">
					<span class="bar-fill" style="--h:${(w.distance / max) * 100}%"></span>
					<span class="bar-label">${fmt.date.format(w.t)}</span>
				</div>`,
				)
				.join("")}
		</div>`;
}

export function heatmap(columns) {
	const values = columns.flat().filter((c) => c.minutes > 0).map((c) => c.minutes).sort((a, b) => a - b);
	const q = (p) => values[Math.floor(p * (values.length - 1))] ?? 0;
	const cuts = [q(0.25), q(0.5), q(0.75)];
	const level = (m) => (m <= 0 ? 0 : m <= cuts[0] ? 1 : m <= cuts[1] ? 2 : m <= cuts[2] ? 3 : 4);

	let lastMonth = -1;
	const months = columns
		.map((col) => {
			const month = new Date(col[0].t).getMonth();
			const label = month !== lastMonth ? new Date(col[0].t).toLocaleString(undefined, { month: "short" }) : "";
			lastMonth = month;
			return `<span>${label}</span>`;
		})
		.join("");

	return `
		<div class="heat-months">${months}</div>
		<div class="heat-grid">
			${columns
				.map(
					(col) =>
						`<div class="heat-col">${col
							.map(
								(c) =>
									`<i data-level="${c.future ? "future" : level(c.minutes)}"${c.walks ? ` role="button" tabindex="0" ${detailData(c, "day")}` : ""} title="${fmt.date.format(c.t)}: ${Math.round(c.minutes)} min"></i>`,
							)
							.join("")}</div>`,
				)
				.join("")}
		</div>`;
}
