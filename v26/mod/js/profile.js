<script type="text/javascript">
/* Mosspack profile helper, shared by seed-capes.js, tabs.js and wardrobe.js. The game keeps the player's profile as
 * NBT, base64, in localStorage "_mosspack26.p": a compound of [tag, name, value] entries (lists are {et, items}).
 *   MosspackProfile.load()            the profile compound, or null if there is none (or it can't be read)
 *   MosspackProfile.save(root)
 *   MosspackProfile.get(c, name, def) / .set(c, tag, name, value)   entries of a compound */
(function () {
	"use strict";
	const KEY = "_mosspack26.p";
	function parse(bytes) {
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
				case 12: { const n = v.getInt32(i); i += 4; const a = []; for (let k = 0; k < n; k++) { a.push(v.getBigInt64(i)); i += 8; } return a; }
			}
			throw new Error("bad NBT tag " + t);
		};
		if (bytes[i++] !== 10) throw new Error("not a compound");
		str();
		return read(10);
	}
	function serialize(root) {
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
				case 12: num(x.length, 4, "setInt32"); return x.forEach((n) => num(n, 8, "setBigInt64"));
			}
		};
		parts.push(Uint8Array.of(10)); str(""); write(10, root);
		const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
		let k = 0; for (const p of parts) { all.set(p, k); k += p.length; }
		return all;
	}
	const b64 = { decode: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
		encode: (b) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); } };

	window.MosspackProfile = {
		load() { try { const s = localStorage.getItem(KEY); return s ? parse(b64.decode(s)) : null; } catch (e) { return null; } },
		save(root) { localStorage.setItem(KEY, b64.encode(serialize(root))); },
		get(c, name, def) { const e = c.find(([, n]) => n === name); return e ? e[2] : def; },
		set(c, tag, name, value) { const e = c.find(([, n]) => n === name); if (e) { e[0] = tag; e[2] = value; } else c.push([tag, name, value]); },
		b64,
	};
})();
</script>
