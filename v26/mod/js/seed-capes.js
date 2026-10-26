<script type="text/javascript">
/* Official capes that don't fit the 25 preset slots are added to the profile's own cape list once each: a cape
 * removed later stays removed. A custom cape is {name: string, data: 1173 bytes = the 22x17 cape area as 23x17 BGR}.
 * Runs before the game reads the profile. CAPES is filled in by mod/build.py: [[name, base64 data], ...]. */
(function () {
	"use strict";
	const CAPES = __CAPES__;
	const ADDED = "mosspack26.capesAdded";
	const P = window.MosspackProfile;
	try {
		const added = new Set(JSON.parse(localStorage.getItem(ADDED) || "[]"));
		const todo = CAPES.filter(([name]) => !added.has(name));
		if (!todo.length) return;
		const root = P.load() || [
			[3, "presetSkin", Math.floor(Math.random() * 16)], [3, "customSkin", -1], [9, "skins", { et: 0, items: [] }],
			[3, "presetCape", 0], [3, "customCape", -1],
		];
		let capes = P.get(root, "capes");
		if (!capes || capes.et !== 10) { capes = { et: 10, items: [] }; P.set(root, 9, "capes", capes); }
		const have = new Set(capes.items.map((c) => P.get(c, "name")));
		for (const [name, data] of todo) {
			if (!have.has(name)) capes.items.push([[8, "name", name], [7, "data", P.b64.decode(data)]]);
			added.add(name);
		}
		P.save(root);
		localStorage.setItem(ADDED, JSON.stringify([...added]));
	} catch (e) {
		console.warn("[mosspack] could not add capes to the profile:", e);
	}
})();
</script>
