
/* Mosspack start screen (appended to runtime.js). Browsers only allow sound after the player clicks or presses
 * a key, so the game waits for one. The original screen was faint grey text on white, which looks like a blank
 * page on many laptops and Chromebooks; this one is dark and obvious. */
(function () {
	"use strict";
	if (typeof window === "undefined" || typeof document === "undefined") return;
	self.__mosspackStartScreen = function (c) {
		const touch = /mobi|tablet|android|ipad|iphone/i.test(navigator.userAgent || "") || navigator.maxTouchPoints > 0;
		c.style.background = "radial-gradient(ellipse at 50% 40%, #1f2a19 0%, #12170f 70%)";
		c.style.cursor = "pointer";
		c.style.display = "flex";
		c.style.alignItems = "center";
		c.style.justifyContent = "center";
		c.style.flexDirection = "column";
		c.style.userSelect = "none";
		c.style.font = "16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif";
		c.innerHTML =
			'<div style="font:700 30px/1 Menlo,Consolas,monospace;letter-spacing:.04em;color:#e9eee3;margin-bottom:28px">moss<span style="color:#6fbf4a">pack</span></div>' +
			'<div style="font-weight:700;font-size:clamp(20px,3.2vw,30px);color:#e9eee3;padding:16px 28px;border:2px solid #34422b;border-radius:8px;' +
			'background:#1c2417;box-shadow:0 4px 0 #0b0e09">' + (touch ? "Tap anywhere to start" : "Click or press any key to start") + '</div>' +
			'<div style="margin-top:16px;color:#8d9a83;font-size:14px">Your browser needs one click before the game can play sound.</div>';
	};
})();
