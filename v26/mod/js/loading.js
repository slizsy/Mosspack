<script type="text/javascript">
/* Loading progress under the boot logo. Two phases:
 *   0-35%   unpacking and compiling the game code (the three WebAssembly modules: game, world server, mesh workers)
 *   35-100% the game's own boot stages (window.__eaglerBoot(pct 5..80, text), called from script-3)
 * At 80 the game shows its Mojang screen with its own resource-loading bar, so this one is done. */
(function () {
	"use strict";
	let bar = null, status = null, shown = 0;
	const MODULES = 3;
	let compiling = 0, compiled = 0;

	function render(pct, text) {
		shown = Math.max(shown, Math.min(100, pct));            // never goes backwards
		if (!bar) {
			status = document.getElementById("boot_status");
			if (!status) return;
			const track = document.createElement("div");
			track.id = "mp-boot-bar";                        // hidden with the logo once the game's Mojang screen takes over
			const hide = document.createElement("style");
			hide.textContent = "#loading_screen.minecraft-stage #mp-boot-bar{display:none}";
			document.head.appendChild(hide);
			track.setAttribute("style", "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(max(18px,4vh) + 26px);width:min(360px,70vw);"
				+ "height:6px;border-radius:3px;background:#2a3622;overflow:hidden");
			bar = document.createElement("div");
			bar.setAttribute("style", "height:100%;width:0;background:#6fbf4a;transition:width .25s ease-out");
			track.appendChild(bar);
			status.parentNode.appendChild(track);
		}
		bar.style.width = shown + "%";
		if (text) status.textContent = text + "  " + Math.round(shown) + "%";
	}
	window.__mosspackProgress = function (pct, text) {
		const t = String(text || "").replace(/^Downloading assets…/, "Unpacking textures and sounds…").replace(/^Loaded (\d+) assets/, "Loaded $1 textures and sounds");
		render(35 + (Math.max(5, Math.min(80, pct)) - 5) * 65 / 75, t);
	};

	// phase 1: WebAssembly compiles (each module is unpacked from the page right before it compiles)
	for (const name of ["compileStreaming", "compile"]) {
		const original = WebAssembly[name];
		if (typeof original !== "function") continue;
		WebAssembly[name] = function () {
			compiling++;
			render(3 + 32 * compiled / MODULES, "Unpacking the game code (" + Math.min(compiling, MODULES) + "/" + MODULES + ")…");
			return original.apply(this, arguments).then((m) => {
				compiled++;
				render(3 + 32 * compiled / MODULES, compiled >= MODULES ? "Starting Mosspack…" : "Unpacking the game code (" + Math.min(compiled + 1, MODULES) + "/" + MODULES + ")…");
				return m;
			});
		};
	}
	document.addEventListener("DOMContentLoaded", () => render(2, "Opening Mosspack…"));
})();
</script>
