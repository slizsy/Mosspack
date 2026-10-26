<script type="text/javascript">
/* No usage analytics: the game's analytics address (now analytics.invalid, formerly live.eaglercraft.org) is dropped. */
(function () {
	"use strict";
	var blocked = function (url) { return /^https?:\/\/(live\.eaglercraft\.org|analytics\.invalid)\//.test(String(url && url.url || url)); };
	var fetch = window.fetch;
	window.fetch = function (input) {
		return blocked(input) ? Promise.resolve(new Response(null, { status: 204 })) : fetch.apply(this, arguments);
	};
	if (navigator.sendBeacon) {
		var beacon = navigator.sendBeacon.bind(navigator);
		navigator.sendBeacon = function (url) { return blocked(url) ? true : beacon.apply(null, arguments); };
	}
	var open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
	XMLHttpRequest.prototype.open = function (method, url) { this.__mosspackBlocked = blocked(url); return open.apply(this, arguments); };
	XMLHttpRequest.prototype.send = function () { if (!this.__mosspackBlocked) return send.apply(this, arguments); };
})();
</script>
