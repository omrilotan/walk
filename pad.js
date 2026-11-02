// PitPat walking pad over Web Bluetooth.
//
// Protocol (from KeiranY/PitPat-WebBT and Razzolate99/pitpat-treadmill, confirmed
// on a PitPat-T01 advertising as "Mindtree-HID"):
// - Service FBA0, write FBA1, notify FBA2. Some models use FFFF / FF01 / FF02.
// - The pad streams status about twice a second and expects one write per
//   status: the next pending command, or a heartbeat.
// - Command, 23 bytes: 6A 17 00 00 00 00 <speed u16 BE, 0.001 km/h> <ramp: 1 start
//   or stop, 5 speed change> <incline> <weight> 00 <cmd: 4 run, 2 pause, 0 stop>
//   <user id u64 BE> <xor of bytes 1..20> 43
//
// Events: "connection" { connected }, "status" { state, speed, target, … }, "log" string.

const uuid = (n) => `0000${n.toString(16)}-0000-1000-8000-00805f9b34fb`;

const LAYOUTS = [
	{ service: uuid(0xfba0), write: uuid(0xfba1), notify: uuid(0xfba2) },
	{ service: uuid(0xffff), write: uuid(0xff01), notify: uuid(0xff02) },
];

const HEARTBEAT = Uint8Array.of(0x6a, 0x05, 0xfd, 0xf8, 0x43);
const USER_ID = 58965456623n; // constant from the public packet format
const CMD = { stop: 0, pause: 2, run: 4 };
const STATES = { 24: "starting", 8: "running", 16: "paused" }; // byte 26 & 0x18
const SEND_DIRECTLY_AFTER_MS = 2000;
const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 20000];
const DEVICE_KEY = "walk:deviceId";

function frame(cmd, kmh = 0, ramp = 1) {
	const speed = Math.round(kmh * 1000);
	const bytes = new Uint8Array(23);
	bytes.set([0x6a, 0x17]);
	bytes[6] = speed >> 8;
	bytes[7] = speed & 0xff;
	bytes[8] = ramp;
	bytes[10] = 80; // weight, kg
	bytes[12] = cmd;
	for (let i = 0; i < 8; i++) bytes[13 + i] = Number((USER_ID >> BigInt(56 - i * 8)) & 0xffn);
	bytes[21] = bytes.slice(1, 21).reduce((a, b) => a ^ b, 0);
	bytes[22] = 0x43;
	return bytes;
}

function decode(bytes) {
	if (bytes.length < 31) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return {
		state: STATES[bytes[26] & 0x18] ?? "stopped",
		speed: view.getUint16(3) / 1000,
		target: view.getUint16(5) / 1000,
		distance: view.getUint32(7) / 1000, // km
		// Bytes 14..17 stay 0 on the T01; a u16 at 43 counts steps instead, but
		// only in the 50-byte (0x32) frame. Other frames carry the serial number
		// there, so leave steps undefined and let the tracker keep the last value.
		steps: view.getUint32(14) || (bytes[1] === 0x32 ? view.getUint16(43) : undefined),
		calories: view.getUint16(18),
		seconds: Math.round(view.getUint32(20) / 1000),
		maxSpeed: view.getUint16(27) / 1000,
	};
}

export class Pad extends EventTarget {
	device = null;
	writeChar = null;
	pending = null;
	queue = Promise.resolve();
	writing = false;
	wantConnected = false;

	get connected() {
		return Boolean(this.device?.gatt.connected && this.writeChar);
	}

	emit(type, detail) {
		this.dispatchEvent(new CustomEvent(type, { detail }));
	}

	/** Opens the browser's device picker; call from a user gesture. */
	async pick() {
		const device = await navigator.bluetooth.requestDevice({
			filters: [
				...LAYOUTS.map(({ service }) => ({ services: [service] })),
				{ namePrefix: "Mindtree" },
				{ namePrefix: "PitPat" },
			],
			optionalServices: LAYOUTS.map(({ service }) => service),
		});
		await this.attach(device);
	}

	/** Reconnects to a pad allowed earlier, where the browser supports it. */
	async reconnect() {
		if (!navigator.bluetooth?.getDevices) return;
		const devices = await navigator.bluetooth.getDevices();
		const device = devices.find((d) => d.id === localStorage.getItem(DEVICE_KEY)) ?? devices[0];
		if (device) await this.attach(device);
	}

	async attach(device) {
		this.device = device;
		this.wantConnected = true;
		device.removeEventListener("gattserverdisconnected", this.onDisconnected);
		device.addEventListener("gattserverdisconnected", this.onDisconnected);

		const server = await device.gatt.connect();
		for (const layout of LAYOUTS) {
			const service = await server.getPrimaryService(layout.service).catch(() => null);
			if (!service) continue;
			this.writeChar = await service.getCharacteristic(layout.write);
			const notify = await service.getCharacteristic(layout.notify);
			notify.removeEventListener("characteristicvaluechanged", this.onNotify);
			notify.addEventListener("characteristicvaluechanged", this.onNotify);
			await notify.startNotifications();
			try {
				localStorage.setItem(DEVICE_KEY, device.id);
			} catch {}
			this.emit("connection", { connected: true });
			return;
		}
		device.gatt.disconnect();
		throw new Error("This device is not a supported walking pad");
	}

	disconnect() {
		this.wantConnected = false;
		this.device?.gatt.disconnect();
	}

	onDisconnected = async () => {
		this.writeChar = null;
		this.pending = null;
		this.emit("connection", { connected: false });
		for (const delay of RECONNECT_DELAYS_MS) {
			if (!this.wantConnected) return;
			this.emit("log", `Connection lost. Retrying in ${delay / 1000}s.`);
			await new Promise((resolve) => setTimeout(resolve, delay));
			if (!this.wantConnected || this.connected) return;
			try {
				return await this.attach(this.device);
			} catch {}
		}
		if (this.wantConnected) this.emit("log", "Could not reconnect. Press Connect.");
	};

	onNotify = (event) => {
		// Answer every status with the pending command or a heartbeat.
		if (this.pending) {
			this.write(this.pending);
			this.pending = null;
		} else if (!this.writing) {
			this.write(HEARTBEAT);
		}
		const status = decode(new Uint8Array(event.target.value.buffer));
		if (status) this.emit("status", status);
	};

	write(bytes) {
		const char = this.writeChar;
		if (!char) return;
		this.writing = true;
		this.queue = this.queue
			.then(() => char.writeValueWithResponse(bytes))
			.catch((error) => this.emit("log", `Write failed: ${error.message}`))
			.finally(() => (this.writing = false));
	}

	send(bytes) {
		if (!this.connected) throw new Error("Pad not connected");
		this.pending = bytes; // newest command wins
		setTimeout(() => {
			if (this.pending !== bytes) return; // already sent with a status reply
			this.pending = null;
			this.write(bytes);
		}, SEND_DIRECTLY_AFTER_MS);
	}

	start(kmh) {
		this.send(frame(CMD.run, kmh, 1));
	}

	setSpeed(kmh) {
		this.send(frame(CMD.run, kmh, 5));
	}

	pause() {
		this.send(frame(CMD.pause));
	}

	stop() {
		this.send(frame(CMD.stop));
	}
}
