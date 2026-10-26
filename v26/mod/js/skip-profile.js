<script type="text/javascript">
/* No profile screen on launch: Eaglercraft opens Edit Profile every time the game starts (the profile button opens the
 * Wardrobe instead, js/wardrobe.js). The game logs "Unable to play empty soundEvent: minecraft:music.menu" when its
 * first screen appears (this build has no music pack); one Escape then closes Edit Profile. The loading screen stays
 * on top until that has happened, so the title screen is the first thing you see. If the message never comes,
 * nothing is closed and the loading screen lets go after 20 seconds anyway. */
(function () {
	"use strict";
	var done = false;
	var hold = document.createElement("style");
	hold.textContent = "#loading_screen.is-ready{opacity:1!important;pointer-events:auto!important}";
	document.head.appendChild(hold);
	function release() { if (hold.parentNode) hold.parentNode.removeChild(hold); }
	setTimeout(release, 20000);
	function escape() {
		var target = document.querySelector("#game_frame canvas") || window;
		for (var type of ["keydown", "keyup"])
			target.dispatchEvent(new KeyboardEvent(type, { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true }));
		setTimeout(release, 350);                          // a few frames for the title screen to draw
	}
	["log", "warn", "error"].forEach(function (level) {
		var original = console[level];
		console[level] = function () {
			if (!done && String(arguments[0]).indexOf("Unable to play empty soundEvent: minecraft:music.menu") >= 0) {
				done = true;
				setTimeout(escape, 60);
			}
			return original.apply(console, arguments);
		};
	});
})();
</script>
