// The theme picked in the app, before first paint.
try {
	const theme = localStorage.getItem("walk:theme");
	if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch {}
