// WebMCP tools: lets an AI agent in the browser read your walks and drive the pad.
//
// Registered only where the browser offers a model context (document.modelContext,
// or navigator.modelContext in older previews). Elsewhere this module does nothing.
// The tools are also reachable under the old name, navigator.modelContext, for
// agents that still look there (aliasLegacy), and as plain data on
// window.walkTools for agents that run scripts in the page (plainSurface).
//
// Safety:
// - Pause and stop always run right away.
// - Starting the belt follows the user's choice: "ask" (default) shows an Allow /
//   Always allow / Deny bar and waits for a tap; "auto" starts right away.
//   Always allow switches to "auto"; the setting lives in the Connect your AI
//   agent dialog.
// - One speed change moves the target by at most MAX_STEP km/h.
// - Connecting needs a user gesture, so agents cannot connect the pad.
// - Adding, correcting and restoring a walk run right away, and the page says
//   what the agent did. Deleting a walk asks the user first, every time: there
//   is no "always allow" for it. A deleted walk waits in Deleted walks, where
//   the user can restore it (walks.js TRASH_DAYS).

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
 *   pause(), stop(), setGoal(km), setTimer(timer), getStartMode(), setStartMode(mode),
 *   describeWalk(id), addWalk(input), editWalk(id, changes), deleteWalk(id),
 *   restoreWalk(id), deletedWalks(). The walk ones throw an Error whose message
 *   says what is wrong.
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
				"Current pad and walk state: whether the pad is connected, state (offline, stopped, starting, running, paused), current and target speed in km/h, the pad's max speed, the current walk's totals (distance km, seconds, steps, calories), the walk timer (remaining is in minutes or km), and whether starting needs the user's approval.",
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
			description:
				"The most recent walks, newest first, with start and end time, distance, duration, steps, calories and top speed. Each has an id, which edit_walk and delete_walk take. origin says a walk was added by hand (manual) or corrected (edited); byAssistant says an assistant did it.",
			inputSchema: {
				type: "object",
				properties: { limit: { type: "integer", minimum: 1, maximum: 50, description: "How many walks. Default 10." } },
			},
			annotations: { readOnlyHint: true },
			execute: async ({ limit = 10 } = {}) => json(walk.recentWalks(limit)),
		},
		{
			name: "add_walk",
			description:
				"Adds a walk the pad did not record, for example one Walk missed. Ask the user for the numbers; never guess them. Steps and calories left out are estimated from the user's own walks. The walk is marked as added by an assistant, counts in every total, and does not count toward personal records.",
			inputSchema: {
				type: "object",
				properties: {
					start: { type: "string", description: "When the walk started, in the user's local time: YYYY-MM-DDTHH:MM." },
					minutes: { type: "number", description: "Minutes walked." },
					distanceKm: { type: "number", description: "Distance in km." },
					steps: { type: "integer", description: "Steps. Optional." },
					calories: { type: "integer", description: "Calories. Optional." },
				},
				required: ["start", "minutes", "distanceKm"],
			},
			annotations: { consequentialHint: true },
			execute: async (input = {}) => {
				const start = startOf(input.start);
				if (start === null) return "Give start as YYYY-MM-DDTHH:MM, in the user's local time.";
				return attempt(async () => json(await walk.addWalk({ start, ...numbers(input) })));
			},
		},
		{
			name: "edit_walk",
			description:
				"Corrects a walk in history: its start, minutes walked, distance, steps or calories. Give the walk's id (from get_recent_walks) and only what changes. Ask the user before changing anything. The walk is marked as edited by an assistant and no longer counts toward personal records. The walk being recorded can't be changed.",
			inputSchema: {
				type: "object",
				properties: {
					id: { type: "string", description: "The walk's id." },
					start: { type: "string", description: "New start, in the user's local time: YYYY-MM-DDTHH:MM." },
					minutes: { type: "number", description: "Minutes walked." },
					distanceKm: { type: "number", description: "Distance in km." },
					steps: { type: "integer", description: "Steps." },
					calories: { type: "integer", description: "Calories." },
				},
				required: ["id"],
			},
			annotations: { consequentialHint: true },
			execute: async ({ id, ...input } = {}) => {
				const changes = numbers(input);
				if (input.start !== undefined) {
					changes.start = startOf(input.start);
					if (changes.start === null) return "Give start as YYYY-MM-DDTHH:MM, in the user's local time.";
				}
				if (!Object.keys(changes).length) return "Say what to change: start, minutes, distanceKm, steps or calories.";
				return attempt(async () => json(await walk.editWalk(id, changes)));
			},
		},
		{
			name: "delete_walk",
			description:
				"Deletes a walk from history. Walk asks the user on screen every time, and this call waits up to a minute for their answer. The walk goes to Deleted walks, where it can be restored for 30 days (restore_walk, or Menu, Deleted walks). The walk being recorded can't be deleted.",
			inputSchema: {
				type: "object",
				properties: { id: { type: "string", description: "The walk's id, from get_recent_walks." } },
				required: ["id"],
			},
			annotations: { consequentialHint: true, destructiveHint: true },
			execute: async ({ id } = {}, { signal } = {}) => {
				const what = walk.describeWalk(id);
				if (!what) return "There is no walk with that id. Use get_recent_walks to see ids.";
				const answer = await approve(`An agent wants to delete your walk of ${what}.`, signal, { always: false });
				if (!answer) return "The user did not allow the deletion. Do not retry unless they ask.";
				return attempt(async () => `Deleted: ${json(await walk.deleteWalk(id))}. It can be restored for 30 days.`);
			},
		},
		{
			name: "get_deleted_walks",
			description: "Walks deleted in this browser that can still be restored, with their ids and the days each has left.",
			inputSchema: { type: "object", properties: {} },
			annotations: { readOnlyHint: true },
			execute: async () => json(walk.deletedWalks()),
		},
		{
			name: "restore_walk",
			description: "Brings a deleted walk back into history. Give its id from get_deleted_walks. The restored walk has a new id.",
			inputSchema: {
				type: "object",
				properties: { id: { type: "string", description: "The deleted walk's id." } },
				required: ["id"],
			},
			annotations: { consequentialHint: true },
			execute: async ({ id } = {}) => attempt(async () => json(await walk.restoreWalk(id))),
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
		{
			name: "set_timer",
			description:
				"Sets the walk timer: when this walk reaches so many minutes, or so many km, Walk chimes, or pauses the belt and chimes. It counts the current walk's own totals, so time already walked counts and pauses don't. kind: time (amount in minutes), distance (amount in km), or off. atEnd: chime (the default) or pause. Tell the user what you set.",
			inputSchema: {
				type: "object",
				properties: {
					kind: { type: "string", enum: ["time", "distance", "off"] },
					amount: { type: "number", description: "Minutes for time, km for distance." },
					atEnd: { type: "string", enum: ["chime", "pause"], description: "What happens at the end. Default: the user's last choice." },
				},
				required: ["kind"],
			},
			annotations: { consequentialHint: true },
			execute: async ({ kind, amount, atEnd } = {}) => {
				if (!["time", "distance", "off"].includes(kind)) return "kind must be time, distance or off.";
				if (kind !== "off" && !(amount > 0)) return "Give an amount: minutes for time, km for distance.";
				const timer = { kind, ...(atEnd && { end: atEnd }) };
				if (kind === "time") timer.minutes = amount;
				if (kind === "distance") timer.km = amount;
				const set = walk.setTimer(timer);
				if (set.kind === "off") return "Timer off.";
				const end = set.atEnd === "pause" ? "pause the belt and chime" : "chime";
				return `Timer set: Walk will ${end} at ${set.amount} ${set.unit} of this walk.`;
			},
		},
	];

	const registered = [];
	for (const tool of tools) {
		try {
			await context.registerTool(tool);
			registered.push(tool.name);
		} catch (error) {
			console.warn(`Walk: could not register ${tool.name}`, error);
		}
	}
	aliasLegacy(context);
	window.walkTools = plainSurface(
		context,
		tools.filter((tool) => registered.includes(tool.name)),
	);
	// For an agent that reads the console to find its way in.
	console.info(
		`Walk: ${registered.length} WebMCP tools on document.modelContext (${registered.join(", ")}). From a script, read window.walkTools.tools and run one with await window.walkTools.run(name, input): both give plain data. getTools() returns objects that hold the window and cannot be serialized.`,
	);
	return true;
}

/** When a walk started, from "YYYY-MM-DDTHH:MM" in the user's own time, in ms; null if it isn't one. */
export function startOf(text) {
	if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text.trim())) return null;
	const t = new Date(text.trim().replace(" ", "T")).getTime();
	return Number.isFinite(t) ? t : null;
}

/** A tool's numbers, in the names the app uses. What the agent left out stays out. */
export function numbers({ minutes, distanceKm, steps, calories } = {}) {
	return {
		...(minutes !== undefined && { seconds: Math.round(minutes * 60) }),
		...(distanceKm !== undefined && { distance: distanceKm }),
		...(steps !== undefined && { steps }),
		...(calories !== undefined && { calories }),
	};
}

/** Runs a change to the walks; what the app refuses comes back as its own sentence. */
async function attempt(change) {
	try {
		return await change();
	} catch (error) {
		return error.message;
	}
}

/**
 * The same tools as plain data, for an agent that works by running scripts in
 * the page. The objects getTools() returns each hold the page's window, so
 * returning them from a script fails ("Converting circular structure to JSON")
 * or comes back empty, and the agent concludes there are no tools.
 *
 * tools is a plain list (name, description, inputSchema). run() goes through
 * the browser's own executeTool where there is one, so a tool behaves exactly
 * as it does for any other agent, and always answers with a string.
 */
export function plainSurface(context, tools) {
	const names = tools.map((tool) => tool.name);
	return {
		tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
		async run(name, input = {}) {
			const own = tools.find((tool) => tool.name === name);
			if (!own) return `No tool named ${name}. Tools: ${names.join(", ")}.`;
			const listed = context.executeTool && (await context.getTools?.())?.find((tool) => tool.name === name);
			const result = listed ? await context.executeTool(listed, input) : await own.execute(input, {});
			return typeof result === "string" ? result : JSON.stringify(result ?? null);
		},
	};
}

/**
 * WebMCP moved from navigator.modelContext to document.modelContext. An agent
 * that learned the early previews still looks on navigator, finds nothing and
 * concludes the page has no tools. Where the old name is free, point it at the
 * same context, so that agent finds the same tools.
 */
export function aliasLegacy(context, nav = navigator) {
	if (!context || nav.modelContext) return false;
	try {
		Object.defineProperty(nav, "modelContext", { value: context, configurable: true });
		return true;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------- approval bar

let cancelPending = null;

/**
 * Shows the Allow / Always allow / Deny bar. Resolves "once", "always", or false.
 * `always: false` leaves out Always allow: for what must be asked every time.
 */
function approve(text, signal, { always = true } = {}) {
	cancelPending?.(); // a newer request replaces an older one
	const bar = $("#agent-ask");
	$("#agent-ask-text").textContent = text;
	$("#agent-always").hidden = !always;
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
