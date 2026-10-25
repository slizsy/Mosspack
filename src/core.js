
/* ================================================================================================
 * Mosspack core (appended to the game's runtime.js by apply_mods.py, before the other Mosspack scripts)
 *
 * Used by lan.js:
 *   - byte helpers for the game's binary protocols (Out / In)
 *   - the runtime hooks apply_mods.py adds to runtime.js:
 *       self.__mosspackRecv(ch, buf)       every packet the world worker sends to the page
 *       self.__mosspackFilterOut(ch, bytes) every packet the page sends to the worker (return true to drop)
 *       self.__mosspackSend(ch, buf)       post a packet to the worker
 *   - whether a singleplayer world is running (Mosspack.world)
 *   - small UI helpers (style injection, buttons that don't steal keyboard focus, toasts)
 * ============================================================================================= */
(function () {
	"use strict";
	if (typeof window === "undefined" || typeof document === "undefined") return;   // the world-server worker

	const IPC = "~!IPC", LOCAL = "~!LOCAL_PLAYER";
	const M = self.Mosspack = { IPC, LOCAL, world: false };

	// ------------------------------------------------------------------ bytes
	M.Out = class Out {
		constructor() { this.a = []; }
		u8(v) { this.a.push(v & 255); return this; }
		u16(v) { this.a.push((v >>> 8) & 255, v & 255); return this; }
		varint(v) { v >>>= 0; while (v >= 0x80) { this.a.push((v & 0x7f) | 0x80); v >>>= 7; } this.a.push(v); return this; }
		bytes(b) { for (let i = 0; i < b.length; i++) this.a.push(b[i] & 255); return this; }
		ascii8(s) { this.u8(s.length); for (let i = 0; i < s.length; i++) this.a.push(s.charCodeAt(i) & 255); return this; }
		javaUTF(s) { const e = new TextEncoder().encode(s); return this.u16(e.length).bytes(e); }
		mcString(s) { const e = new TextEncoder().encode(s); return this.varint(e.length).bytes(e); }
		byteArray(b) { return this.varint(b.length).bytes(b); }
		build() { return new Uint8Array(this.a); }
	};
	M.In = class In {
		constructor(b, at = 0) { this.b = b; this.i = at; }
		left() { return this.b.length - this.i; }
		u8() { if (this.i >= this.b.length) throw new Error("short packet"); return this.b[this.i++]; }
		u16() { return (this.u8() << 8) | this.u8(); }
		bytes(n) { if (this.i + n > this.b.length) throw new Error("short packet"); const r = this.b.subarray(this.i, this.i + n); this.i += n; return r; }
		ascii8() { const r = this.bytes(this.u8()); let s = ""; for (let k = 0; k < r.length; k++) s += String.fromCharCode(r[k]); return s; }
		varint() { let v = 0, s = 0, b; do { b = this.u8(); v |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return v >>> 0; }
		javaUTF() { return new TextDecoder().decode(this.bytes(this.u16())); }
		mcString() { return new TextDecoder().decode(this.bytes(this.varint())); }
	};

	// ------------------------------------------------------------------ runtime hooks
	const recvHandlers = [], outHandlers = [], worldHandlers = [];
	M.onRecv = (fn) => recvHandlers.push(fn);         // fn(ch, ArrayBuffer) -> true to consume
	M.onSend = (fn) => outHandlers.push(fn);          // fn(ch, Uint8Array)  -> true to drop
	M.onWorld = (fn) => worldHandlers.push(fn);       // fn(isOpen)
	function setWorld(open) {
		if (M.world === open) return;
		M.world = open;
		for (const fn of worldHandlers) fn(open);
	}
	self.__mosspackRecv = function (ch, buf) {
		if (ch === LOCAL) setWorld(true);
		for (const fn of recvHandlers) if (fn(ch, buf)) return true;
		return false;
	};
	self.__mosspackFilterOut = function (ch, bytes) {
		if (!bytes || !bytes.length) return false;
		if (ch === IPC && (bytes[0] & 255) === 0x01) setWorld(false);        // IPCPacket01StopServer: world closing
		for (const fn of outHandlers) if (fn(ch, bytes)) return true;
		return false;
	};
	M.toWorker = function (ch, bytes) {
		if (!self.__mosspackSend) return;
		const copy = new Uint8Array(bytes.length); copy.set(bytes);
		self.__mosspackSend(ch, copy.buffer);
	};

	// ------------------------------------------------------------------ UI helpers
	const styled = new Set();
	M.style = function (id, css) {
		if (styled.has(id)) return;
		const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); styled.add(id);
	};
	M.el = function (tag, attrs, ...kids) {
		const e = document.createElement(tag);
		for (const k in attrs || {}) {
			if (k.startsWith("on")) e.addEventListener(k.slice(2), attrs[k]);
			else e.setAttribute(k, attrs[k]);
		}
		for (const c of kids) if (c != null) e.append(c);
		return e;
	};
	// Buttons never take keyboard focus, so Esc and the game's keys keep working after a click.
	M.button = function (label, onClick, cls) {
		const b = M.el("button", { class: cls || "", type: "button", tabindex: "-1" }, ...[].concat(label));
		b.addEventListener("mousedown", (e) => e.preventDefault());
		b.addEventListener("click", (e) => { e.preventDefault(); b.blur(); onClick(b); });
		return b;
	};
	let toasts = null;
	M.toast = function (text) {
		M.style("toast", `#mosspack-toasts{position:fixed;top:18px;left:0;right:0;z-index:201;display:flex;flex-direction:column;gap:6px;
			align-items:center;pointer-events:none}
			#mosspack-toasts div{background:rgba(16,20,13,.92);color:#f3e96b;border:1px solid #34422b;border-radius:4px;padding:7px 14px;
			font:600 14px/1.2 Menlo,Consolas,monospace;box-shadow:0 3px 0 #0b0e09;animation:mp-in .2s ease-out}
			@keyframes mp-in{from{opacity:0}to{opacity:1}}`);
		if (!toasts) { toasts = M.el("div", { id: "mosspack-toasts" }); document.body.appendChild(toasts); }
		const t = M.el("div", {}, text);
		toasts.appendChild(t);
		setTimeout(() => t.remove(), 5000);
	};
	M.copy = function (text, b) {
		const done = (ok) => { b.textContent = ok ? "Copied" : "Copy failed"; setTimeout(() => { b.textContent = "Copy"; }, 1500); };
		try { navigator.clipboard.writeText(text).then(() => done(true), () => done(false)); } catch (e) { done(false); }
	};
})();
