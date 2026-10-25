
/* ================================================================================================
 * Moss Client: a Meteor-style module menu for your own worlds.
 *
 *   Unlock:  type  /hacks sj52qa  in chat (the command never reaches the game).
 *   Open:    Right Shift.
 *
 * Modules only work in your own singleplayer / LAN-hosted world and switch off everywhere else, so they
 * can't be used on other people's servers. Each module is a bit in the switches compiled into the game by
 * apply_mods.py (BIT there must match `bit` here). Bits 16+ act in the world server, so the page forwards
 * them to the worker on the ~!MOSSPACK channel; those apply to everyone in your world, LAN friends included.
 * Uses Mosspack core (core.js).
 * ============================================================================================= */
(function () {
	"use strict";
	const M = self.Mosspack;
	if (!M) return;

	const UNLOCK_CODE = (window.eaglercraftXOpts || {}).mosspackClientCode || "sj52qa";
	const STORE = "mosspack.client";
	const SERVER_BITS = 0xffff0000;
	const CATEGORIES = ["Movement", "Render", "World", "Player"];
	const MODULES = [
		{ id: "fly", bit: 2, cat: "Movement", name: "Fly", desc: "Double-tap jump to fly" },
		{ id: "speed", bit: 4, cat: "Movement", name: "Speed", desc: "Walk faster", setting: { key: "speed", min: 1.2, max: 4, step: 0.1, def: 2, unit: "×", fn: "mosspack.setSpeed" } },
		{ id: "highjump", bit: 256, cat: "Movement", name: "High Jump", desc: "Jump higher", setting: { key: "jump", min: 1.2, max: 4, step: 0.1, def: 2, unit: "×", fn: "mosspack.setJump" } },
		{ id: "step", bit: 8, cat: "Movement", name: "Step", desc: "Walk up full blocks" },
		{ id: "sprint", bit: 16, cat: "Movement", name: "Auto Sprint", desc: "Sprint whenever walking forward" },
		{ id: "spider", bit: 512, cat: "Movement", name: "Spider", desc: "Climb walls" },
		{ id: "jesus", bit: 1024, cat: "Movement", name: "Jesus", desc: "Float up out of water and lava (sneak to sink)" },
		{ id: "fullbright", bit: 1, cat: "Render", name: "Fullbright", desc: "See in the dark" },
		{ id: "esp", bit: 8192, cat: "Render", name: "ESP", desc: "Outline players, mobs and items through walls" },
		{ id: "nohurtcam", bit: 32, cat: "Render", name: "No Hurt Cam", desc: "No screen shake when hit" },
		{ id: "antioverlay", bit: 128, cat: "Render", name: "Anti Overlay", desc: "No fire, water, pumpkin or in-wall overlay" },
		{ id: "noweather", bit: 64, cat: "Render", name: "No Weather", desc: "Hide rain, snow and thunder" },
		{ id: "alwaysday", bit: 16384, cat: "Render", name: "Always Day", desc: "Sky stays at noon (visual only)" },
		{ id: "fastplace", bit: 2048, cat: "World", name: "Fast Place", desc: "No delay between placing blocks" },
		{ id: "fastbreak", bit: 4096, cat: "World", name: "Fast Break", desc: "No delay between breaking blocks" },
		{ id: "god", bit: 1 << 16, cat: "Player", name: "God Mode", desc: "Take no damage" },
		{ id: "nofall", bit: 1 << 17, cat: "Player", name: "No Fall", desc: "No fall damage" },
		{ id: "nohunger", bit: 1 << 18, cat: "Player", name: "No Hunger", desc: "Hunger never goes down" },
	];

	const saved = load();
	const on = new Set((saved.on || []).filter((id) => MODULES.some((m) => m.id === id)));
	const values = Object.assign({}, ...MODULES.filter((m) => m.setting).map((m) => ({ [m.setting.key]: m.setting.def })), saved.values);
	let unlocked = !!saved.unlocked;
	let menu = null, hud = null;

	function load() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } }
	function save() { try { localStorage.setItem(STORE, JSON.stringify({ unlocked, on: [...on], values })); } catch (e) {} }

	// push the switches into the game and the world server; everything is off outside your own world
	function apply() {
		let flags = 0;
		if (M.world) for (const m of MODULES) if (on.has(m.id)) flags |= m.bit;
		if (M.exports) {
			M.exports["mosspack.setFlags"](flags);
			for (const m of MODULES) if (m.setting) M.exports[m.setting.fn](values[m.setting.key]);
		}
		const server = new Uint8Array(4);
		new DataView(server.buffer).setUint32(0, (flags & SERVER_BITS) >>> 0);
		M.toWorker("~!MOSSPACK", server);
		renderHud();
	}
	M.onWorld(apply);
	M.onReady(apply);

	// "/hacks <code>" in chat: serverbound chat (play 0x02, one string) on the local channel. The packet may
	// carry a 1-byte frame, so try both offsets.
	function chatText(bytes) {
		for (const at of [0, 1]) {
			try {
				const r = new M.In(bytes, at);
				if (r.varint() === 0x02) { const s = r.mcString(); if (r.left() === 0) return s; }
			} catch (e) {}
		}
		return null;
	}
	M.onSend((ch, bytes) => {
		if (ch !== M.LOCAL) return false;
		const text = chatText(bytes);
		const m = text && text.match(/^\/+hacks\b\s*(.*)$/i);                   // "/hacks code" (or "//hacks code")
		if (!m) return false;
		if (!unlocked && m[1].trim() !== UNLOCK_CODE) return false;               // wrong code: the game says "Unknown command"
		if (!unlocked) { unlocked = true; save(); M.toast("Moss Client unlocked. Press Right Shift to open it."); }
		setTimeout(openMenu, 50);
		return true;
	});
	addEventListener("keydown", (e) => {
		if (!unlocked) return;
		if (e.code === "ShiftRight") menu ? closeMenu() : openMenu();
		else if (e.code === "Escape" && menu) closeMenu();
	}, true);

	/* ------------------------------------------------------------------ UI (Meteor-style) */
	const CSS = `
	#moss-client{position:fixed;inset:0;z-index:210;background:rgba(6,4,12,.35);font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:#eee;overflow:auto}
	#moss-client .bar{text-align:center;margin:14px 0 6px;font:700 15px/1 Menlo,Consolas,monospace;color:#c9a6ff;letter-spacing:.06em;text-shadow:0 0 12px rgba(145,90,255,.6)}
	#moss-client .bar small{display:block;margin-top:6px;font:12px/1 -apple-system,system-ui,sans-serif;color:#a79cc0;letter-spacing:0;text-shadow:none}
	#moss-client .cats{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start;justify-content:center;padding:12px 24px 50px}
	#moss-client .cat{width:220px;background:rgba(20,16,30,.94);border:1px solid rgba(145,90,255,.45);border-radius:4px;box-shadow:0 6px 20px rgba(0,0,0,.5)}
	#moss-client .cat h4{margin:0;padding:8px 10px;font:700 13px/1 Menlo,Consolas,monospace;color:#fff;background:linear-gradient(90deg,#7a45f0,#a46bff);border-radius:3px 3px 0 0;display:flex}
	#moss-client .cat h4 span{margin-left:auto;font-weight:400;opacity:.8}
	#moss-client .mod{display:block;width:100%;text-align:left;background:none;border:none;border-top:1px solid rgba(255,255,255,.05);color:#ddd;padding:7px 10px;font:inherit;cursor:pointer}
	#moss-client .mod:hover{background:rgba(145,90,255,.12)}
	#moss-client .mod.on{color:#fff;background:rgba(145,90,255,.28);box-shadow:inset 3px 0 0 #a46bff}
	#moss-client .mod small{display:block;color:#9a92ad;font-size:11px;margin-top:2px}
	#moss-client .opt{padding:2px 10px 9px;color:#bbb;font-size:12px;display:flex;align-items:center;gap:8px;background:rgba(145,90,255,.1)}
	#moss-client .opt input{flex:1;accent-color:#a46bff}
	#moss-client .note{position:fixed;bottom:14px;left:0;right:0;text-align:center;color:#c0b3dd;font-size:12px}
	#moss-hud{position:fixed;top:8px;right:8px;z-index:150;text-align:right;pointer-events:none;font:700 14px/1.25 Menlo,Consolas,monospace}
	#moss-hud div{color:#c9a6ff;text-shadow:1px 1px 0 #1a0f2e}
	#moss-hud div:first-child{color:#e2d0ff}`;

	function openMenu() {
		if (menu) return;
		M.style("client", CSS);
		if (document.pointerLockElement) document.exitPointerLock();
		menu = M.el("div", { id: "moss-client" });
		menu.addEventListener("mousedown", (e) => { if (e.target === menu || e.target.classList.contains("cats")) closeMenu(); });
		document.body.appendChild(menu);
		renderMenu();
	}
	function closeMenu() { if (menu) { menu.remove(); menu = null; } }
	function toggle(m) {
		if (!M.world && !on.has(m.id)) { M.toast("Moss Client only works in your own worlds"); return; }
		if (on.has(m.id)) on.delete(m.id); else on.add(m.id);
		save(); apply(); renderMenu();
		M.toast(`${m.name} ${on.has(m.id) ? "enabled" : "disabled"}`);
	}
	function slider(m) {
		const s = m.setting, label = M.el("span", {}, values[s.key].toFixed(1) + s.unit);
		const input = M.el("input", { type: "range", min: s.min, max: s.max, step: s.step, value: values[s.key] });
		input.addEventListener("input", () => { values[s.key] = +input.value; label.textContent = values[s.key].toFixed(1) + s.unit; save(); apply(); });
		return M.el("div", { class: "opt" }, input, label);
	}
	function renderMenu() {
		if (!menu) return;
		const el = M.el;
		menu.textContent = "";
		const cats = el("div", { class: "cats" });
		for (const cat of CATEGORIES) {
			const mods = MODULES.filter((x) => x.cat === cat);
			const box = el("div", { class: "cat" }, el("h4", {}, cat, el("span", {}, `${mods.filter((m) => on.has(m.id)).length}/${mods.length}`)));
			for (const m of mods) {
				box.append(M.button([m.name, el("small", {}, m.desc)], () => toggle(m), "mod" + (on.has(m.id) ? " on" : "")));
				if (m.setting && on.has(m.id)) box.append(slider(m));
			}
			cats.append(box);
		}
		menu.append(el("div", { class: "bar" }, "MOSS CLIENT", el("small", {}, "Right Shift or Esc to close")), cats,
			el("div", { class: "note" }, M.world ? "Modules work in your own worlds only. Player modules apply to everyone in your world."
				: "Open one of your own worlds to use modules."));
	}
	function renderHud() {
		const active = M.world ? MODULES.filter((m) => on.has(m.id)).map((m) => m.name) : [];
		if (!active.length) { if (hud) { hud.remove(); hud = null; } return; }
		M.style("client", CSS);
		if (!hud) { hud = M.el("div", { id: "moss-hud" }); document.body.appendChild(hud); }
		hud.textContent = "";
		hud.append(M.el("div", {}, "Moss Client"), ...active.sort((a, b) => b.length - a.length).map((n) => M.el("div", {}, n)));
	}
})();
