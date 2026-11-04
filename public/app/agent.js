// WebMCP tools: lets an AI agent in the browser read your walks and drive the pad.
//
// Registered only where the browser offers a model context (document.modelContext,
// or navigator.modelContext in older previews). Elsewhere this module does nothing.
//
// Safety:
// - Pause and stop always run right away.
// - Starting the belt follows the user's choice: "ask" (default) shows an Allow /
//   Always allow / Deny bar and waits for a tap; "auto" starts right away.
//   Always allow switches to "auto"; the setting lives in the Connect your AI
//   agent dialog.
// - One speed change moves the target by at most MAX_STEP km/h.
// - Connecting needs a user gesture, so agents cannot connect the pad.

const MAX_STEP = 1;
const APPROVAL_TIMEOUT_MS = 60000;

const $ = (selector) => document.querySelector(selector);
const round1 = (n) => Math.round(n * 10) / 10;
const json = (value) => JSON.stringify(value);

export function modelContext() {
	return document.modelContext ?? navigator.modelContext ?? null;
}

/**
 * @param {object} walk - The app's control surface:
 *   status(), summary(), recentWalks(limit), start(kmh), setSpeed(kmh), setTarget(kmh),
 *   pause(), stop(), setGoal(km), getStartMode(), setStartMode(mode).
 */
export async function registerAgentTools(walk) {
	const context = modelContext();
	if (!context?.registerTool) return false;

	const panel = $("#agent");
	panel.hidden = false;
	// The setting itself is wired by the app (Connect your AI agent dialog).
	const mode = $("#agent-start");

	const notConnected = () => "The pad is not connected. Ask the user to press Connect in Walk.";

	const tools = [
		{
			name: "get_status",
			description:
				"Current pad and walk state: whether the pad is connected, state (offline, stopped, starting, running, paused), current and target speed in km/h, the pad's max speed, the current walk's totals (distance km, seconds, steps, calories), and whether starting needs the user's approval.",
			inputSchema: { type: "object", properties: {} },
			annotations: { readOnlyHint: true },
			execute: async () => json(walk.status()),
		},
		{
			name: "get_summary",
			description:
				"Walking stats from local history: today (distance km, seconds, steps, calories, walks), the daily goal in km and progress toward it, yesterday, this week, change versus last week, streak in days, active days in the last 30, lifetime totals, and personal records.",
			inputSchema: { type: "object", properties: {} },
			annotations: { readOnlyHint: true },
			execute: async () => json(walk.summary()),
		},
		{
			name: "get_recent_walks",
			description: "The most recent walks, newest first, with start and end time, distance, duration, steps, calories and top speed.",
			inputSchema: {
				type: "object",
				properties: { limit: { type: "integer", minimum: 1, maximum: 50, description: "How many walks. Default 10." } },
			},
			annotations: { readOnlyHint: true },
			execute: async ({ limit = 10 } = {}) => json(walk.recentWalks(limit)),
		},
		{
			name: "start_walk",
			description:
				"Starts the belt, or resumes a paused walk. The user may have chosen to approve every start: then Walk asks them on screen and this call waits up to a minute for their answer. Tell the user to step on carefully.",
			inputSchema: {
				type: "object",
				properties: { speed: { type: "number", description: "Speed in km/h. Default: the current target speed." } },
			},
			annotations: { consequentialHint: true },
			execute: async ({ speed } = {}, { signal } = {}) => {
				const s = walk.status();
				if (!s.connected) return notConnected();
				if (s.state === "running" || s.state === "starting") return `Already moving at ${s.speed} km/h.`;
				const kmh = round1(speed ?? s.target);
				if (!(kmh >= s.minSpeed && kmh <= s.maxSpeed)) {
					return `Speed must be between ${s.minSpeed} and ${s.maxSpeed} km/h.`;
				}
				if (walk.getStartMode() === "ask") {
					const verb = s.state === "paused" ? "resume" : "start";
					const answer = await approve(`An agent wants to ${verb} the belt at ${kmh.toFixed(1)} km/h.`, signal);
					if (!answer) return "The user did not allow the start. Do not retry unless they ask.";
					if (answer === "always") {
						walk.setStartMode("auto");
						mode.value = "auto";
					}
				}
				walk.start(kmh);
				return `Start sent at ${kmh.toFixed(1)} km/h. The belt ramps up over a few seconds.`;
			},
		},
		{
			name: "set_speed",
			description: `Sets the target speed in km/h. While walking, the belt changes speed; one call moves it by at most ${MAX_STEP} km/h, so call again to go further. While stopped or paused, only the target changes and the belt does not start.`,
			inputSchema: {
				type: "object",
				properties: { speed: { type: "number", description: "Target speed in km/h." } },
				required: ["speed"],
			},
			annotations: { consequentialHint: true },
			execute: async ({ speed }) => {
				const s = walk.status();
				if (typeof speed !== "number" || Number.isNaN(speed)) return "Give a speed in km/h.";
				let kmh = round1(Math.min(s.maxSpeed, Math.max(s.minSpeed, speed)));
				const moving = s.state === "running" || s.state === "starting";
				if (!moving) {
					walk.setTarget(kmh);
					return `Target set to ${kmh.toFixed(1)} km/h. The belt is not moving; use start_walk to start.`;
				}
				if (!s.connected) return notConnected();
				const from = s.target || s.speed;
				const capped = Math.abs(kmh - from) > MAX_STEP;
				if (capped) kmh = round1(from + Math.sign(kmh - from) * MAX_STEP);
				walk.setSpeed(kmh);
				return capped
					? `Changed to ${kmh.toFixed(1)} km/h, the most one step allows. Call again to continue.`
					: `Changed to ${kmh.toFixed(1)} km/h.`;
			},
		},
		{
			name: "pause_walk",
			description: "Pauses the belt right away. The walk stays open and can be resumed with start_walk.",
			inputSchema: { type: "object", properties: {} },
			execute: async () => {
				if (!walk.status().connected) return notConnected();
				walk.pause();
				return "Pause sent.";
			},
		},
		{
			name: "stop_walk",
			description: "Stops the belt right away and ends the walk, which is saved to history.",
			inputSchema: { type: "object", properties: {} },
			execute: async () => {
				if (!walk.status().connected) return notConnected();
				walk.stop();
				return "Stop sent. The walk is saved when the belt stops.";
			},
		},
		{
			name: "set_goal",
			description: "Sets the daily distance goal in km. Ask the user before changing it.",
			inputSchema: {
				type: "object",
				properties: { km: { type: "number", minimum: 0.5, maximum: 50, description: "Daily goal in km." } },
				required: ["km"],
			},
			annotations: { consequentialHint: true },
			execute: async ({ km }) => {
				if (!(km >= 0.5 && km <= 50)) return "The goal must be between 0.5 and 50 km.";
				await walk.setGoal(km);
				return `Daily goal set to ${km} km.`;
			},
		},
	];

	for (const tool of tools) {
		try {
			await context.registerTool(tool);
		} catch (error) {
			console.warn(`Walk: could not register ${tool.name}`, error);
		}
	}
	return true;
}

// ---------------------------------------------------------------- approval bar

let cancelPending = null;

/** Shows the Allow / Always allow / Deny bar. Resolves "once", "always", or false. */
function approve(text, signal) {
	cancelPending?.(); // a newer request replaces an older one
	const bar = $("#agent-ask");
	$("#agent-ask-text").textContent = text;
	bar.hidden = false;
	$("#agent-allow").focus();

	return new Promise((resolve) => {
		const finish = (allowed) => {
			bar.hidden = true;
			clearTimeout(timer);
			$("#agent-allow").removeEventListener("click", onAllow);
			$("#agent-always").removeEventListener("click", onAlways);
			$("#agent-deny").removeEventListener("click", onDeny);
			signal?.removeEventListener("abort", onDeny);
			cancelPending = null;
			resolve(allowed);
		};
		const onAllow = () => finish("once");
		const onAlways = () => finish("always");
		const onDeny = () => finish(false);
		const timer = setTimeout(onDeny, APPROVAL_TIMEOUT_MS);
		$("#agent-allow").addEventListener("click", onAllow);
		$("#agent-always").addEventListener("click", onAlways);
		$("#agent-deny").addEventListener("click", onDeny);
		signal?.addEventListener("abort", onDeny);
		cancelPending = onDeny;
	});
}
