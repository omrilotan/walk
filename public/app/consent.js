// Sign in on the page where an assistant asks to connect; then the same
// page shows the request to approve.

import { enterCode, requestCode } from "./auth.js";

const $ = (selector) => document.querySelector(selector);

$("#email-form").addEventListener("submit", async (event) => {
	event.preventDefault();
	const button = event.submitter;
	button.disabled = true;
	$("#error").textContent = "";
	try {
		const email = $("#email").value.trim();
		const result = await requestCode(email, $("#consent").checked);
		$("#sent-to").textContent = email;
		$("#email-form").hidden = true;
		$("#code-form").hidden = false;
		if (result.debugCode) $("#code").value = result.debugCode; // local development only
		$("#code").focus();
	} catch (error) {
		$("#error").textContent = error.message;
	} finally {
		button.disabled = false;
	}
});

$("#code-form").addEventListener("submit", async (event) => {
	event.preventDefault();
	const button = event.submitter;
	button.disabled = true;
	$("#error").textContent = "";
	try {
		await enterCode($("#code").value);
		location.reload(); // now signed in: the page shows the request
	} catch (error) {
		$("#error").textContent = error.message;
		button.disabled = false;
	}
});
