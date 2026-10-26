<script type="text/javascript">
/* Fullscreen that works: the game asks for fullscreen from its own loop (Options -> Video Settings -> Fullscreen, or
 * F11), a moment after the click, and browsers refuse requests that don't come straight from a click or key press.
 * A refused request now waits and is made again on the next click or key press, and it always covers the whole
 * page (so the Wardrobe and messages stay visible), not only the game canvas. */
(function () {
	"use strict";
	const proto = Element.prototype;
	const request = proto.requestFullscreen || proto.webkitRequestFullscreen;
	if (!request) return;
	let waiting = null;                                     // {resolve, reject} of a refused request

	function full() {
		try { return Promise.resolve(request.call(document.documentElement, { navigationUI: "hide" })); }
		catch (e) { return Promise.reject(e); }
	}
	function fullscreen() {
		if (document.fullscreenElement || document.webkitFullscreenElement) return Promise.resolve();
		return full().catch((e) => {
			if (!e || e.name !== "TypeError" && e.name !== "NotAllowedError" && !/activation|gesture|permission/i.test(e.message)) throw e;
			return new Promise((resolve, reject) => { waiting = { resolve, reject }; });   // finished on the next input
		});
	}
	proto.requestFullscreen = fullscreen;
	if (proto.webkitRequestFullscreen) proto.webkitRequestFullscreen = fullscreen;
	for (const type of ["pointerdown", "keydown"]) {
		addEventListener(type, () => {
			if (!waiting) return;
			const w = waiting; waiting = null;
			full().then(w.resolve, w.reject);
		}, true);
	}
	document.addEventListener("fullscreenchange", () => { if (document.fullscreenElement && waiting) { waiting.resolve(); waiting = null; } });
})();
</script>
