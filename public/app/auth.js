// Sign-in by emailed code, from whatever page is open. Nothing navigates, so
// the Walk page never drops its Bluetooth connection to sign in.

// Ties a code to this browser: any Walk tab here can use it; the code alone
// signs in nowhere else.
function browserId() {
	try {
		let id = localStorage.getItem("walk:browser");
		if (!id) {
			const bytes = crypto.getRandomValues(new Uint8Array(24));
			id = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]);
			localStorage.setItem("walk:browser", id);
		}
		return id;
	} catch {
		// No storage: a fresh id still works within this page's lifetime.
		browserId.fallback ??= crypto.randomUUID().replaceAll("-", "");
		return browserId.fallback;
	}
}

export async function api(path, { method = "GET", body } = {}) {
	const response = await fetch(path, {
		method,
		headers: body ? { "content-type": "application/json" } : {},
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = await response.json().catch(() => ({}));
	if (!response.ok) {
		const error = new Error(data.title || "Something went wrong. Try again.");
		error.status = response.status;
		throw error;
	}
	return data;
}

/**
 * Emails a code. `consent` is the sign-in form's checkbox: agreement to the
 * terms and privacy notice. Returns { debugCode } only in local development.
 */
export const requestCode = (email, consent) =>
	api("/api/auth/start", { method: "POST", body: { email, browser: browserId(), consent } });

/** Signs in with the emailed code. Returns { email }. */
export const enterCode = (code) => api("/api/auth/code", { method: "POST", body: { browser: browserId(), code } });

export const signOut = () => api("/api/auth/signout", { method: "POST" });
