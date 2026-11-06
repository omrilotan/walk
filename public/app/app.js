import { deleteSession, exportAll, getSessions, getSetting, importAll, planImport, setSetting } from "./db.js";
import { Pad } from "./pad.js";
import { areaChart, barChart, detailData, heatmap } from "./charts.js";
import { clock, fmt, int, km, minutes } from "./format.js";
import { summarize } from "./stats.js";
import { Tracker } from "./tracker.js";
import { DEFAULT_TIMER, KINDS, amount, chime, crossed, describe, done, goal, normalize, primeChime, progress } from "./timer.js";
import { registerAgentTools } from "./agent.js";
import { checkAccount, currentAccount as account, recordDeletion, resetAll, signedIn, sync } from "./sync.js";
import { api, enterCode, requestCode, signOut } from "./auth.js";

const $ = (selector) => document.querySelector(selector);

const MIN_SPEED = 1;
const STEP = 0.5;
const DEFAULT_PRESETS = [2, 3, 4, 5];
const STATE_LABELS = {
	offline: "Not connected",
	stopped: "Ready",
	starting: "Starting",
	running: "Walking",
	paused: "Paused",
};
const SPARK_POINTS = 600; // ten minutes at one point per second

const pad = new Pad();
const tracker = new Tracker();

const ui = {
	state: "offline",
	maxSpeed: 6,
	target: 3,
	presets: DEFAULT_PRESETS,
	goal: 5,
	sessions: [],
	spark: [],
	sparkAt: 0,
	dashAt: 0,
	status: null, // last status from the pad
	startMode: "ask", // agent starts: "ask" or "auto"
	timer: DEFAULT_TIMER,
	timerLast: null, // { key, value }: the walk's last count, to see the timer's target crossed
};

const round1 = (n) => Math.round(n * 10) / 10;
const clampSpeed = (kmh) => round1(Math.min(ui.maxSpeed, Math.max(MIN_SPEED, kmh)));
function message(text) {
	$("#message").textContent = text;
}

// ---------------------------------------------------------------- theme

function applyTheme(theme) {
	if (theme === "auto") delete document.documentElement.dataset.theme;
	else document.documentElement.dataset.theme = theme;
	for (const choice of document.querySelectorAll("[data-theme-choice]")) {
		choice.setAttribute("aria-checked", String(choice.dataset.themeChoice === theme));
	}
	try {
		localStorage.setItem("walk:theme", theme);
	} catch {}
}

function currentTheme() {
	try {
		return localStorage.getItem("walk:theme") || "auto";
	} catch {
		return "auto";
	}
}

// ---------------------------------------------------------------- speed

function setTarget(kmh, { send = false } = {}) {
	ui.target = clampSpeed(kmh);
	$("#speed").value = ui.target.toFixed(1);
	renderPresets();
	setSetting("target", ui.target);
	if (send) applySpeed();
}

const isMoving = () => ui.state === "running" || ui.state === "starting";

function applySpeed() {
	if (!pad.connected) return message("Connect the pad first.");
	if (isMoving()) pad.setSpeed(ui.target);
	else pad.start(ui.target);
}

function renderPresets() {
	const container = $("#presets");
	container.innerHTML = "";
	for (const kmh of ui.presets) {
		const chip = document.createElement("span");
		chip.className = "chip";
		chip.dataset.active = String(kmh === ui.target);

		const go = document.createElement("button");
		go.type = "button";
		go.innerHTML = `${kmh.toFixed(1)}<small>km/h</small>`;
		go.title = isMoving() ? `Change to ${kmh.toFixed(1)} km/h` : `Start at ${kmh.toFixed(1)} km/h`;
		go.addEventListener("click", () => setTarget(kmh, { send: pad.connected }));

		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "remove";
		remove.setAttribute("aria-label", `Remove ${kmh.toFixed(1)} preset`);
		remove.innerHTML = `<i class="ph-bold ph-x"></i>`;
		remove.addEventListener("click", () => savePresets(ui.presets.filter((p) => p !== kmh)));

		chip.append(go, remove);
		container.append(chip);
	}
}

async function savePresets(presets) {
	ui.presets = [...new Set(presets)].sort((a, b) => a - b);
	renderPresets();
	await setSetting("presets", ui.presets);
}

// ---------------------------------------------------------------- live panel

function renderConnection(connected) {
	const button = $("#connect");
	delete button.dataset.confirm;
	button.dataset.connected = String(connected);
	button.querySelector("i").className = connected ? "ph-bold ph-bluetooth-connected" : "ph-bold ph-bluetooth";
	button.querySelector("span").textContent = connected ? pad.device?.name ?? "Connected" : "Connect";
	button.title = connected ? "Connected. Click twice to disconnect" : "Connect your walking pad";
	if (!connected) {
		ui.state = "offline";
		renderState();
		$("#speed-now").textContent = "0.0";
	}
	renderControls();
}

function renderState() {
	const pill = $("#state-pill");
	pill.dataset.state = ui.state;
	pill.textContent = STATE_LABELS[ui.state] ?? ui.state;
	document.body.dataset.state = ui.state;
	renderHeadline();
}

function renderControls() {
	const connected = pad.connected;
	const moving = isMoving();
	const start = $("#start");
	start.disabled = !connected || moving;
	start.querySelector("span").textContent = ui.state === "paused" && tracker.session ? "Resume" : "Start";
	$("#pause").disabled = !connected || !moving;
	$("#stop").disabled = !connected || !(moving || (ui.state === "paused" && tracker.session));
	renderPresets();
}

function renderLive({ status, session }) {
	ui.status = status;
	if (status.state !== ui.state) {
		ui.state = status.state;
		renderState();
		renderControls();
		if (status.state === "running" && status.target) setTarget(status.target);
		if (status.state === "stopped") ui.spark = [];
	}
	if (status.maxSpeed && status.maxSpeed !== ui.maxSpeed) {
		ui.maxSpeed = status.maxSpeed;
		$("#speed").max = String(ui.maxSpeed);
	}

	$("#speed-now").textContent = status.speed.toFixed(1);
	$("#target-line").textContent =
		isMoving() && status.target ? `Target ${status.target.toFixed(1)} km/h` : "";

	// Walk totals while a walk is recorded, else the pad's own counters.
	const totals = session?.totals ?? status;
	$("#m-time").textContent = clock(totals.seconds ?? 0);
	$("#m-distance").textContent = (totals.distance ?? 0).toFixed(2);
	$("#m-calories").textContent = int.format(totals.calories ?? 0);
	$("#m-steps").textContent = int.format(totals.steps ?? 0);

	const now = Date.now();
	if (isMoving() && now - ui.sparkAt >= 1000) {
		ui.sparkAt = now;
		ui.spark.push(status.speed);
		if (ui.spark.length > SPARK_POINTS) ui.spark.shift();
		renderSpark();
	}

	renderTimerProgress(session?.totals ?? null);
	checkTimer(session);

	// Keep today's numbers moving during a walk without hammering the DB.
	if (session && now - ui.dashAt > 5000) {
		ui.dashAt = now;
		const others = ui.sessions.filter((s) => s.id !== session.id);
		renderDashboard([session, ...others]);
	}
}

function renderSpark() {
	const points = ui.spark;
	const svg = $("#spark");
	if (points.length < 2) {
		svg.querySelector(".spark-line").setAttribute("d", "");
		svg.querySelector(".spark-fill").setAttribute("d", "");
		return;
	}
	const max = Math.max(ui.maxSpeed, ...points);
	const x = (i) => (i / (points.length - 1)) * 100;
	const y = (v) => 30 - (v / max) * 28;
	const line = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
	svg.querySelector(".spark-line").setAttribute("d", line);
	svg.querySelector(".spark-fill").setAttribute("d", `${line} L100,32 L0,32 Z`);
}

function renderHeadline() {
	const hour = new Date().getHours();
	$("#greeting").textContent =
		hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
	const headlines = {
		offline: "Ready when you are.",
		stopped: "Ready when you are.",
		starting: "Here we go.",
		running: "You're on the move.",
		paused: "Catch your breath.",
	};
	$("#headline").textContent = headlines[ui.state] ?? headlines.offline;
}

// ---------------------------------------------------------------- timer

function setTimer(changes) {
	ui.timer = normalize({ ...ui.timer, ...changes });
	renderTimer();
	setSetting("timer", ui.timer);
}

function renderTimer() {
	const timer = ui.timer;
	const box = $("#timer");
	box.dataset.kind = timer.kind;
	for (const button of box.querySelectorAll("button[data-kind]")) {
		button.setAttribute("aria-checked", String(button.dataset.kind === timer.kind));
	}
	for (const button of box.querySelectorAll("button[data-end]")) {
		button.setAttribute("aria-checked", String(button.dataset.end === timer.end));
	}
	if (timer.kind !== "off") {
		const { unit, step, min, max } = KINDS[timer.kind];
		const input = $("#timer-value");
		// Don't rewrite the number while it's being typed.
		if (document.activeElement !== input) input.value = String(amount(timer));
		input.min = String(min);
		input.max = String(max);
		input.setAttribute("aria-label", timer.kind === "time" ? "Minutes" : "Kilometres");
		$("#timer-unit").textContent = unit;
		$("#timer-less").setAttribute("aria-label", `${step} ${unit} less`);
		$("#timer-more").setAttribute("aria-label", `${step} ${unit} more`);
	}
	renderTimerProgress(tracker.session?.totals ?? null);
}

/** The timer's tile (Time or Distance) fills up; the timer row counts down. */
function renderTimerProgress(totals) {
	const timer = ui.timer;
	const share = totals ? progress(timer, totals) : 0;
	for (const tile of document.querySelectorAll("[data-timer-kind]")) {
		const on = tile.dataset.timerKind === timer.kind;
		tile.toggleAttribute("data-timer", on);
		tile.dataset.done = String(on && share === 1);
		tile.style.setProperty("--progress", on ? String(share) : "0");
		tile.querySelector(".metric-of").textContent = on ? (share === 1 ? "Done" : `of ${describe(timer)}`) : "";
	}

	const box = $("#timer");
	const left = $("#timer-left");
	if (timer.kind === "off" || !totals) {
		box.dataset.state = "idle";
		left.textContent = "";
		return;
	}
	const remaining = goal(timer) - done(timer, totals);
	if (remaining <= 0) {
		box.dataset.state = "done";
		left.innerHTML = `<i class="ph-bold ph-check"></i>Done`;
		return;
	}
	box.dataset.state = "running";
	left.textContent = timer.kind === "time" ? `${clock(Math.ceil(remaining))} left` : `${remaining.toFixed(2)} km left`;
}

/** On every status: did this update take the walk past the timer's target? */
function checkTimer(session) {
	if (!session) {
		ui.timerLast = null;
		return;
	}
	const key = `${session.uid}:${ui.timer.kind}`;
	const before = ui.timerLast?.key === key ? ui.timerLast.value : null;
	const after = done(ui.timer, session.totals);
	ui.timerLast = { key, value: after };
	if (crossed(ui.timer, before, after)) timerDone();
}

function timerDone() {
	const what = `${describe(ui.timer)} done.`;
	chime();
	if (ui.timer.end === "pause" && pad.connected && isMoving()) {
		pad.pause();
		message(`${what} Belt paused.`);
	} else message(what);
}

function wireTimer() {
	const box = $("#timer");
	box.addEventListener("click", (event) => {
		primeChime(); // a tap now lets the chime play later
		const kind = event.target.closest("button[data-kind]")?.dataset.kind;
		if (kind) setTimer({ kind });
		const end = event.target.closest("button[data-end]")?.dataset.end;
		if (end) setTimer({ end });
	});
	const field = () => (ui.timer.kind === "time" ? "minutes" : "km");
	const step = (direction) => {
		const { step } = KINDS[ui.timer.kind];
		const now = amount(ui.timer);
		// Snap to the step: 32 goes to 35 or 30.
		const next = direction > 0 ? Math.floor(now / step + 1e-9) * step + step : Math.ceil(now / step - 1e-9) * step - step;
		setTimer({ [field()]: next });
	};
	$("#timer-less").addEventListener("click", () => step(-1));
	$("#timer-more").addEventListener("click", () => step(1));
	const input = $("#timer-value");
	input.addEventListener("input", () => {
		const value = Number(input.value);
		if (value > 0) setTimer({ [field()]: value });
	});
	input.addEventListener("change", () => renderTimer()); // show the stored value
	input.addEventListener("keydown", (event) => {
		if (event.key === "Enter") input.blur();
	});
}

// ---------------------------------------------------------------- dashboard

async function loadSessions() {
	ui.sessions = await getSessions();
	renderDashboard(ui.sessions);
	renderHistory(ui.sessions);
}

function renderDashboard(sessions) {
	const s = summarize(sessions);

	$("#lifetime").textContent = sessions.length
		? `${int.format(sessions.length)} ${sessions.length === 1 ? "walk" : "walks"}, ${km(s.lifetime.distance)} km lifetime`
		: "Your walks will show up here.";

	// Today ring
	$("#today-title").textContent = `Today, ${fmt.full.format(new Date())}`;
	$("#today-distance").textContent = s.today.distance.toFixed(2);
	const progress = Math.min(1, s.today.distance / ui.goal);
	const circumference = 2 * Math.PI * 52;
	const ring = $("#ring-fill");
	ring.style.strokeDasharray = `${circumference}`;
	ring.style.strokeDashoffset = `${circumference * (1 - progress)}`;
	ring.dataset.done = String(progress >= 1);
	$("#yesterday").textContent = `Yesterday: ${s.yesterday.distance.toFixed(2)} km`;

	$("#today-walks").textContent = s.today.walks;
	$("#today-time").textContent = minutes(s.today.seconds);
	$("#today-calories").textContent = int.format(s.today.calories);
	$("#today-steps").textContent = int.format(s.today.steps);

	// This week
	$("#week-summary").textContent = `${km(s.thisWeek.distance)} km, ${minutes(s.thisWeek.seconds)}`;
	const delta = $("#week-delta");
	if (s.weekDelta === null) {
		delta.textContent = "";
	} else {
		const pct = Math.round(s.weekDelta * 100);
		delta.dataset.trend = pct >= 0 ? "up" : "down";
		delta.innerHTML = `<i class="ph-bold ${pct >= 0 ? "ph-trend-up" : "ph-trend-down"}"></i>${pct >= 0 ? "+" : ""}${pct}% vs last week`;
	}
	const weekMax = Math.max(ui.goal, ...s.weekDays.map((d) => d.distance));
	$("#week-days").innerHTML = s.weekDays
		.map(
			(d) => `
			<div class="day" data-today="${d.today}" data-future="${d.future}"${d.walks ? ` role="button" tabindex="0" ${detailData(d, "day")}` : ""}>
				<span class="day-name">${fmt.weekday.format(d.t)}</span>
				<span class="day-bar"><span style="--h:${(d.distance / weekMax) * 100}%"></span></span>
				<span class="day-value">${d.future || !d.distance ? "-" : km(d.distance)}</span>
			</div>`,
		)
		.join("");

	$("#area").innerHTML = areaChart(s.last7);
	$("#bars").innerHTML = barChart(s.weeks);
	$("#heat").innerHTML = heatmap(s.heat);
	$("#active-days").textContent = s.activeDays30;
	renderRecords(s);
}

function renderRecords(s) {
	const { longest, longestTime, fastest } = s.records;
	const rows = [
		["Lifetime distance", `${km(s.lifetime.distance)} km`, `${int.format(s.lifetime.walks)} ${s.lifetime.walks === 1 ? "walk" : "walks"}`],
		["Lifetime time", minutes(s.lifetime.seconds), `${int.format(s.lifetime.calories)} kcal`],
		["Current streak", `${s.streak} ${s.streak === 1 ? "day" : "days"}`, "consecutive days walked"],
		["Longest walk", longest ? `${km(longest.totals.distance)} km` : "-", longest ? fmt.date.format(longest.start) : ""],
		["Longest time", longestTime ? minutes(longestTime.totals.seconds) : "-", longestTime ? fmt.date.format(longestTime.start) : ""],
		[
			"Best average",
			fastest ? `${((fastest.totals.distance / fastest.totals.seconds) * 3600).toFixed(1)} km/h` : "-",
			fastest ? fmt.date.format(fastest.start) : "",
		],
	];
	$("#records").innerHTML = rows
		.map(
			([label, value, note]) => `
			<div>
				<dt>${label}</dt>
				<dd><b>${value}</b><span class="muted small">${note}</span></dd>
			</div>`,
		)
		.join("");
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Open the day/week detail dialog from a clicked grid square, bar or day. */
function openDetail(el) {
	const d = el.dataset;
	if (!d.detail) return;
	const t = Number(d.t);
	const walks = Number(d.walks);
	const week = d.detail === "week";
	$("#detail-title").textContent = week ? `Week of ${fmt.date.format(t)}` : fmt.full.format(new Date(t));
	$("#detail-sub").textContent = week
		? `${fmt.date.format(t)} – ${fmt.date.format(t + 6 * DAY_MS)}`
		: `${int.format(walks)} ${walks === 1 ? "walk" : "walks"}`;
	$("#detail-steps").textContent = int.format(Number(d.steps));
	$("#detail-walks").textContent = int.format(walks);
	$("#detail-time").textContent = minutes(Number(d.seconds));
	$("#detail-distance").textContent = km(Number(d.distance));
	$("#detail-calories").textContent = int.format(Number(d.calories));
	$("#day-dialog").showModal();
}

function wireDetails() {
	for (const surface of [$("#week-days"), $("#bars"), $("#heat")]) {
		surface.addEventListener("click", (event) => {
			const el = event.target.closest("[data-detail]");
			if (el) openDetail(el);
		});
		surface.addEventListener("keydown", (event) => {
			if (event.key !== "Enter" && event.key !== " ") return;
			const el = event.target.closest("[data-detail]");
			if (el) {
				event.preventDefault();
				openDetail(el);
			}
		});
	}
}

function renderHistory(sessions) {
	const recent = sessions.slice(0, 8);
	const list = $("#history");
	list.innerHTML = "";
	$("#history-empty").hidden = sessions.length > 0;
	$("#walk-count").textContent = sessions.length ? `${int.format(sessions.length)} total` : "";

	for (const session of recent) {
		const t = session.totals;
		const avg = t.seconds ? (t.distance / t.seconds) * 3600 : 0;
		const item = document.createElement("li");
		item.innerHTML = `
			<span class="walk-icon"><i class="ph ph-sneaker-move"></i></span>
			<span class="walk-main">
				<b>${fmt.when.format(session.start)}</b>
				<span class="muted small">${session.end ? `${int.format(t.steps)} steps, avg ${avg.toFixed(1)} km/h` : "In progress"}</span>
			</span>
			<span class="walk-nums">
				<span><b>${km(t.distance)}</b><small>km</small></span>
				<span><b>${minutes(t.seconds)}</b><small>time</small></span>
				<span><b>${int.format(t.calories)}</b><small>kcal</small></span>
			</span>`;
		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "icon-btn subtle";
		remove.setAttribute("aria-label", "Delete walk");
		remove.innerHTML = `<i class="ph ph-trash"></i>`;
		remove.addEventListener("click", async () => {
			if (!remove.dataset.confirm) {
				remove.dataset.confirm = "1";
				remove.innerHTML = `<span class="confirm">Delete?</span>`;
				setTimeout(() => {
					delete remove.dataset.confirm;
					remove.innerHTML = `<i class="ph ph-trash"></i>`;
				}, 3000);
				return;
			}
			await recordDeletion(session);
			await deleteSession(session.id);
			loadSessions();
			syncNow();
		});
		item.append(remove);
		list.append(item);
	}
}

function download(name, text, type) {
	const a = document.createElement("a");
	a.href = URL.createObjectURL(new Blob([text], { type }));
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const today = () => new Date().toISOString().slice(0, 10);

async function exportHistory() {
	const data = await exportAll();
	download(`walks-${today()}.json`, JSON.stringify(data), "application/json");
	message(`Exported ${data.sessions.length} walks.`);
}

async function exportCsv() {
	const iso = (t) => (t ? new Date(t).toISOString() : "");
	const rows = [
		["start", "end", "minutes", "distance_km", "avg_kmh", "max_kmh", "steps", "calories"],
		...ui.sessions.map((s) => {
			const t = s.totals;
			return [
				iso(s.start),
				iso(s.end),
				(t.seconds / 60).toFixed(1),
				t.distance.toFixed(3),
				t.seconds ? ((t.distance / t.seconds) * 3600).toFixed(2) : "",
				(s.maxSpeed ?? 0).toFixed(1),
				t.steps,
				t.calories,
			];
		}),
	];
	download(`walks-${today()}.csv`, rows.map((r) => r.join(",")).join("\n"), "text/csv");
}

// ---------------------------------------------------------------- import

// The file being imported, between picking it and choosing how.
const importing = { data: null, plan: null, mode: "merge" };

const walkCount = (n) => `${int.format(n)} ${n === 1 ? "walk" : "walks"}`;

/** Reads the file, then asks how to import it: merge (the default) or replace. */
async function importHistory(file) {
	let data, plan;
	try {
		data = JSON.parse(await file.text());
		plan = planImport(data, await getSessions());
	} catch (error) {
		return message(`Import failed: ${error instanceof SyntaxError ? "not a Walk export file" : error.message}.`);
	}
	if (!plan.add.length && !plan.update.length && !plan.keep.length) {
		return message("Import failed: there are no walks in this file.");
	}
	const exported = new Date(data.exported);
	$("#import-source span").textContent = [
		file.name,
		Number.isNaN(exported.getTime()) ? null : `exported ${shortDate.format(exported)}`,
	]
		.filter(Boolean)
		.join(", ");
	// Always starts on merge: replacing is a choice, never a default.
	Object.assign(importing, { data, plan, mode: "merge" });
	$("#import-error").textContent = "";
	renderImport();
	$("#import-dialog").showModal();
}

const canReplace = () => !tracker.session && ui.sessions.length > 0;

/** "This file has 8 walks: 2 new, 1 newer than here and 5 already here." */
function importSummary({ add, update, keep, invalid }) {
	const total = add.length + update.length + keep.length;
	const bold = (text) => Object.assign(document.createElement("b"), { textContent: text });
	const parts = [];
	if (add.length || update.length) {
		parts.push(`This file has ${walkCount(total)}: `);
		const counts = [
			add.length && bold(`${int.format(add.length)} new`),
			update.length && bold(`${int.format(update.length)} newer than here`),
			keep.length && `${int.format(keep.length)} already here`,
		].filter(Boolean);
		counts.forEach((count, i) => parts.push(i === 0 ? "" : i === counts.length - 1 ? " and " : ", ", count));
		parts.push(".");
	} else {
		parts.push(total === 1 ? "The walk in this file is already here." : `All ${walkCount(total)} in this file are already here.`);
	}
	if (invalid) parts.push(` ${int.format(invalid)} ${invalid === 1 ? "entry isn't a walk" : "entries aren't walks"}, and will be skipped.`);
	return parts;
}

function renderImport() {
	const { plan, mode } = importing;
	const changes = plan.add.length + plan.update.length;
	const total = changes + plan.keep.length;
	const here = ui.sessions.length;

	$("#import-summary").replaceChildren(...importSummary(plan));

	const adds = [plan.add.length && `adds ${walkCount(plan.add.length)}`, plan.update.length && `updates ${int.format(plan.update.length)}`]
		.filter(Boolean)
		.join(" and ");
	$("#import-merge-note").textContent = changes
		? `${adds[0].toUpperCase()}${adds.slice(1)}. Deletes nothing.`
		: "Nothing new to add.";
	$("#import-replace-note").textContent = tracker.session
		? "Stop the walk first."
		: here
			? `Deletes the ${walkCount(here)} here, then imports the file's ${int.format(total)}.`
			: "Nothing here to replace.";
	$("#import-replace").disabled = !canReplace();

	for (const button of document.querySelectorAll(".import-modes [data-mode]")) {
		button.setAttribute("aria-checked", String(button.dataset.mode === mode));
	}

	const replacing = mode === "replace";
	$("#import-warning").hidden = !replacing;
	$("#import-warning-text").textContent = signedIn()
		? "Can't be undone. Also deletes your walks in your Walk account and other signed-in browsers."
		: "Can't be undone.";

	const confirm = $("#import-confirm");
	confirm.classList.toggle("danger", replacing);
	confirm.disabled = replacing ? !canReplace() : !changes;
	confirm.textContent = replacing ? "Replace all" : changes ? `Import ${walkCount(changes)}` : "Nothing to import";
}

async function confirmImport() {
	const button = $("#import-confirm");
	button.disabled = true;
	$("#import-error").textContent = "";
	try {
		let result;
		if (importing.mode === "replace") {
			if (tracker.session) throw new Error("Stop the walk before replacing your walks.");
			await resetAll();
			// Signed in, the account now keeps the old walks' uids as deletions:
			// the imported walks get new ones, or the next sync would delete them.
			result = await importAll(importing.data, { fresh: signedIn() });
			message(`Replaced: ${walkCount(result.added)} imported.`);
		} else {
			result = await importAll(importing.data);
			message(`Imported: ${result.added} new, ${result.updated} updated, ${result.skipped} already here.`);
		}
		$("#import-dialog").close();
		await loadSessions();
		syncNow();
	} catch (error) {
		$("#import-error").textContent = `Import failed: ${error.message}`;
		button.disabled = false;
		await loadSessions();
	}
}

function wireImport() {
	const dialog = $("#import-dialog");
	dialog.addEventListener("close", () => Object.assign(importing, { data: null, plan: null }));
	$(".import-modes").addEventListener("click", (event) => {
		const button = event.target.closest("[data-mode]");
		if (!button || button.disabled || !importing.plan) return;
		importing.mode = button.dataset.mode;
		renderImport();
	});
	$("#import-cancel").addEventListener("click", () => dialog.close());
	$("#import-export").addEventListener("click", exportHistory);
	$("#import-confirm").addEventListener("click", confirmImport);
}

// ---------------------------------------------------------------- account dialog

const shortDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function accountError(error) {
	$("#acct-error").textContent = error?.message ?? "";
}

async function openAccount() {
	accountError();
	if (signedIn()) await checkAccount(); // fresh counts
	await renderAccountDialog();
	$("#account-dialog").showModal();
	if (!signedIn()) ($("#acct-code-form").hidden ? $("#acct-email") : $("#acct-code")).focus();
}

async function renderAccountDialog() {
	const me = account();
	$("#acct-out").hidden = Boolean(me);
	$("#acct-in").hidden = !me;
	if (!me) return;
	$("#acct-who").textContent = me.email;
	$("#acct-status").textContent = `${int.format(me.walks)} ${me.walks === 1 ? "walk" : "walks"} synced.`;
	await renderAssistants().catch(accountError);
}

async function renderAssistants() {
	const { assistants } = await api("/api/me/assistants");
	const list = $("#acct-assistants");
	list.innerHTML = "";
	$("#acct-none").hidden = assistants.length > 0;
	for (const assistant of assistants) {
		const row = document.createElement("div");
		row.className = "acct-row";
		const label = document.createElement("span");
		const name = document.createElement("b");
		name.textContent = assistant.name;
		const note = document.createElement("small");
		note.textContent = `Connected ${shortDate.format(assistant.connected * 1000)}, ${assistant.scopes.includes("goal") ? "can change your goal" : "read only"}`;
		label.append(name, note);
		const button = document.createElement("button");
		button.className = "btn";
		button.type = "button";
		button.textContent = "Disconnect";
		button.addEventListener("click", async () => {
			button.disabled = true;
			await api(`/api/me/assistants/${encodeURIComponent(assistant.id)}`, { method: "DELETE" }).catch(accountError);
			renderAssistants().catch(accountError);
		});
		row.append(label, button);
		list.append(row);
	}
}

/** Signed in or out: refresh the account, the menu row and the dialog. */
async function afterAccountChange() {
	if (await checkAccount()) {
		await syncNow();
		await checkAccount(); // fresh counts after the first sync
	} else renderAccount("off");
	await renderAccountDialog();
}

function wireAccount() {
	const dialog = $("#account-dialog");
	dialog.addEventListener("click", (event) => {
		if (event.target === event.currentTarget) dialog.close(); // backdrop
	});

	$("#acct-email-form").addEventListener("submit", async (event) => {
		event.preventDefault();
		const button = event.submitter;
		button.disabled = true;
		accountError();
		try {
			const email = $("#acct-email").value.trim();
			const result = await requestCode(email, $("#acct-consent").checked);
			$("#acct-sent-to").textContent = email;
			$("#acct-email-form").hidden = true;
			$("#acct-code-form").hidden = false;
			if (result.debugCode) $("#acct-code").value = result.debugCode; // local development only
			$("#acct-code").focus();
		} catch (error) {
			accountError(error);
		} finally {
			button.disabled = false;
		}
	});

	$("#acct-code-form").addEventListener("submit", async (event) => {
		event.preventDefault();
		const button = event.submitter;
		button.disabled = true;
		accountError();
		try {
			await enterCode($("#acct-code").value);
			$("#acct-code").value = "";
			$("#acct-code-form").hidden = true;
			$("#acct-email-form").hidden = false;
			await afterAccountChange();
		} catch (error) {
			accountError(error);
		} finally {
			button.disabled = false;
		}
	});

	$("#acct-again").addEventListener("click", () => {
		$("#acct-code-form").hidden = true;
		$("#acct-email-form").hidden = false;
		$("#acct-email").focus();
	});

	$("#acct-sync").addEventListener("click", async () => {
		await syncNow();
		await checkAccount();
		renderAccountDialog();
	});

	$("#acct-agent").addEventListener("click", () => {
		dialog.close();
		openAgent();
	});

	$("#acct-signout").addEventListener("click", async () => {
		await signOut().catch(accountError);
		await afterAccountChange();
	});

	const remove = $("#acct-delete");
	remove.addEventListener("click", async () => {
		if (!remove.dataset.confirm) {
			remove.dataset.confirm = "1";
			remove.textContent = "Tap again to delete";
			setTimeout(() => {
				delete remove.dataset.confirm;
				remove.textContent = "Delete account";
			}, 5000);
			return;
		}
		remove.disabled = true;
		try {
			await api("/api/me", { method: "DELETE" });
			await afterAccountChange();
		} catch (error) {
			accountError(error);
		} finally {
			delete remove.dataset.confirm;
			remove.textContent = "Delete account";
			remove.disabled = false;
		}
	});
}

// ---------------------------------------------------------------- agent dialog

const mcpAddress = () => account()?.mcp ?? `${location.origin}/mcp`;

/** How to connect an AI agent: remote MCP (needs sync) or WebMCP (this browser). */
function openAgent() {
	const address = mcpAddress();
	$("#agent-mcp").textContent = address.replace(/^https?:\/\//, "");
	$("#agent-cli").textContent = `claude mcp add --transport http walk ${address}`;
	const step = $("#agent-step-sync");
	if (signedIn()) {
		step.textContent = `Cloud sync is on, as ${account().email}. Your assistant reads walks from there.`;
	} else {
		step.innerHTML = "";
		const button = document.createElement("button");
		button.className = "linkish";
		button.type = "button";
		button.textContent = "sign in";
		button.addEventListener("click", () => {
			$("#agent-dialog").close();
			openAccount();
		});
		step.append("Turn on cloud sync: ", button, ". Your assistant reads walks from there.");
	}
	$("#agent-start").value = ui.startMode;
	$("#agent-dialog").showModal();
}

function wireAgent() {
	const dialog = $("#agent-dialog");
	dialog.addEventListener("click", (event) => {
		if (event.target === event.currentTarget) dialog.close(); // backdrop
	});
	$("#agent-start").addEventListener("change", (event) => agentSurface.setStartMode(event.target.value));
	const chip = $("#agent-copy");
	chip.addEventListener("click", async () => {
		const icon = chip.querySelector("i");
		try {
			await navigator.clipboard.writeText(mcpAddress());
			icon.className = "ph-bold ph-check";
			chip.title = "Copied";
			setTimeout(() => {
				icon.className = "ph-bold ph-copy";
				chip.title = "Copy to clipboard";
			}, 1600);
		} catch {
			getSelection().selectAllChildren($("#agent-mcp"));
		}
	});
}

// ---------------------------------------------------------------- reset

function openReset() {
	if (tracker.session) return message("Stop the walk before resetting.");
	const count = ui.sessions.length;
	const walks = `${int.format(count)} ${count === 1 ? "walk" : "walks"}`;
	$("#reset-text").textContent = signedIn()
		? `This deletes all your walks: the ${walks} in this browser, every walk in your Walk account, and the copies in your other signed-in browsers when they next sync.`
		: `This deletes the ${walks} saved in this browser, with their per-second readings.`;
	$("#reset-error").textContent = "";
	$("#reset-confirm").disabled = false;
	$("#reset-dialog").showModal();
}

async function confirmReset() {
	const button = $("#reset-confirm");
	button.disabled = true;
	try {
		await resetAll();
		$("#reset-dialog").close();
		await loadSessions();
		message("All walks deleted.");
	} catch (error) {
		$("#reset-error").textContent = error.message;
		button.disabled = false;
	}
}

// ---------------------------------------------------------------- actions

function guarded(fn) {
	return () => {
		try {
			fn();
		} catch (error) {
			message(error.message);
		}
	};
}

const actions = {
	async connect() {
		const button = $("#connect");
		if (pad.connected) {
			// Disconnecting ends control of a moving belt: ask once more.
			if (!button.dataset.confirm) {
				button.dataset.confirm = "1";
				button.querySelector("span").textContent = "Disconnect?";
				setTimeout(() => {
					if (!button.dataset.confirm) return;
					delete button.dataset.confirm;
					renderConnection(pad.connected);
				}, 3000);
				return;
			}
			return pad.disconnect();
		}
		try {
			await pad.pick();
		} catch (error) {
			if (error.name !== "NotFoundError") message(error.message);
		}
	},
	start: guarded(() => {
		primeChime(); // a tap now lets the timer chime later
		applySpeed();
	}),
	pause: guarded(() => pad.pause()),
	stop: guarded(() => pad.stop()),
	slower: () => setTarget(ui.target - STEP, { send: isMoving() }),
	faster: () => setTarget(ui.target + STEP, { send: isMoving() }),
};

function onKey(event) {
	if (event.target.closest("input, textarea, select")) return;
	if (!pad.connected) return;
	const handlers = {
		" ": () => (isMoving() ? actions.pause() : actions.start()),
		ArrowUp: actions.faster,
		ArrowDown: actions.slower,
		Escape: actions.stop,
	};
	const handler = handlers[event.key];
	if (!handler) return;
	event.preventDefault();
	handler();
}

// ---------------------------------------------------------------- agents (WebMCP)

const r2 = (n) => Math.round(n * 100) / 100;
const walkTotals = (t) => ({
	distanceKm: r2(t.distance),
	seconds: Math.round(t.seconds),
	steps: t.steps,
	calories: t.calories,
});
const walkInfo = (s) =>
	s && {
		start: new Date(s.start).toISOString(),
		end: s.end ? new Date(s.end).toISOString() : null,
		...walkTotals(s.totals),
		topSpeed: s.maxSpeed,
	};
const dayInfo = (d) => ({ ...walkTotals(d), walks: d.walks });
function timerInfo() {
	const timer = ui.timer;
	if (timer.kind === "off") return { kind: "off" };
	const totals = tracker.session?.totals;
	return {
		kind: timer.kind,
		amount: amount(timer),
		unit: KINDS[timer.kind].unit,
		atEnd: timer.end,
		remaining: totals ? r2(Math.max(0, goal(timer) - done(timer, totals)) / (timer.kind === "time" ? 60 : 1)) : null,
	};
}

const agentSurface = {
	status: () => ({
		connected: pad.connected,
		pad: pad.connected ? pad.device?.name ?? null : null,
		state: pad.connected ? ui.state : "offline",
		speed: ui.status?.speed ?? 0,
		target: ui.target,
		minSpeed: MIN_SPEED,
		maxSpeed: ui.maxSpeed,
		currentWalk: tracker.session ? walkInfo(tracker.session) : null,
		timer: timerInfo(),
		startNeedsApproval: ui.startMode === "ask",
	}),
	setTimer: (timer) => {
		setTimer(timer);
		return timerInfo();
	},
	summary: () => {
		const others = ui.sessions.filter((s) => s.id !== tracker.session?.id);
		const s = summarize(tracker.session ? [tracker.session, ...others] : others);
		return {
			today: dayInfo(s.today),
			goalKm: ui.goal,
			goalProgress: r2(s.today.distance / ui.goal),
			yesterday: dayInfo(s.yesterday),
			thisWeek: dayInfo(s.thisWeek),
			changeVersusLastWeek: s.weekDelta === null ? null : r2(s.weekDelta),
			streakDays: s.streak,
			activeDaysLast30: s.activeDays30,
			lifetime: dayInfo(s.lifetime),
			records: {
				longestDistance: walkInfo(s.records.longest),
				longestTime: walkInfo(s.records.longestTime),
				fastest: walkInfo(s.records.fastest),
			},
		};
	},
	recentWalks: (limit) => ui.sessions.slice(0, limit).map(walkInfo),
	start: (kmh) => {
		setTarget(kmh);
		pad.start(ui.target);
	},
	setSpeed: (kmh) => setTarget(kmh, { send: true }),
	setTarget: (kmh) => setTarget(kmh),
	pause: () => pad.pause(),
	stop: () => pad.stop(),
	setGoal: async (km) => {
		ui.goal = km;
		$("#goal").value = km;
		await saveGoal(km);
		renderDashboard(ui.sessions);
	},
	getStartMode: () => ui.startMode,
	setStartMode: (mode) => {
		ui.startMode = mode === "auto" ? "auto" : "ask";
		setSetting("agentStart", ui.startMode);
	},
};

// ---------------------------------------------------------------- sync

async function saveGoal(km) {
	await setSetting("goal", km);
	await setSetting("goalUpdated", Date.now());
	syncNow();
}

const timeOfDay = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

/** The sync row in the menu, and a dot on the menu button when sync failed. */
function renderAccount(state) {
	const icons = { off: "ph-cloud-slash", synced: "ph-cloud-check", syncing: "ph-cloud-arrow-up", failed: "ph-cloud-warning", offline: "ph-cloud-x" };
	const email = account()?.email ?? "";
	const titles = { off: "Sync and assistants", synced: "Synced", syncing: "Syncing…", failed: "Sync failed", offline: "Offline" };
	const notes = {
		off: "Sign in to sync your walks and connect an AI assistant",
		synced: `${email}, ${timeOfDay.format(new Date())}. Account and assistants`,
		syncing: email,
		failed: `${email}. Try again, or open your account`,
		offline: `${email}. Syncs when you're back online`,
	};
	$("#menu-sync-icon").className = `ph ${icons[state]}`;
	$("#menu-sync-title").textContent = titles[state];
	$("#menu-sync-note").textContent = notes[state];
	$("#menu-sync-now").hidden = state === "off";
	$("#menu-account").dataset.state = state;
	$("#menu-btn").dataset.sync = state;
}

/** Sync if signed in and online. Never during a walk: the walk syncs when it ends. */
async function syncNow() {
	if (!signedIn() || tracker.session) return;
	if (!navigator.onLine) return renderAccount("offline");
	renderAccount("syncing");
	try {
		const result = await sync();
		if (!signedIn()) return renderAccount("off");
		if (result.goal !== null) {
			ui.goal = result.goal;
			$("#goal").value = ui.goal;
		}
		if (result.walks || result.goal !== null) await loadSessions();
		renderAccount("synced");
	} catch (error) {
		// No connection is not a failure: sync catches up when it's back.
		if (error instanceof TypeError || !navigator.onLine) return renderAccount("offline");
		console.warn("Walk: sync failed", error);
		renderAccount("failed");
	}
}

// ---------------------------------------------------------------- init

async function init() {
	applyTheme(currentTheme());
	renderHeadline();
	renderState();

	if (!navigator.bluetooth) {
		$("#unsupported").hidden = false;
		$("#connect").disabled = true;
	}

	ui.presets = await getSetting("presets", DEFAULT_PRESETS);
	ui.goal = await getSetting("goal", 5);
	ui.startMode = await getSetting("agentStart", "ask");
	$("#goal").value = ui.goal;
	ui.timer = normalize(await getSetting("timer", DEFAULT_TIMER));
	renderTimer();
	setTarget(await getSetting("target", 3));
	await tracker.finishStale();
	await loadSessions();

	pad.addEventListener("connection", (e) => renderConnection(e.detail.connected));
	pad.addEventListener("status", (e) => tracker.update(e.detail));
	pad.addEventListener("log", (e) => message(e.detail));
	tracker.addEventListener("progress", (e) => renderLive(e.detail));
	tracker.addEventListener("ended", () => {
		ui.spark = [];
		renderSpark();
		loadSessions();
		syncNow();
	});

	const menu = $("#menu");
	$("#menu-btn").addEventListener("click", () => menu.showModal());
	for (const dialog of [menu, $("#about"), $("#reset-dialog"), $("#import-dialog"), $("#day-dialog")]) {
		dialog.addEventListener("click", (event) => {
			if (event.target === event.currentTarget) event.currentTarget.close(); // backdrop
		});
	}
	// Every menu action closes the menu; the theme stays open to compare.
	menu.addEventListener("click", (event) => {
		// Import waits for its file: closing now could drop the file picker.
		const item = event.target.closest(".menu-item");
		if (item && item.tagName !== "LABEL") menu.close();
	});
	for (const choice of document.querySelectorAll("[data-theme-choice]")) {
		choice.addEventListener("click", () => applyTheme(choice.dataset.themeChoice));
	}
	$("#info").addEventListener("click", () => $("#about").showModal());
	$("#menu-sync-now").addEventListener("click", syncNow);
	$("#menu-account").addEventListener("click", openAccount);
	$("#menu-agent").addEventListener("click", openAgent);
	wireAccount();
	wireAgent();
	wireTimer();
	wireImport();
	wireDetails();
	$("#connect").addEventListener("click", actions.connect);
	$("#start").addEventListener("click", actions.start);
	$("#pause").addEventListener("click", actions.pause);
	$("#stop").addEventListener("click", actions.stop);
	$("#slower").addEventListener("click", actions.slower);
	$("#faster").addEventListener("click", actions.faster);
	$("#speed-form").addEventListener("submit", (event) => {
		event.preventDefault();
		setTarget(Number($("#speed").value) || ui.target, { send: pad.connected });
	});
	$("#save-preset").addEventListener("click", () => savePresets([...ui.presets, ui.target]));
	$("#goal").addEventListener("change", async () => {
		ui.goal = Math.max(0.5, Number($("#goal").value) || 5);
		await saveGoal(ui.goal);
		renderDashboard(ui.sessions);
	});
	$("#export").addEventListener("click", exportHistory);
	$("#reset").addEventListener("click", openReset);
	$("#reset-cancel").addEventListener("click", () => $("#reset-dialog").close());
	$("#reset-export").addEventListener("click", exportHistory);
	$("#reset-confirm").addEventListener("click", confirmReset);
	$("#export-csv").addEventListener("click", exportCsv);
	$("#import").addEventListener("change", (event) => {
		const [file] = event.target.files;
		menu.close();
		if (file) importHistory(file);
		event.target.value = "";
	});
	document.addEventListener("keydown", onKey);

	// Day rollover and greeting refresh.
	setInterval(() => {
		renderHeadline();
		if (!tracker.session) renderDashboard(ui.sessions);
	}, 60000);

	pad.reconnect().catch(() => {});

	// Signing in and managing the account happen in a dialog on this page:
	// Walk never navigates away, so the pad stays connected.
	renderAccount("off");
	const accountChanged = async () => {
		if (await checkAccount()) syncNow();
		else renderAccount("off");
	};
	await accountChanged();
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState !== "visible") return;
		if (signedIn()) syncNow();
		else accountChanged();
	});

	// Back online: catch up.
	window.addEventListener("online", () => syncNow());

	// Installed, Walk opens and runs the pad without internet (sw.js).
	navigator.serviceWorker?.register("/app/sw.js", { scope: "/app/" }).catch((error) => console.warn("Walk: offline support unavailable", error));

	// Leaving or reloading this page drops the Bluetooth connection.
	window.addEventListener("beforeunload", (event) => {
		if (pad.connected) event.preventDefault();
	});
	setInterval(syncNow, 10 * 60 * 1000);
	registerAgentTools(agentSurface).catch((error) => console.warn("Walk: agent tools unavailable", error));
}

init();
