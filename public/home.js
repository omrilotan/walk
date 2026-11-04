// Home page: copy chips and the theme button.

// Copy chips: the MCP address to the clipboard, with a moment of "Copied".
for (const chip of document.querySelectorAll("[data-copy]")) {
	chip.addEventListener("click", async () => {
		try {
			await navigator.clipboard.writeText(chip.dataset.copy);
			const icon = chip.querySelector("i");
			icon.className = "ph-bold ph-check";
			chip.title = "Copied";
			setTimeout(() => {
				icon.className = "ph-bold ph-copy";
				chip.title = "Copy to clipboard";
			}, 1600);
		} catch {
			getSelection().selectAllChildren(chip.querySelector("code"));
		}
	});
}

const themes = ["auto", "light", "dark"];
const icons = { auto: "ph-circle-half", light: "ph-sun", dark: "ph-moon" };
const button = document.getElementById("theme");
const current = () => {
	try {
		return localStorage.getItem("walk:theme") || "auto";
	} catch {
		return "auto";
	}
};
function apply(theme) {
	if (theme === "auto") delete document.documentElement.dataset.theme;
	else document.documentElement.dataset.theme = theme;
	button.title = `Theme: ${theme}`;
	button.querySelector("i").className = `ph ${icons[theme]}`;
	try {
		localStorage.setItem("walk:theme", theme);
	} catch {}
}
apply(current());
button.addEventListener("click", () => apply(themes[(themes.indexOf(current()) + 1) % themes.length]));
