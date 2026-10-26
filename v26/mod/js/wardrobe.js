<script type="text/javascript">
/* Mosspack Wardrobe: pick a skin and cape with a 3D preview (drag to turn, the cape shows on the back), upload
 * your own, change your name. It opens from the title screen's profile button: the game's Edit Profile constructor
 * raises the exported flag "mosspack.profile" (a code patch in mod/build.py), and this script answers by opening the
 * Wardrobe and closing Edit Profile (whose dropdowns don't work in this build). The game reads the profile only when
 * it starts, so saving writes the profile (localStorage "_mosspack26.p", NBT) and restarts Mosspack.
 * Profile format: presetSkin (0-23) / customSkin (index into skins, -1 none); presetCape (0 none, 1-25) /
 * customCape; skins [{name, data: 64x64 ABGR, model: 0 wide | 1 slim}]; capes [{name, data: 23x17 BGR}].
 * PRESETS is filled in by mod/build.py; the 3D view is skinview3d (MIT, vendor/skinview3d.bundle.js). */
(function () {
	"use strict";
	const PRESETS = __PRESETS__;            // {skins: [[name, slim, dataURL]], capes: [[name, dataURL]]}
	const KEY = "_mosspack26.p";
	let ready = false, inWorld = false, panel = null;

	// ------------------------------------------------------------------ game state from its log
	["log", "warn", "error"].forEach((level) => {
		const original = console[level];
		console[level] = function () {
			const m = String(arguments[0]);
			if (m.indexOf("minecraft:music.menu") >= 0) ready = true;
			if (m.indexOf("Integrated server ready") >= 0 || m.indexOf("Connecting to ") >= 0) inWorld = true;
			if (m.indexOf("final disconnect") >= 0) inWorld = false;
			return original.apply(console, arguments);
		};
	});

	// ------------------------------------------------------------------ profile (NBT) — same reader/writer idea as seed-capes.js
	const NBT = {
		parse(bytes) {
			const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), dec = new TextDecoder();
			let i = 0;
			const str = () => { const n = v.getUint16(i); i += 2; const s = dec.decode(bytes.subarray(i, i + n)); i += n; return s; };
			const read = (t) => {
				switch (t) {
					case 1: return v.getInt8(i++);
					case 2: i += 2; return v.getInt16(i - 2);
					case 3: i += 4; return v.getInt32(i - 4);
					case 4: i += 8; return v.getBigInt64(i - 8);
					case 5: i += 4; return v.getFloat32(i - 4);
					case 6: i += 8; return v.getFloat64(i - 8);
					case 7: { const n = v.getInt32(i); i += 4; const b = bytes.slice(i, i + n); i += n; return b; }
					case 8: return str();
					case 9: { const et = bytes[i++], n = v.getInt32(i); i += 4; const items = []; for (let k = 0; k < n; k++) items.push(read(et)); return { et, items }; }
					case 10: { const c = []; for (;;) { const tt = bytes[i++]; if (!tt) return c; c.push([tt, str(), read(tt)]); } }
					case 11: { const n = v.getInt32(i); i += 4; const a = []; for (let k = 0; k < n; k++) { a.push(v.getInt32(i)); i += 4; } return a; }
				}
				throw new Error("bad NBT tag " + t);
			};
			i = 1; str();
			return read(10);
		},
		serialize(root) {
			const parts = [], enc = new TextEncoder();
			const num = (n, size, fn) => { const b = new Uint8Array(size); new DataView(b.buffer)[fn](0, n); parts.push(b); };
			const str = (s) => { const b = enc.encode(s); num(b.length, 2, "setUint16"); parts.push(b); };
			const write = (t, x) => {
				switch (t) {
					case 1: return num(x, 1, "setInt8");
					case 2: return num(x, 2, "setInt16");
					case 3: return num(x, 4, "setInt32");
					case 4: return num(x, 8, "setBigInt64");
					case 5: return num(x, 4, "setFloat32");
					case 6: return num(x, 8, "setFloat64");
					case 7: num(x.length, 4, "setInt32"); return parts.push(x);
					case 8: return str(x);
					case 9: parts.push(Uint8Array.of(x.et)); num(x.items.length, 4, "setInt32"); return x.items.forEach((it) => write(x.et, it));
					case 10: x.forEach(([tt, name, val]) => { parts.push(Uint8Array.of(tt)); str(name); write(tt, val); }); return parts.push(Uint8Array.of(0));
					case 11: num(x.length, 4, "setInt32"); return x.forEach((n) => num(n, 4, "setInt32"));
				}
			};
			parts.push(Uint8Array.of(10)); str(""); write(10, root);
			const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
			let k = 0; for (const p of parts) { all.set(p, k); k += p.length; }
			return all;
		},
	};
	const b64 = { decode: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
		encode: (b) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); } };
	const get = (c, name, dflt) => { const e = c.find(([, n]) => n === name); return e ? e[2] : dflt; };
	const set = (c, tag, name, val) => { const e = c.find(([, n]) => n === name); if (e) { e[0] = tag; e[2] = val; } else c.push([tag, name, val]); };
	function loadProfile() {
		try { const s = localStorage.getItem(KEY); if (s) return NBT.parse(b64.decode(s)); } catch (e) {}
		return [[3, "presetSkin", 0], [3, "customSkin", -1], [9, "skins", { et: 10, items: [] }], [3, "presetCape", 0], [3, "customCape", -1],
			[9, "capes", { et: 10, items: [] }]];
	}

	// ------------------------------------------------------------------ texture conversions
	const canvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
	function skinFromData(data) {                            // 64x64 ABGR -> canvas
		const c = canvas(64, 64), x = c.getContext("2d"), img = x.createImageData(64, 64);
		for (let i = 0; i < 4096; i++) { img.data[i * 4] = data[i * 4 + 3]; img.data[i * 4 + 1] = data[i * 4 + 2]; img.data[i * 4 + 2] = data[i * 4 + 1]; img.data[i * 4 + 3] = data[i * 4]; }
		x.putImageData(img, 0, 0); return c;
	}
	function skinToData(c) {                                 // canvas -> 64x64 ABGR
		const d = c.getContext("2d").getImageData(0, 0, 64, 64).data, out = new Uint8Array(16384);
		for (let i = 0; i < 4096; i++) { out[i * 4] = d[i * 4 + 3]; out[i * 4 + 1] = d[i * 4 + 2]; out[i * 4 + 2] = d[i * 4 + 1]; out[i * 4 + 3] = d[i * 4]; }
		return out;
	}
	function capeFromData(data) {                            // 23x17 BGR -> 64x32 canvas
		const c = canvas(64, 32), x = c.getContext("2d"), img = x.createImageData(64, 32);
		for (let y = 0; y < 17; y++) for (let k = 0; k < 22; k++) {
			const s = (y * 23 + k) * 3, t = (y * 64 + k) * 4;
			img.data[t] = data[s + 2]; img.data[t + 1] = data[s + 1]; img.data[t + 2] = data[s]; img.data[t + 3] = 255;
		}
		x.putImageData(img, 0, 0); return c;
	}
	function capeToData(c) {
		const d = c.getContext("2d").getImageData(0, 0, 64, 32).data, out = new Uint8Array(1173);
		for (let y = 0; y < 17; y++) for (let k = 0; k < 22; k++) {
			const s = (y * 64 + k) * 4, t = (y * 23 + k) * 3;
			out[t] = d[s + 2]; out[t + 1] = d[s + 1]; out[t + 2] = d[s];
		}
		return out;
	}
	function imageToCanvas(src, w, h) {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => {
				const c = canvas(w, h), x = c.getContext("2d");
				if (w === 64 && h === 64 && img.height === 32) {          // old 64x32 skin: mirror the right limbs to the left
					x.drawImage(img, 0, 0);
					const limb = (sx, sy, dx, dy) => { x.save(); x.translate(dx + 16, dy); x.scale(-1, 1); x.drawImage(img, sx, sy, 16, 16, 0, 0, 16, 16); x.restore(); };
					limb(0, 16, 16, 48); limb(40, 16, 32, 48);
				} else x.drawImage(img, 0, 0, w, h);                       // skins 64x64; capes scaled to 64x32 (HD capes too)
				resolve(c);
			};
			img.onerror = reject;
			img.src = src;
		});
	}

	// ------------------------------------------------------------------ UI
	const CSS = `
	#mp-wardrobe{position:fixed;inset:0;z-index:2147483001;background:rgba(8,10,7,.82);display:flex;align-items:center;justify-content:center;
		font:14px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#e9eee3}
	#mp-wardrobe .card{width:min(980px,96vw);height:min(620px,94vh);background:#1c2417;border:2px solid #34422b;border-radius:10px;
		box-shadow:0 6px 0 #0b0e09;display:flex;overflow:hidden}
	#mp-wardrobe .view{width:38%;min-width:240px;background:radial-gradient(circle at 50% 40%,#2b3a24,#12170f);display:flex;flex-direction:column;align-items:center;padding:14px}
	#mp-wardrobe .view canvas{flex:1;width:100%;cursor:grab}
	#mp-wardrobe .view .row{display:flex;gap:8px;margin-top:8px}
	#mp-wardrobe .side{flex:1;display:flex;flex-direction:column;padding:16px 18px;min-width:0}
	#mp-wardrobe h2{margin:0 0 10px;font:700 20px/1 Menlo,Consolas,monospace}
	#mp-wardrobe h2 span{color:#6fbf4a}
	#mp-wardrobe .tabs{display:flex;gap:6px;margin-bottom:10px}
	#mp-wardrobe button{background:#2a3622;color:#e9eee3;border:1px solid #3d4d33;border-radius:5px;padding:7px 12px;font:600 13px/1 inherit;cursor:pointer}
	#mp-wardrobe button:hover{border-color:#6fbf4a}
	#mp-wardrobe button.on{background:#6fbf4a;color:#0f140c;border-color:#6fbf4a}
	#mp-wardrobe .grid{flex:1;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(86px,1fr));gap:8px;padding:2px;align-content:start}
	#mp-wardrobe .tile{background:#141b11;border:2px solid #2a3622;border-radius:6px;padding:6px 4px 5px;text-align:center;cursor:pointer}
	#mp-wardrobe .tile:hover{border-color:#4f7a39}
	#mp-wardrobe .tile.on{border-color:#6fbf4a;background:#1f2d18}
	#mp-wardrobe .tile canvas{width:48px;height:48px;image-rendering:pixelated;display:block;margin:0 auto 4px}
	#mp-wardrobe .tile div{font-size:11px;color:#c4ceb9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
	#mp-wardrobe .foot{display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap}
	#mp-wardrobe input[type=text]{background:#0f140c;color:#e9eee3;border:1px solid #3d4d33;border-radius:5px;padding:7px 9px;font:inherit;width:170px}
	#mp-wardrobe .save{background:#6fbf4a;color:#0f140c;border-color:#6fbf4a;margin-left:auto}
	#mp-wardrobe .note{font-size:12px;color:#8d9a83}
	#mp-wardrobe .user{display:flex;align-items:center;gap:10px;margin:0 0 12px;font-weight:600;color:#c4ceb9}
	#mp-wardrobe .user input{width:200px;font-size:15px}`;

	function headIcon(skin) {                               // 8x8 face + hat layer, scaled
		const c = canvas(8, 8), x = c.getContext("2d");
		x.drawImage(skin, 8, 8, 8, 8, 0, 0, 8, 8); x.drawImage(skin, 40, 8, 8, 8, 0, 0, 8, 8); return c;
	}
	function capeIcon(cape) {
		const c = canvas(10, 16), x = c.getContext("2d");
		if (cape) x.drawImage(cape, 1, 1, 10, 16, 0, 0, 10, 16); return c;
	}

	async function open() {
		if (panel) return;
		if (document.pointerLockElement) document.exitPointerLock();
		const root = loadProfile();
		const customSkins = get(root, "skins", { et: 10, items: [] }), customCapes = get(root, "capes", { et: 10, items: [] });
		if (customSkins.et !== 10) customSkins.et = 10;
		if (customCapes.et !== 10) customCapes.et = 10;
		// every choice: {kind, name, slim, texture(canvas), apply()}
		const skins = await Promise.all(PRESETS.skins.map(async ([name, slim, url], k) => ({ name, slim, tex: await imageToCanvas(url, 64, 64), preset: k })));
		customSkins.items.forEach((c, k) => skins.push({ name: get(c, "name", "Custom"), slim: get(c, "model", 0) === 1, tex: skinFromData(get(c, "data")), custom: k }));
		const capes = [{ name: "No Cape", tex: null, preset: 0 }].concat(
			await Promise.all(PRESETS.capes.map(async ([name, url], k) => ({ name, tex: await imageToCanvas(url, 64, 32), preset: k + 1 }))));
		customCapes.items.forEach((c, k) => capes.push({ name: get(c, "name", "Custom"), tex: capeFromData(get(c, "data")), custom: k }));
		const cs = get(root, "customSkin", -1), cc = get(root, "customCape", -1);
		let skin = skins.find((s) => cs >= 0 ? s.custom === cs : s.preset === get(root, "presetSkin", 0)) || skins[0];
		let cape = capes.find((c) => cc >= 0 ? c.custom === cc : c.preset === get(root, "presetCape", 0)) || capes[0];

		const style = document.createElement("style"); style.textContent = CSS;
		panel = document.createElement("div"); panel.id = "mp-wardrobe";
		panel.innerHTML = `<div class="card"><div class="view"><canvas></canvas><div class="row"><button data-a="walk">Walk</button>
			<button data-a="spin" class="on">Spin</button><button data-a="back">Show back</button></div>
			<div class="row"><button data-a="arms" hidden>Arms: Wide</button></div></div>
			<div class="side"><h2>moss<span>pack</span> profile</h2>
			<label class="user">Username <input type="text" maxlength="16" spellcheck="false" placeholder="Your name"></label>
			<div class="tabs"><button data-t="skins" class="on">Skins</button>
			<button data-t="capes">Capes</button></div><div class="grid"></div><div class="foot"><button data-a="upload">Upload skin or cape…</button>
			<button data-a="cancel">Cancel</button><button data-a="save" class="save">Save &amp; restart</button></div>
			<div class="note">Saving restarts Mosspack (your worlds are untouched).</div></div></div>`;
		panel.prepend(style);
		document.body.appendChild(panel);
		for (const t of ["keydown", "keyup", "keypress", "mousedown", "mouseup", "click", "wheel", "contextmenu"])
			panel.addEventListener(t, (e) => e.stopPropagation());                 // keep input away from the game
		const name = panel.querySelector("input[type=text]");
		name.value = get(root, "username", "");

		const view = panel.querySelector(".view canvas");
		const viewer = new skinview3d.SkinViewer({ canvas: view, width: view.clientWidth, height: view.clientHeight });
		viewer.autoRotate = true; viewer.zoom = 0.85; viewer.fov = 50;
		const fit = () => { viewer.width = view.clientWidth; viewer.height = view.clientHeight; };
		addEventListener("resize", fit);
		const arms = panel.querySelector("[data-a=arms]");
		const show = () => {
			arms.hidden = !skin.upload;                                         // uploaded skins: choose the arm width
			arms.textContent = "Arms: " + (skin.slim ? "Slim" : "Wide");
			viewer.loadSkin(skin.tex, { model: skin.slim ? "slim" : "default" });
			if (cape.tex) viewer.loadCape(cape.tex); else viewer.resetCape();
		};
		show();

		let tab = "skins";
		const grid = panel.querySelector(".grid");
		const render = () => {
			grid.textContent = "";
			for (const item of tab === "skins" ? skins : capes) {
				const tile = document.createElement("div");
				tile.className = "tile" + (item === (tab === "skins" ? skin : cape) ? " on" : "");
				tile.append(tab === "skins" ? headIcon(item.tex) : capeIcon(item.tex));
				const label = document.createElement("div"); label.textContent = item.name; tile.append(label);
				tile.title = item.name;
				tile.onclick = () => { if (tab === "skins") skin = item; else cape = item; show(); render(); };
				grid.append(tile);
			}
		};
		render();

		const upload = document.createElement("input"); upload.type = "file"; upload.accept = "image/png";
		upload.onchange = async () => {
			const file = upload.files[0]; if (!file) return;
			const url = URL.createObjectURL(file);
			try {
				if (tab === "skins") {
					const tex = await imageToCanvas(url, 64, 64);
					const item = { name: file.name.replace(/\.png$/i, ""), slim: false, tex, upload: true };
					skins.push(item); skin = item;
				} else {
					const item = { name: file.name.replace(/\.png$/i, ""), tex: await imageToCanvas(url, 64, 32), upload: true };
					capes.push(item); cape = item;
				}
				show(); render();
			} catch (e) { alert("That file isn't a skin or cape PNG."); }
			URL.revokeObjectURL(url); upload.value = "";
		};

		const close = () => { viewer.dispose(); removeEventListener("resize", fit); panel.remove(); panel = null; };
		panel.addEventListener("click", (e) => {
			const b = e.target.closest("button"); if (!b) return;
			if (b.dataset.t) {
				tab = b.dataset.t;
				panel.querySelectorAll("[data-t]").forEach((x) => x.classList.toggle("on", x === b));
				render();
			} else if (b.dataset.a === "walk") {
				viewer.animation = viewer.animation ? null : new skinview3d.WalkingAnimation(); b.classList.toggle("on", !!viewer.animation);
			} else if (b.dataset.a === "spin") {
				viewer.autoRotate = !viewer.autoRotate; b.classList.toggle("on", viewer.autoRotate);
			} else if (b.dataset.a === "back") {
				viewer.autoRotate = false; panel.querySelector("[data-a=spin]").classList.remove("on");
				viewer.playerObject.rotation.y = viewer.playerObject.rotation.y > 1 ? 0 : Math.PI;
			} else if (b.dataset.a === "arms") {
				skin.slim = !skin.slim; show();
			} else if (b.dataset.a === "upload") upload.click();
			else if (b.dataset.a === "cancel") close();
			else if (b.dataset.a === "save") {
				if (skin.upload) { customSkins.items.push([[8, "name", skin.name], [7, "data", skinToData(skin.tex)], [1, "model", skin.slim ? 1 : 0]]); skin.custom = customSkins.items.length - 1; }
				if (cape.upload) { customCapes.items.push([[8, "name", cape.name], [7, "data", capeToData(cape.tex)]]); cape.custom = customCapes.items.length - 1; }
				set(root, 3, "presetSkin", skin.custom === undefined ? skin.preset : -1);
				set(root, 3, "customSkin", skin.custom === undefined ? -1 : skin.custom);
				set(root, 3, "presetCape", cape.custom === undefined ? cape.preset : -1);
				set(root, 3, "customCape", cape.custom === undefined ? -1 : cape.custom);
				set(root, 9, "skins", customSkins); set(root, 9, "capes", customCapes);
				const n = name.value.trim().replace(/[^A-Za-z0-9_]/g, "").slice(0, 16);
				if (n) set(root, 8, "username", n);
				localStorage.setItem(KEY, b64.encode(NBT.serialize(root)));
				location.reload();
			}
		});
	}

	// ------------------------------------------------------------------ the profile button opens the Wardrobe
	let exports = null, settledAt = 0;
	const instantiate = WebAssembly.instantiate;
	WebAssembly.instantiate = function () {
		return instantiate.apply(this, arguments).then((r) => {
			const inst = r instanceof WebAssembly.Instance ? r : r && r.instance;
			if (inst && inst.exports["mosspack.profile"]) exports = inst.exports;
			return r;
		});
	};
	function closeEditProfile() {
		const target = document.querySelector("#game_frame canvas") || window;
		for (const type of ["keydown", "keyup"])
			target.dispatchEvent(new KeyboardEvent(type, { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true }));
	}
	setInterval(() => {
		if (ready && !settledAt) settledAt = Date.now();
		const flag = exports && exports["mosspack.profile"];
		if (!flag || !flag.value) return;
		flag.value = 0;
		if (!settledAt || Date.now() - settledAt < 2000 || inWorld) return;     // the Edit Profile the game opens on launch
		open();
		setTimeout(closeEditProfile, 50);
	}, 100);
})();
</script>
