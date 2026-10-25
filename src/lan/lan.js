
/* ================================================================================================
 * Mosspack LAN (appended to the game's runtime.js by apply_mods.py)
 *
 * Friends join your singleplayer world from anywhere: no server to install, everything runs in the page.
 *
 *   Host:   Esc → Open to LAN shows a 6-character code (e.g. K7QX9P).
 *   Friend: Multiplayer → Direct Connect → type the code → Join Server.
 *
 * How:
 *   - The friend's copy of the game connects to "ws://K7QX9P". window.WebSocket is wrapped so that address
 *     becomes a LanSocket: a WebSocket look-alike backed by a WebRTC data channel to the host's browser.
 *   - The two browsers swap WebRTC offers/answers through ntfy.sh (a free public pub/sub service), using
 *     topics derived from the code. After that, game traffic flows directly between the players.
 *   - The host's page answers each friend's login handshake (the same protocol multiplayer servers use),
 *     opens a player channel in its integrated-server worker (IPC packet 0x0C), sends the login-start
 *     packet the worker expects and then forwards Minecraft packets both ways.
 * Runtime hooks (added by apply_mods.py): self.__mosspackLanRecv(ch, buf) sees every packet from the
 * worker; self.__mosspackLanSend(ch, buf) posts one to it; self.__mosspackLanFilterOut(ch, bytes) can drop
 * a packet going to it.
 * ============================================================================================= */
(function () {
	"use strict";
	if (typeof window === "undefined" || typeof document === "undefined") return;

	const IPC = "~!IPC", LOCAL = "~!LOCAL_PLAYER";
	const MC_PROTOCOL = 340;
	const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
	const SIGNAL_HOST = "ntfy.sh";
	const PIECE = 16000;                     // data-channel message size (bytes of payload per piece)
	const opts = () => window.eaglercraftXOpts || {};
	const iceServers = () => opts().mosspackIceServers || [
		{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
		{ urls: "stun:stun.cloudflare.com:3478" },
	];

	// ------------------------------------------------------------------ byte helpers
	class Out {
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
	}
	class In {
		constructor(b) { this.b = b; this.i = 0; }
		left() { return this.b.length - this.i; }
		u8() { if (this.i >= this.b.length) throw new Error("short packet"); return this.b[this.i++]; }
		u16() { return (this.u8() << 8) | this.u8(); }
		bytes(n) { if (this.i + n > this.b.length) throw new Error("short packet"); const r = this.b.subarray(this.i, this.i + n); this.i += n; return r; }
		ascii8() { const n = this.u8(); let s = ""; const r = this.bytes(n); for (let k = 0; k < r.length; k++) s += String.fromCharCode(r[k]); return s; }
		varint() { let v = 0, s = 0, b; do { b = this.u8(); v |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return v >>> 0; }
		javaUTF() { return new TextDecoder().decode(this.bytes(this.u16())); }
	}
	const randomCode = (n, chars = CODE_CHARS) => {
		const r = crypto.getRandomValues(new Uint8Array(n)); let s = "";
		for (let i = 0; i < n; i++) s += chars[r[i] % chars.length];
		return s;
	};

	// ------------------------------------------------------------------ offline UUID (MD5 name-based, like vanilla)
	function md5(bytes) {
		const K = [], S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
		for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
		const len = bytes.length, n = ((len + 8) >>> 6) + 1, w = new Uint32Array(n * 16);
		for (let i = 0; i < len; i++) w[i >> 2] |= bytes[i] << ((i % 4) * 8);
		w[len >> 2] |= 0x80 << ((len % 4) * 8);
		w[n * 16 - 2] = (len * 8) >>> 0; w[n * 16 - 1] = Math.floor(len / 536870912);
		let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
		for (let c = 0; c < n; c++) {
			let A = a0, B = b0, C = c0, D = d0;
			for (let i = 0; i < 64; i++) {
				let F, g;
				if (i < 16) { F = (B & C) | (~B & D); g = i; }
				else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
				else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
				else { F = C ^ (B | ~D); g = (7 * i) % 16; }
				F = (F + A + K[i] + w[c * 16 + g]) >>> 0;
				A = D; D = C; C = B; B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
			}
			a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
		}
		const out = new Uint8Array(16);
		[a0, b0, c0, d0].forEach((v, k) => { for (let j = 0; j < 4; j++) out[k * 4 + j] = (v >>> (8 * j)) & 255; });
		return out;
	}
	function offlineUUID(name) {
		const h = md5(new TextEncoder().encode("OfflinePlayer:" + name));
		h[6] = (h[6] & 0x0f) | 0x30; h[8] = (h[8] & 0x3f) | 0x80;
		return h;
	}

	// ------------------------------------------------------------------ signaling (ntfy.sh pub/sub)
	const topicFor = (code, sub) => "mpk-" + code.toLowerCase() + (sub ? "-" + sub.toLowerCase() : "");
	function publish(topic, obj) {
		return fetch("https://" + SIGNAL_HOST + "/" + topic, { method: "POST", body: JSON.stringify(obj) });
	}
	// subscribe(topic, onMessage) -> Promise<{close()}> resolved once listening
	function subscribe(topic, onMessage) {
		return new Promise((resolve, reject) => {
			let ws, closed = false, opened = false, retry = 0;
			const handle = { close() { closed = true; try { ws.close(); } catch (e) {} } };
			const connect = () => {
				ws = new WebSocket("wss://" + SIGNAL_HOST + "/" + topic + "/ws");
				ws.onopen = () => { retry = 0; if (!opened) { opened = true; resolve(handle); } };
				ws.onmessage = (ev) => {
					let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
					if (m.event !== "message") return;
					let body; try { body = JSON.parse(m.message); } catch (e) { return; }
					onMessage(body);
				};
				ws.onclose = () => {
					if (closed) return;
					if (!opened) { reject(new Error("Couldn't reach the matchmaking service")); return; }
					setTimeout(connect, Math.min(10000, 500 * 2 ** retry++));      // reconnect while LAN stays open
				};
			};
			connect();
		});
	}
	function iceComplete(pc, ms) {
		return new Promise((r) => {
			if (pc.iceGatheringState === "complete") return r();
			const t = setTimeout(r, ms);
			pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); r(); } });
		});
	}

	// ------------------------------------------------------------------ data channel framing
	// Each message: [flags][payload]; flags bit0 = more pieces follow, bit1 = text frame.
	function dcSend(dc, data, isText) {
		if (!dc || dc.readyState !== "open") return;
		const bytes = isText ? new TextEncoder().encode(data) : (data instanceof Uint8Array ? data : new Uint8Array(data));
		let off = 0;
		do {
			const n = Math.min(PIECE, bytes.length - off), more = off + n < bytes.length;
			const m = new Uint8Array(n + 1);
			m[0] = (more ? 1 : 0) | (isText ? 2 : 0);
			m.set(bytes.subarray(off, off + n), 1);
			dc.send(m);
			off += n;
		} while (off < bytes.length);
	}
	function dcReceiver(onFrame) {
		let parts = [];
		return (ev) => {
			const d = new Uint8Array(ev.data);
			if (!d.length) return;
			parts.push(d.subarray(1));
			if (d[0] & 1) return;
			let total = 0; for (const p of parts) total += p.length;
			const all = new Uint8Array(total); let o = 0;
			for (const p of parts) { all.set(p, o); o += p.length; }
			parts = [];
			onFrame(all, (d[0] & 2) !== 0);
		};
	}

	/* ============================================================================================
	 * HOST SIDE
	 * ========================================================================================== */
	let state = "closed", code = "", lanError = "", signal = null;
	let worldOpen = false;                   // a singleplayer world is running in the worker
	const friends = new Map();               // id -> friend
	const channels = new Map();              // worker channel name -> friend

	function toWorker(ch, bytes) {
		if (!self.__mosspackLanSend) return;
		const copy = new Uint8Array(bytes.length); copy.set(bytes);
		self.__mosspackLanSend(ch, copy.buffer);
	}
	const chatJSON = (text) => JSON.stringify({ text });

	function kickDuringHandshake(f, text) {
		const e = new TextEncoder().encode(chatJSON(text));
		dcSend(f.dc, new Out().u8(6).u16(e.length).bytes(e).build());       // 0x06 DENY_LOGIN
		setTimeout(() => closeFriend(f), 400);
		dropFriend(f, null);
	}
	function closeFriend(f) {
		try { f.dc && f.dc.close(); } catch (e) {}
		try { f.pc && f.pc.close(); } catch (e) {}
	}
	function dropFriend(f, why) {
		if (!friends.has(f.id)) return;
		friends.delete(f.id);
		if (f.channel) {
			channels.delete(f.channel);
			toWorker(IPC, new Out().u8(0x0c).javaUTF(f.channel).u8(0).build());
			if (f.loggedIn) toast(`${f.name} left the game`);
		}
		closeFriend(f);
		render();
	}

	// Server side of the login handshake (the protocol multiplayer servers speak to this client)
	function onFriendData(f, data, isText) {
		try {
			if (isText) {                                                    // server-list ping
				if (/^accept:\s*motd/i.test(new TextDecoder().decode(data))) dcSend(f.dc, JSON.stringify(motd()), true);
				return;
			}
			if (f.stage === "play") return forwardToWorker(f, data);
			const r = new In(data), type = r.u8();
			if (f.stage === "version") {
				if (type !== 1) return kickDuringHandshake(f, "Unsupported client");
				r.u8();
				const protos = []; for (let n = r.u16(); n > 0; n--) protos.push(r.u16());
				const mcs = []; for (let n = r.u16(); n > 0; n--) mcs.push(r.u16());
				f.brand = r.ascii8(); f.version = r.ascii8(); r.u8(); f.name = r.ascii8();
				if (!mcs.includes(MC_PROTOCOL)) return kickDuringHandshake(f, "This world needs Minecraft 1.12.2");
				f.proto = protos.includes(4) ? 4 : protos.includes(3) ? 3 : 0;
				if (!f.proto) return kickDuringHandshake(f, "Your game is too old for this world");
				dcSend(f.dc, new Out().u8(2).u16(f.proto).u16(MC_PROTOCOL).ascii8("Mosspack").ascii8("1.12.2").u8(0).u16(0).build());
				f.stage = "login";
			} else if (f.stage === "login") {
				if (type !== 4) return kickDuringHandshake(f, "Unexpected login packet");
				f.name = r.ascii8(); r.ascii8();
				if (!/^[A-Za-z0-9_]{1,16}$/.test(f.name)) return kickDuringHandshake(f, "Invalid username");
				for (const o of friends.values()) {
					if (o !== f && o.loggedIn && o.name.toLowerCase() === f.name.toLowerCase())
						return kickDuringHandshake(f, `Someone called ${f.name} is already playing`);
				}
				f.uuid = offlineUUID(f.name);
				dcSend(f.dc, new Out().u8(5).ascii8(f.name).bytes(f.uuid).build());   // 0x05 ALLOW_LOGIN
				f.profile = {};
				f.stage = "profile";
			} else if (f.stage === "profile") {
				if (type === 7) {
					if (f.proto >= 4) { for (let n = r.u8(); n > 0; n--) { const k = r.ascii8(); f.profile[k] = r.bytes(r.u16()).slice(); } }
					else { const k = r.ascii8(); f.profile[k] = r.bytes(r.u16()).slice(); }
				} else if (type === 8) {
					dcSend(f.dc, new Out().u8(9).build());                   // 0x09 FINISH_LOGIN
					startPlayer(f);
				} else {
					return kickDuringHandshake(f, "Unexpected profile packet");
				}
			}
		} catch (e) {
			console.error("[Mosspack LAN] handshake error", e);
			kickDuringHandshake(f, "Couldn't join");
		}
	}

	function startPlayer(f) {
		f.channel = "NET|mosspack-" + f.id;
		f.stage = "play"; f.loggedIn = false; f.queue = []; f.frag = [];
		channels.set(f.channel, f);
		toWorker(IPC, new Out().u8(0x0c).javaUTF(f.channel).u8(1).build());  // IPC 0x0C open player channel
		const skin = f.profile["skin_v2"] || f.profile["skin_v1"] || new Uint8Array(0);
		const cape = f.profile["cape_v1"] || new Uint8Array(0);
		const brand = f.profile["brand_uuid_v1"] && f.profile["brand_uuid_v1"].length === 16 ? f.profile["brand_uuid_v1"] : new Uint8Array(16);
		const protoData = new Out().u16(1).u16(f.proto).build();
		// CPacketLoginStart (login id 0x00): name, skin, cape, protocol data, brand uuid
		sendOnChannel(f, new Out().varint(0).mcString(f.name).byteArray(skin).byteArray(cape).byteArray(protoData).bytes(brand).build());
		render();
	}
	function sendOnChannel(f, pkt) {
		const m = new Uint8Array(pkt.length + 1); m[0] = 0; m.set(pkt, 1);
		toWorker(f.channel, m);
	}
	function forwardToWorker(f, pkt) {
		if (!f.loggedIn) { f.queue.push(pkt); return; }
		sendOnChannel(f, pkt);
	}

	// Worker -> friend. For non-local players the integrated server frames packets as [0][packet] or
	// [2][u32 length][deflate(packet)] (1 KB and up); either may be split into [1][piece]... pieces.
	async function inflate(bytes) {
		for (const fmt of ["deflate", "deflate-raw"]) {
			try {
				const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(fmt));
				return new Uint8Array(await new Response(s).arrayBuffer());
			} catch (e) {}
		}
		throw new Error("could not decompress packet");
	}
	function fromWorker(f, buf) {
		const d = new Uint8Array(buf);
		if (!d.length) return;
		if (d[0] === 1) { f.frag.push(d.subarray(1).slice()); return; }
		let body = d.subarray(1);
		if (f.frag.length) {
			const parts = f.frag.concat([body]); f.frag = [];
			let total = 0; for (const p of parts) total += p.length;
			body = new Uint8Array(total); let o = 0;
			for (const p of parts) { body.set(p, o); o += p.length; }
		} else body = body.slice();
		const compressed = d[0] === 2;
		f.chain = (f.chain || Promise.resolve()).then(async () => {            // keep packets in order
			const pkt = compressed ? await inflate(body.subarray(4)) : body;
			if (friends.has(f.id)) handleFromWorker(f, pkt);
		}).catch((e) => console.error("[Mosspack LAN] dropped a packet for " + f.name, e));
	}
	function handleFromWorker(f, pkt) {
		if (!f.loggedIn) {
			const r = new In(pkt), id = r.varint();
			if (id === 0x02) {                                               // login success: in the world
				f.loggedIn = true;
				toast(`${f.name} joined the game`);
				for (const q of f.queue) sendOnChannel(f, q);
				f.queue = [];
				render();
			} else if (id === 0x00) {                                        // refused -> play disconnect 0x1A
				const reason = r.left() ? new TextDecoder().decode(r.bytes(r.varint())) : chatJSON("Disconnected");
				dcSend(f.dc, new Out().varint(0x1a).mcString(reason).build());
				setTimeout(() => closeFriend(f), 400);
				dropFriend(f, "refused");
			}
			return;
		}
		dcSend(f.dc, pkt);
	}

	self.__mosspackLanRecv = function (ch, buf) {
		if (ch === LOCAL) { worldOpen = true; return false; }
		const f = channels.get(ch);
		if (f) { fromWorker(f, buf); return true; }
		if (ch === IPC && channels.size) {
			const d = new Uint8Array(buf);
			if (d.length > 3 && d[0] === 0x0c) {                             // the world closed a player's channel
				try {
					const r = new In(d); r.u8(); const name = r.javaUTF(), open = r.u8();
					const g = channels.get(name);
					if (g && !open) { setTimeout(() => closeFriend(g), 400); dropFriend(g, "disconnected"); return true; }
				} catch (e) {}
			}
		}
		return false;
	};
	self.__mosspackLanFilterOut = function (ch, bytes) {
		if (ch !== IPC || !bytes || !bytes.length) return false;
		const id = bytes[0] & 255;
		if (id === 0x01) { worldOpen = false; if (state !== "closed") closeLan(); }     // world is closing
		else if (id === 0x0b && bytes.length > 1 && bytes[1] && state === "open") return true;   // keep running
		return false;
	};

	function acceptOffer(m) {
		if (!m || m.t !== "offer" || typeof m.id !== "string" || typeof m.sdp !== "string") return;
		const id = m.id.replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
		if (!id || [...friends.values()].some((f) => f.peer === id)) return;
		const pc = new RTCPeerConnection({ iceServers: iceServers() });
		const f = { id: randomCode(8), peer: id, pc, dc: null, stage: "version", name: "", addr: "online" };
		friends.set(f.id, f);
		pc.ondatachannel = (ev) => {
			f.dc = ev.channel; f.dc.binaryType = "arraybuffer";
			f.dc.onmessage = dcReceiver((data, isText) => onFriendData(f, data, isText));
			f.dc.onclose = () => dropFriend(f, "left");
		};
		pc.onconnectionstatechange = () => { if (pc.connectionState === "failed" || pc.connectionState === "closed") dropFriend(f, "connection lost"); };
		(async () => {
			await pc.setRemoteDescription({ type: "offer", sdp: m.sdp });
			await pc.setLocalDescription(await pc.createAnswer());
			await iceComplete(pc, 3000);
			await publish(topicFor(code, id), { t: "answer", sdp: pc.localDescription.sdp });
		})().catch((e) => { console.error("[Mosspack LAN] couldn't answer a join request", e); dropFriend(f, null); });
		setTimeout(() => { if (friends.has(f.id) && f.stage === "version" && !(f.dc && f.dc.readyState === "open")) dropFriend(f, null); }, 30000);
	}

	async function openLan() {
		if (state === "open" || state === "opening") return render();
		if (!worldOpen) { state = "noworld"; return render(); }
		state = "opening"; lanError = ""; render();
		code = window.__mosspackLanFixedCode || randomCode(6);                // fixed code: automated tests only
		try {
			signal = await subscribe(topicFor(code), acceptOffer);
		} catch (e) {
			state = "error"; lanError = "Couldn't reach the internet to open LAN. Check your connection and try again."; return render();
		}
		state = "open";
		toWorker(IPC, new Out().u8(0x0b).u8(0).build());                    // un-pause: the pause menu is open
		render();
	}
	function closeLan() {
		state = "closed";
		if (signal) { signal.close(); signal = null; }
		for (const f of [...friends.values()]) { dropFriend(f, null); }
		render();
	}
	const players = () => [...friends.values()].filter((f) => f.loggedIn).map((f) => f.name);
	function motd() {
		const p = players();
		return {
			type: "motd", name: "Mosspack LAN", brand: "Mosspack", vers: "Mosspack 1.12.2", cracked: true, time: Date.now(),
			uuid: "00000000-0000-0000-0000-000000000000",
			data: { cache: false, icon: false, online: p.length + 1, max: 8, players: p, motd: ["§aLAN world", "§7hosted with Mosspack"] },
		};
	}

	/* ============================================================================================
	 * FRIEND SIDE: "ws://K7QX9P" becomes a WebRTC connection to that host
	 * ========================================================================================== */
	const RealWebSocket = window.WebSocket;
	const LAN_URL = new RegExp("^wss?://([" + CODE_CHARS + "]{6})/?$", "i");

	class LanSocket extends EventTarget {
		constructor(url, lanCode) {
			super();
			this.url = url; this.binaryType = "arraybuffer"; this.readyState = 0; this.protocol = ""; this.extensions = ""; this.bufferedAmount = 0;
			this.onopen = this.onmessage = this.onclose = this.onerror = null;
			this._code = lanCode.toUpperCase();
			this._connect().catch((e) => { console.warn("[Mosspack LAN]", e.message || e); this._fail(); });
		}
		_emit(type, init) {
			const ev = type === "message" ? new MessageEvent("message", init) : type === "close" ? new CloseEvent("close", init) : new Event(type);
			this.dispatchEvent(ev);
			const h = this["on" + type]; if (typeof h === "function") h.call(this, ev);
		}
		_fail() {
			if (this.readyState === 3) return;
			const wasOpen = this.readyState === 1;
			this.readyState = 3;
			if (!wasOpen) this._emit("error");
			this._emit("close", { code: 1006, reason: "", wasClean: false });
			this._cleanup();
		}
		_cleanup() {
			try { this._sub && this._sub.close(); } catch (e) {}
			try { this._dc && this._dc.close(); } catch (e) {}
			try { this._pc && this._pc.close(); } catch (e) {}
		}
		async _connect() {
			const me = randomCode(10);
			let answered;
			const answer = new Promise((r) => { answered = r; });
			this._sub = await subscribe(topicFor(this._code, me), (m) => { if (m && m.t === "answer" && typeof m.sdp === "string") answered(m.sdp); });
			const pc = this._pc = new RTCPeerConnection({ iceServers: iceServers() });
			const dc = this._dc = pc.createDataChannel("mosspack", { ordered: true });
			dc.binaryType = "arraybuffer";
			dc.onmessage = dcReceiver((data, isText) => {
				if (this.readyState !== 1) return;
				this._emit("message", { data: isText ? new TextDecoder().decode(data) : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) });
			});
			dc.onopen = () => { this._sub.close(); this.readyState = 1; this._emit("open"); };
			dc.onclose = () => this._fail();
			pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") this._fail(); };
			await pc.setLocalDescription(await pc.createOffer());
			await iceComplete(pc, 3000);
			await publish(topicFor(this._code), { t: "offer", id: me, sdp: pc.localDescription.sdp });
			const sdp = await Promise.race([answer, new Promise((_, j) => setTimeout(() => j(new Error("No LAN world answered with code " + this._code)), 15000))]);
			if (this.readyState === 3) return;
			await pc.setRemoteDescription({ type: "answer", sdp });
			setTimeout(() => { if (this.readyState === 0) this._fail(); }, 20000);
		}
		send(data) {
			if (this.readyState !== 1) return;
			if (typeof data === "string") return dcSend(this._dc, data, true);
			const view = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
			dcSend(this._dc, view.slice());                                  // copy: the view may point into game memory
		}
		close() {
			if (this.readyState === 3) return;
			this.readyState = 3;
			this._emit("close", { code: 1000, reason: "", wasClean: true });
			this._cleanup();
		}
	}
	LanSocket.CONNECTING = 0; LanSocket.OPEN = 1; LanSocket.CLOSING = 2; LanSocket.CLOSED = 3;

	function MosspackWebSocket(url, protocols) {
		const m = typeof url === "string" && url.match(LAN_URL);
		if (m) return new LanSocket(url, m[1]);
		return protocols === undefined ? new RealWebSocket(url) : new RealWebSocket(url, protocols);
	}
	MosspackWebSocket.prototype = RealWebSocket.prototype;
	for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) MosspackWebSocket[k] = RealWebSocket[k];
	window.WebSocket = MosspackWebSocket;

	// "Open to LAN" in the pause menu opens the link mosspack:lan
	const realOpen = window.open;
	window.open = function (url) {
		if (typeof url === "string" && url.indexOf("mosspack:") === 0) { openLan(); return null; }
		return realOpen.apply(window, arguments);
	};

	/* ============================================================================================
	 * UI: LAN panel + toasts
	 * ========================================================================================== */
	const CSS = `
	#mosspack-lan,#mosspack-toasts{font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
	#mosspack-lan{position:fixed;top:16px;right:16px;z-index:200;width:330px;max-width:calc(100vw - 32px);
		background:#1c2417;color:#e9eee3;border:2px solid #34422b;border-radius:6px;box-shadow:0 4px 0 #0b0e09,0 14px 30px rgba(0,0,0,.45);padding:16px}
	#mosspack-lan h3{margin:0 0 8px;font:700 15px/1.2 Menlo,Consolas,monospace;letter-spacing:.03em;display:flex;align-items:center;gap:8px}
	#mosspack-lan .dot{width:9px;height:9px;border-radius:50%;background:#e8b84a}
	#mosspack-lan .dot.on{background:#6fbf4a;box-shadow:0 0 0 3px rgba(111,191,74,.2)}
	#mosspack-lan .x{margin-left:auto;background:none;border:none;color:#a8b59c;font-size:18px;cursor:pointer;line-height:1;padding:0 2px}
	#mosspack-lan p{margin:6px 0;color:#a8b59c}
	#mosspack-lan .code{display:flex;gap:8px;align-items:center;margin:10px 0}
	#mosspack-lan .code b{flex:1;text-align:center;font:700 28px/1 Menlo,Consolas,monospace;letter-spacing:.18em;background:#0f140c;border:1px solid #34422b;border-radius:5px;padding:12px 6px;color:#cfe8bf;user-select:all}
	#mosspack-lan button.b{background:#232d1d;color:#e9eee3;border:1px solid #34422b;border-radius:4px;padding:8px 11px;font:600 13px/1 inherit;font-family:inherit;cursor:pointer}
	#mosspack-lan button.b:hover{border-color:#6fbf4a}
	#mosspack-lan ol{margin:6px 0 0;padding-left:20px;color:#a8b59c}
	#mosspack-lan ul{margin:6px 0 0;padding-left:18px}
	#mosspack-lan .row{display:flex;gap:8px;margin-top:12px}
	#mosspack-lan .small{font-size:12px;color:#7f8c75}
	#mosspack-toasts{position:fixed;top:18px;left:0;right:0;z-index:201;display:flex;flex-direction:column;gap:6px;align-items:center;pointer-events:none}
	#mosspack-toasts div{background:rgba(16,20,13,.92);color:#f3e96b;border:1px solid #34422b;border-radius:4px;padding:7px 14px;font:600 14px/1.2 Menlo,Consolas,monospace;
		box-shadow:0 3px 0 #0b0e09;animation:mp-in .2s ease-out}
	@keyframes mp-in{from{opacity:0}to{opacity:1}}`;
	let styled = false, panel = null, toasts = null;
	function ensureStyle() { if (styled) return; const s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s); styled = true; }
	function el(tag, attrs, ...kids) {
		const e = document.createElement(tag);
		for (const k in attrs || {}) {
			if (k.startsWith("on")) e.addEventListener(k.slice(2), attrs[k]);
			else e.setAttribute(k, attrs[k]);
		}
		for (const c of kids) if (c != null) e.append(c);
		return e;
	}
	// Buttons never take keyboard focus, so Esc and game keys keep working after you click them.
	function btn(label, onClick, cls = "b") {
		const b = el("button", { class: cls, type: "button", tabindex: "-1" }, label);
		b.addEventListener("mousedown", (e) => e.preventDefault());
		b.addEventListener("click", (e) => { e.preventDefault(); b.blur(); onClick(b); });
		return b;
	}
	function toast(text) {
		ensureStyle();
		if (!toasts) { toasts = el("div", { id: "mosspack-toasts" }); document.body.appendChild(toasts); }
		const t = el("div", {}, text);
		toasts.appendChild(t);
		setTimeout(() => t.remove(), 5000);
	}
	function copy(text, b) {
		const done = (ok) => { b.textContent = ok ? "Copied" : "Copy failed"; setTimeout(() => { b.textContent = "Copy"; }, 1500); };
		try { navigator.clipboard.writeText(text).then(() => done(true), () => done(false)); } catch (e) { done(false); }
	}
	function render() {
		if (state === "closed") { if (panel) { panel.remove(); panel = null; } return; }
		ensureStyle();
		if (!panel) { panel = el("div", { id: "mosspack-lan" }); document.body.appendChild(panel); }
		panel.textContent = "";
		const head = (on, title) => el("h3", {}, el("span", { class: "dot" + (on ? " on" : "") }), title,
			btn("×", () => { if (state === "open") { panel.remove(); panel = null; } else { state = "closed"; render(); } }, "x"));
		if (state === "noworld") {
			panel.append(head(false, "Open to LAN"), el("p", {}, "Open a singleplayer world first, then press Esc → Open to LAN."));
		} else if (state === "opening") {
			panel.append(head(false, "Opening LAN…"), el("p", {}, "Getting a join code…"));
		} else if (state === "error") {
			panel.append(head(false, "Couldn't open LAN"), el("p", {}, lanError), el("div", { class: "row" }, btn("Try again", () => { state = "closed"; openLan(); })));
		} else if (state === "open") {
			const list = players();
			panel.append(head(true, "LAN is open"),
				el("div", { class: "code" }, el("b", {}, code), btn("Copy", (b) => copy(code, b))),
				el("p", {}, "Friends can join from any Wi-Fi:"),
				el("ol", {}, el("li", {}, "Open Mosspack"), el("li", {}, "Multiplayer → Direct Connect"), el("li", {}, "Type the code → Join Server")),
				el("p", {}, list.length ? `Playing with you (${list.length}):` : "No one has joined yet."));
			if (list.length) panel.append(el("ul", {}, ...list.map((n) => el("li", {}, n))));
			panel.append(el("div", { class: "row" }, btn("Close LAN", closeLan)),
				el("p", { class: "small" }, "Your world keeps running while LAN is open. Some school and work networks block direct connections."));
		}
	}
	setInterval(() => { if (panel && state === "open") render(); }, 3000);

	window.__mosspackLAN = {
		open: openLan, close: closeLan, toast,
		status() { return { state, code, players: players(), world: worldOpen }; },
	};
})();
