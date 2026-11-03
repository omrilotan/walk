import { deleteSession, exportAll, getSessions, getSetting, importAll, setSetting } from "./db.js";
import { Pad } from "./pad.js";
import { areaChart, barChart, heatmap } from "./charts.js";
import { clock, fmt, int, km, minutes } from "./format.js";
import { summarize } from "./stats.js";
import { Tracker } from "./tracker.js";
import { registerAgentTools } from "./agent.js";

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
};

const round1 = (n) => Math.round(n * 10) / 10;
const clampSpeed = (kmh) => round1(Math.min(ui.maxSpeed, Math.max(MIN_SPEED, kmh)));
function message(text) {
	$("#message").textContent = text;
}

// ---------------------------------------------------------------- theme

const THEMES = ["auto", "light", "dark"];
const THEME_ICONS = { auto: "ph-circle-half", light: "ph-sun", dark: "ph-moon" };

function applyTheme(theme) {
	if (theme === "auto") delete document.documentElement.dataset.theme;
	else document.documentElement.dataset.theme = theme;
	const button = $("#theme");
	button.title = `Theme: ${theme}`;
	button.querySelector("i").className = `ph ${THEME_ICONS[theme]}`;
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
	const chip = $("#connection");
	chip.dataset.connected = String(connected);
	chip.querySelector("i").className = connected ? "ph-bold ph-bluetooth-connected" : "ph-bold ph-bluetooth-slash";
	chip.querySelector("span").textContent = connected ? pad.device?.name ?? "Connected" : "Not connected";
	$("#connect").dataset.connected = String(connected);
	$("#connect").querySelector("span").textContent = connected ? "Disconnect" : "Connect";
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
			<div class="day" data-today="${d.today}" data-future="${d.future}">
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
		["Lifetime distance", `${km(s.lifetime.distance)} km`, `${int.format(s.lifetime.walks)} walks`],
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
			await deleteSession(session.id);
			loadSessions();
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

async function importHistory(file) {
	try {
		const result = await importAll(JSON.parse(await file.text()));
		message(`Imported: ${result.added} new, ${result.updated} updated, ${result.skipped} already here.`);
		await loadSessions();
	} catch (error) {
		message(`Import failed: ${error.message}`);
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
		if (pad.connected) return pad.disconnect();
		try {
			await pad.pick();
		} catch (error) {
			if (error.name !== "NotFoundError") message(error.message);
		}
	},
	start: guarded(() => applySpeed()),
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
		startNeedsApproval: ui.startMode === "ask",
	}),
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
		await setSetting("goal", km);
		renderDashboard(ui.sessions);
	},
	getStartMode: () => ui.startMode,
	setStartMode: (mode) => {
		ui.startMode = mode === "auto" ? "auto" : "ask";
		setSetting("agentStart", ui.startMode);
	},
};

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
	});

	$("#info").addEventListener("click", () => $("#about").showModal());
	$("#about").addEventListener("click", (event) => {
		if (event.target === event.currentTarget) event.currentTarget.close(); // backdrop
	});
	$("#theme").addEventListener("click", () => {
		const next = THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length];
		applyTheme(next);
	});
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
		await setSetting("goal", ui.goal);
		renderDashboard(ui.sessions);
	});
	$("#export").addEventListener("click", exportHistory);
	$("#export-csv").addEventListener("click", exportCsv);
	$("#import").addEventListener("change", (event) => {
		const [file] = event.target.files;
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
	registerAgentTools(agentSurface).catch((error) => console.warn("Walk: agent tools unavailable", error));
}

init();
