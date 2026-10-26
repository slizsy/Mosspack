<script type="text/javascript">
/* Keep Mosspack running in a background tab. The game advances one step per requestAnimationFrame, which browsers
 * stop in hidden tabs, so a world opened to LAN stopped answering friends whenever its tab wasn't in front (and two
 * tabs on one computer could never connect). Frame callbacks now come from the browser while the tab is visible and
 * from a small worker timer (~20 per second; worker timers are not paused) while it is hidden. */
(function () {
	"use strict";
	const native = window.requestAnimationFrame.bind(window);
	const queue = new Map();
	let next = 0, nativePending = false;
	window.__mosspackFrames = { visible: 0, hidden: 0 };
	function flush(time) {
		nativePending = false;
		window.__mosspackFrames[document.hidden ? "hidden" : "visible"]++;
		if (!queue.size) return;
		const callbacks = [...queue.values()];
		queue.clear();
		const t = typeof time === "number" ? time : performance.now();
		for (const cb of callbacks) {
			try { cb(t); } catch (e) { setTimeout(() => { throw e; }); }
		}
	}
	window.requestAnimationFrame = function (cb) {
		queue.set(++next, cb);
		if (!nativePending) { nativePending = true; native(flush); }
		return next;
	};
	window.cancelAnimationFrame = function (id) { queue.delete(id); };

	let worker = null;
	try {
		worker = new Worker(URL.createObjectURL(new Blob(["let t=0;onmessage=(e)=>{clearInterval(t);if(e.data)t=setInterval(()=>postMessage(0),e.data)}"],
			{ type: "text/javascript" })));
		worker.onmessage = () => { if (document.hidden) flush(performance.now()); };
	} catch (e) { worker = null; }
	const update = () => { if (worker) worker.postMessage(document.hidden ? 50 : 0); };
	document.addEventListener("visibilitychange", update);
	update();
})();
</script>
