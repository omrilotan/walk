import type { Env } from "./env.ts";

/** The sign-in email: just a code, typed into the page that asked for it. */
export async function sendCode(env: Env, to: string, code: string, minutes: number): Promise<void> {
	const subject = `Your Walk code: ${code}`;
	const text = [
		`Your Walk sign-in code: ${code}`,
		"",
		`Type it into Walk, in the browser where you asked for it. It works once, for ${minutes} minutes.`,
		"If you didn't ask to sign in, ignore this email. Nobody can use the code without the browser that asked.",
		"",
		"Questions: support@omrilotan.com",
	].join("\n");
	const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#16211e">
<p>Your Walk sign-in code:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>
<p>Type it into Walk, in the browser where you asked for it. It works once, for ${minutes} minutes.</p>
<p style="color:#5b6b66;font-size:14px">If you didn't ask to sign in, ignore this email. Nobody can use the code without the browser that asked.</p>
<p style="color:#5b6b66;font-size:14px">Questions: <a href="mailto:support@omrilotan.com">support@omrilotan.com</a></p>
</body></html>`;

	if (!env.EMAIL) {
		// Local development: no email binding. Never reached in production.
		console.log(`[email] to=${to} subject=${subject}`);
		return;
	}
	await env.EMAIL.send({
		from: { name: env.FROM_NAME, email: env.FROM_ADDRESS },
		to,
		subject,
		text,
		html,
	} as never);
}
