
/* ================================================================================================
 * Mosspack LAN: friends join your singleplayer world from any network. No server, all in the page.
 *
 *   Host:   Esc → Open to LAN shows a 6-character code (e.g. K7QX9P).
 *   Friend: Multiplayer → Direct Connect → type the code → Join Server.
 *
 * The friend's game connects to "ws://K7QX9P". window.WebSocket is wrapped so that address becomes a
 * LanSocket: a WebSocket look-alike backed by a WebRTC data channel to the host's browser. The two browsers
 * swap WebRTC offers/answers through ntfy.sh (public pub/sub) on topics derived from the code; game traffic
 * then flows directly. The host page answers the friend's login handshake (the protocol multiplayer servers
 * use), opens a player channel in its world worker (IPC 0x0C), sends the login-start packet the worker
 * expects and forwards Minecraft packets both ways.
 * Uses Mosspack core (core.js).
 * ============================================================================================= */
(function () {
	"use strict";
	const M = self.Mosspack;
	if (!M) return;
	const { Out, In, IPC } = M;

	const MC_PROTOCOL = 340;
	const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";       // no 0/O, 1/I/L
	const SIGNAL_HOST = "ntfy.sh";
	const PIECE = 16000;                                        // data-channel payload bytes per message
	const ICE_WAIT_MS = 5000;
	const opts = () => window.eaglercraftXOpts || {};
	const iceServers = () => opts().mosspackIceServers || [
		{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"] },
		{ urls: "stun:stun.cloudflare.com:3478" },
	];
	const randomCode = (n) => {
		const r = crypto.getRandomValues(new Uint8Array(n)); let s = "";
		for (let i = 0; i < n; i++) s += CODE_CHARS[r[i] % CODE_CHARS.length];
		return s;
	};
	const chatJSON = (text) => JSON.stringify({ text });

	// offline UUID, the same MD5 name-based UUID vanilla gives offline players
	function md5(bytes) {
		const K = [], S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
		for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
		const len = bytes.length, n = ((len + 8) >>> 6) + 1, w = new Uint32Array(n * 16);
		for (let i = 0; i < len; i++) w[i >> 2] |= bytes[i] << ((i % 4) * 8);
		w[len >> 2] |= 0x80 << ((len % 4) * 8);
		w[n * 16 - 2] = (len * 8) >>> 0; w[n * 16 - 1] = Math.floor(len / 536870912);
		let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
		for (let c = 0; c < n; c++) {
			let A = a0, B = b0, C = c0, D = d0;
			for (let i = 0; i < 64; i++) {
				const round = i >> 4;
				let F, g;
				if (round === 0) { F = (B & C) | (~B & D); g = i; }
				else if (round === 1) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
				else if (round === 2) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
				else { F = C ^ (B | ~D); g = (7 * i) % 16; }
				const s = S[round * 4 + (i & 3)];
				F = (F + A + K[i] + w[c * 16 + g]) >>> 0;
				A = D; D = C; C = B; B = (B + ((F << s) | (F >>> (32 - s)))) >>> 0;
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
	const publish = (topic, obj) => fetch("https://" + SIGNAL_HOST + "/" + topic, { method: "POST", body: JSON.stringify(obj) });
	// resolves with {close()} once listening; reconnects while open
	function subscribe(topic, onMessage) {
		return new Promise((resolve, reject) => {
			let ws, closed = false, opened = false, retry = 0;
			const handle = { close() { closed = true; try { ws.close(); } catch (e) {} } };
			const connect = () => {
				ws = new RealWebSocket("wss://" + SIGNAL_HOST + "/" + topic + "/ws");
				ws.onopen = () => { retry = 0; if (!opened) { opened = true; resolve(handle); } };
				ws.onmessage = (ev) => {
					try {
						const m = JSON.parse(ev.data);
						if (m.event === "message") onMessage(JSON.parse(m.message));
					} catch (e) {}
				};
				ws.onclose = () => {
					if (closed) return;
					if (!opened) return reject(new Error("offline"));
					setTimeout(connect, Math.min(10000, 500 * 2 ** retry++));
				};
			};
			connect();
		});
	}
	function iceComplete(pc) {
		return new Promise((r) => {
			if (pc.iceGatheringState === "complete") return r();
			const t = setTimeout(r, ICE_WAIT_MS);
			pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); r(); } });
		});
	}

	// ------------------------------------------------------------------ data channel framing
	// each message: [flags][payload]; flags bit0 = more pieces follow, bit1 = text frame
	function dcSend(dc, data, isText) {
		if (!dc || dc.readyState !== "open") return;
		const bytes = isText ? new TextEncoder().encode(data) : data;
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
			const all = concat(parts); parts = [];
			onFrame(all, (d[0] & 2) !== 0);
		};
	}
	function concat(parts) {
		if (parts.length === 1) return parts[0].slice();
		let total = 0; for (const p of parts) total += p.length;
		const all = new Uint8Array(total); let o = 0;
		for (const p of parts) { all.set(p, o); o += p.length; }
		return all;
	}

	/* ============================================================================================
	 * HOST
	 * ========================================================================================== */
	let state = "closed", code = "", lanError = "", signal = null;
	const friends = new Map();               // id -> friend
	const channels = new Map();              // worker channel name -> friend

	const closePeer = (f) => { try { f.dc && f.dc.close(); } catch (e) {} try { f.pc && f.pc.close(); } catch (e) {} };
	function dropFriend(f, closeSoon) {
		if (!friends.has(f.id)) return;
		friends.delete(f.id);
		if (f.channel) {
			channels.delete(f.channel);
			M.toWorker(IPC, new Out().u8(0x0c).javaUTF(f.channel).u8(0).build());   // close the player channel
			if (f.loggedIn) M.toast(`${f.name} left the game`);
		}
		if (closeSoon) setTimeout(() => closePeer(f), 400); else closePeer(f);
		render();
	}
	function deny(f, text) {                                                  // 0x06 DENY_LOGIN
		const e = new TextEncoder().encode(chatJSON(text));
		dcSend(f.dc, new Out().u8(6).u16(e.length).bytes(e).build());
		dropFriend(f, true);
	}

	// server side of the login handshake
	function onFriendData(f, data, isText) {
		try {
			if (isText) {                                                        // server-list ping
				if (/^accept:\s*motd/i.test(new TextDecoder().decode(data))) dcSend(f.dc, JSON.stringify(motd()), true);
				return;
			}
			if (f.stage === "play") return forwardToWorker(f, data);
			const r = new In(data), type = r.u8();
			if (f.stage === "version") {
				if (type !== 1) return deny(f, "Unsupported client");
				r.u8();
				const protos = []; for (let n = r.u16(); n > 0; n--) protos.push(r.u16());
				const mcs = []; for (let n = r.u16(); n > 0; n--) mcs.push(r.u16());
				r.ascii8(); r.ascii8(); r.u8(); f.name = r.ascii8();
				if (!mcs.includes(MC_PROTOCOL)) return deny(f, "This world needs Minecraft 1.12.2");
				f.proto = protos.includes(4) ? 4 : protos.includes(3) ? 3 : 0;
				if (!f.proto) return deny(f, "Your game is too old for this world");
				dcSend(f.dc, new Out().u8(2).u16(f.proto).u16(MC_PROTOCOL).ascii8("Mosspack").ascii8("1.12.2").u8(0).u16(0).build());
				f.stage = "login";
			} else if (f.stage === "login") {
				if (type !== 4) return deny(f, "Unexpected login packet");
				f.name = r.ascii8(); r.ascii8();
				if (!/^[A-Za-z0-9_]{1,16}$/.test(f.name)) return deny(f, "Invalid username");
				for (const o of friends.values()) {
					if (o !== f && o.loggedIn && o.name.toLowerCase() === f.name.toLowerCase()) return deny(f, `Someone called ${f.name} is already playing`);
				}
				dcSend(f.dc, new Out().u8(5).ascii8(f.name).bytes(offlineUUID(f.name)).build());   // 0x05 ALLOW_LOGIN
				f.profile = {};
				f.stage = "profile";
			} else if (f.stage === "profile") {
				if (type === 7) {                                                // profile data (skin, cape, brand)
					const n = f.proto >= 4 ? r.u8() : 1;
					for (let i = 0; i < n; i++) { const k = r.ascii8(); f.profile[k] = r.bytes(r.u16()).slice(); }
				} else if (type === 8) {
					dcSend(f.dc, new Out().u8(9).build());                       // 0x09 FINISH_LOGIN
					startPlayer(f);
				} else {
					return deny(f, "Unexpected profile packet");
				}
			}
		} catch (e) {
			console.error("[Mosspack LAN] handshake error", e);
			deny(f, "Couldn't join");
		}
	}

	function startPlayer(f) {
		Object.assign(f, { channel: "NET|mosspack-" + f.id, stage: "play", loggedIn: false, queue: [], frag: [] });
		channels.set(f.channel, f);
		M.toWorker(IPC, new Out().u8(0x0c).javaUTF(f.channel).u8(1).build());  // open the player channel
		const p = f.profile;
		const brand = p.brand_uuid_v1 && p.brand_uuid_v1.length === 16 ? p.brand_uuid_v1 : new Uint8Array(16);
		// CPacketLoginStart (login 0x00): name, skin, cape, protocol data, brand uuid
		sendOnChannel(f, new Out().varint(0).mcString(f.name).byteArray(p.skin_v2 || p.skin_v1 || new Uint8Array(0))
			.byteArray(p.cape_v1 || new Uint8Array(0)).byteArray(new Out().u16(1).u16(f.proto).build()).bytes(brand).build());
		render();
	}
	function sendOnChannel(f, pkt) {
		const m = new Uint8Array(pkt.length + 1); m.set(pkt, 1);                 // [0] = whole packet
		M.toWorker(f.channel, m);
	}
	function forwardToWorker(f, pkt) {
		if (f.loggedIn) sendOnChannel(f, pkt); else f.queue.push(pkt);
	}

	// Worker -> friend. Non-local players get [0][packet] or [2][u32 length][deflate(packet)] (1 KB and up);
	// either may arrive split into [1][piece]... pieces before the final [0]/[2] piece.
	async function inflate(bytes) {
		for (const fmt of ["deflate", "deflate-raw"]) {
			try { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream(fmt))).arrayBuffer()); }
			catch (e) {}
		}
		throw new Error("could not decompress packet");
	}
	function fromWorker(f, buf) {
		const d = new Uint8Array(buf);
		if (!d.length) return;
		if (d[0] === 1) { f.frag.push(d.slice(1)); return; }
		f.frag.push(d.subarray(1));
		const body = concat(f.frag); f.frag = [];
		const compressed = d[0] === 2;
		f.chain = (f.chain || Promise.resolve()).then(async () => {          // decompression is async; keep order
			const pkt = compressed ? await inflate(body.subarray(4)) : body;
			if (friends.has(f.id)) handleFromWorker(f, pkt);
		}).catch((e) => console.error("[Mosspack LAN] dropped a packet for " + f.name, e));
	}
	function handleFromWorker(f, pkt) {
		if (f.loggedIn) return dcSend(f.dc, pkt);
		const r = new In(pkt), id = r.varint();
		if (id === 0x02) {                                                       // login success
			f.loggedIn = true;
			M.toast(`${f.name} joined the game`);
			for (const q of f.queue) sendOnChannel(f, q);
			f.queue = [];
			render();
		} else if (id === 0x00) {                                                // refused -> play disconnect (0x1A)
			dcSend(f.dc, new Out().varint(0x1a).mcString(r.left() ? r.mcString() : chatJSON("Disconnected")).build());
			dropFriend(f, true);
		}
	}

	M.onRecv((ch, buf) => {
		const f = channels.get(ch);
		if (f) { fromWorker(f, buf); return true; }
		if (ch === IPC && channels.size) {
			const d = new Uint8Array(buf);
			if (d.length > 3 && d[0] === 0x0c) {                                 // the world closed a player's channel
				try {
					const r = new In(d, 1), name = r.javaUTF(), g = channels.get(name);
					if (g && !r.u8()) { dropFriend(g, true); return true; }
				} catch (e) {}
			}
		}
		return false;
	});
	// while LAN is open the world keeps running: drop the pause menu's IPCPacket0BPause(true)
	M.onSend((ch, bytes) => ch === IPC && state === "open" && (bytes[0] & 255) === 0x0b && bytes.length > 1 && !!bytes[1]);
	M.onWorld((open) => { if (!open && state !== "closed") closeLan(); });

	function acceptOffer(m) {
		if (!m || m.t !== "offer" || typeof m.id !== "string" || typeof m.sdp !== "string") return;
		const peer = m.id.replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
		if (!peer || [...friends.values()].some((f) => f.peer === peer)) return;
		const pc = new RTCPeerConnection({ iceServers: iceServers() });
		const f = { id: randomCode(8), peer, pc, dc: null, stage: "version", name: "" };
		friends.set(f.id, f);
		pc.ondatachannel = (ev) => {
			f.dc = ev.channel; f.dc.binaryType = "arraybuffer";
			f.dc.onmessage = dcReceiver((data, isText) => onFriendData(f, data, isText));
			f.dc.onclose = () => dropFriend(f);
		};
		pc.onconnectionstatechange = () => { if (pc.connectionState === "failed" || pc.connectionState === "closed") dropFriend(f); };
		(async () => {
			await pc.setRemoteDescription({ type: "offer", sdp: m.sdp });
			await pc.setLocalDescription(await pc.createAnswer());
			await iceComplete(pc);
			await publish(topicFor(code, peer), { t: "answer", sdp: pc.localDescription.sdp });
		})().catch((e) => { console.error("[Mosspack LAN] couldn't answer a join request", e); dropFriend(f); });
		setTimeout(() => { if (friends.has(f.id) && !(f.dc && f.dc.readyState === "open")) dropFriend(f); }, 30000);
	}

	async function openLan() {
		if (state === "open" || state === "opening") return render();
		if (!M.world) { state = "noworld"; return render(); }
		state = "opening"; lanError = ""; render();
		code = window.__mosspackLanFixedCode || randomCode(6);                    // fixed code: automated tests only
		try {
			signal = await subscribe(topicFor(code), acceptOffer);
		} catch (e) {
			state = "error"; lanError = "Couldn't reach the internet to open LAN. Check your connection and try again."; return render();
		}
		state = "open";
		M.toWorker(IPC, new Out().u8(0x0b).u8(0).build());                       // un-pause (the pause menu is open)
		render();
	}
	function closeLan() {
		state = "closed";
		if (signal) { signal.close(); signal = null; }
		for (const f of [...friends.values()]) dropFriend(f);
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
	 * FRIEND: "ws://K7QX9P" becomes a WebRTC connection to that host
	 * ========================================================================================== */
	const RealWebSocket = window.WebSocket;
	const LAN_URL = new RegExp("^wss?://([" + CODE_CHARS + "]{6})/?$", "i");

	class LanSocket extends EventTarget {
		constructor(url, lanCode) {
			super();
			Object.assign(this, { url, binaryType: "arraybuffer", readyState: 0, protocol: "", extensions: "", bufferedAmount: 0,
				onopen: null, onmessage: null, onclose: null, onerror: null });
			this._code = lanCode.toUpperCase();
			this._connect().catch((e) => this._failWith(e.message === "offline"
				? "Couldn't reach the internet to find this LAN world."
				: e.message || "Couldn't connect to that LAN world."));
		}
		_emit(type, init) {
			const ev = type === "message" ? new MessageEvent("message", init) : type === "close" ? new CloseEvent("close", init) : new Event(type);
			this.dispatchEvent(ev);
			const h = this["on" + type]; if (typeof h === "function") h.call(this, ev);
		}
		// Show the player a readable reason instead of "Connection refused": pretend to connect, then answer
		// their handshake with an "incompatible" reply carrying the message.
		_failWith(message) {
			if (this.readyState === 3) return;
			this._cleanup();
			if (this.readyState === 1) return this.close();
			this._failMessage = message.slice(0, 250);
			this.readyState = 1;
			this._emit("open");
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
				if (this.readyState === 1 && !this._failMessage) this._emit("message", { data: isText ? new TextDecoder().decode(data) : data.buffer });
			});
			dc.onopen = () => { this._sub.close(); if (this.readyState === 0) { this.readyState = 1; this._emit("open"); } };
			dc.onclose = () => { if (this.readyState === 1 && !this._failMessage) this.close(); };
			await pc.setLocalDescription(await pc.createOffer());
			await iceComplete(pc);
			await publish(topicFor(this._code), { t: "offer", id: me, sdp: pc.localDescription.sdp });
			const timeout = (ms, msg) => new Promise((_, j) => setTimeout(() => j(new Error(msg)), ms));
			const sdp = await Promise.race([answer, timeout(15000, `No world is open with code ${this._code}. Ask the host to press Esc → Open to LAN.`)]);
			if (this.readyState !== 0) return;
			await pc.setRemoteDescription({ type: "answer", sdp });
			await Promise.race([new Promise((r) => dc.addEventListener("open", r)),
				timeout(20000, "Found the world but couldn't connect directly. One of your networks blocks it; try a phone hotspot.")]);
		}
		send(data) {
			if (this.readyState !== 1) return;
			if (this._failMessage) {
				if (typeof data === "string") return;
				const msg = new TextEncoder().encode(this._failMessage);
				const reply = new Uint8Array([3, 0, 0, 0, 0, msg.length, ...msg]);   // 0x03: incompatible + message
				setTimeout(() => { this._emit("message", { data: reply.buffer }); setTimeout(() => this.close(), 500); }, 0);
				return;
			}
			if (typeof data === "string") return dcSend(this._dc, data, true);
			const view = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
			dcSend(this._dc, view.slice());                                      // copy: the view may point into game memory
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
	 * Panel
	 * ========================================================================================== */
	const CSS = `
	#mosspack-lan{position:fixed;top:16px;right:16px;z-index:200;width:330px;max-width:calc(100vw - 32px);
		background:#1c2417;color:#e9eee3;border:2px solid #34422b;border-radius:6px;box-shadow:0 4px 0 #0b0e09,0 14px 30px rgba(0,0,0,.45);
		padding:16px;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
	#mosspack-lan h3{margin:0 0 8px;font:700 15px/1.2 Menlo,Consolas,monospace;letter-spacing:.03em;display:flex;align-items:center;gap:8px}
	#mosspack-lan .dot{width:9px;height:9px;border-radius:50%;background:#e8b84a}
	#mosspack-lan .dot.on{background:#6fbf4a;box-shadow:0 0 0 3px rgba(111,191,74,.2)}
	#mosspack-lan .x{margin-left:auto;background:none;border:none;color:#a8b59c;font-size:18px;cursor:pointer;line-height:1;padding:0 2px}
	#mosspack-lan p{margin:6px 0;color:#a8b59c}
	#mosspack-lan .code{display:flex;gap:8px;align-items:center;margin:10px 0}
	#mosspack-lan .code b{flex:1;text-align:center;font:700 28px/1 Menlo,Consolas,monospace;letter-spacing:.18em;background:#0f140c;
		border:1px solid #34422b;border-radius:5px;padding:12px 6px;color:#cfe8bf;user-select:all}
	#mosspack-lan button.b{background:#232d1d;color:#e9eee3;border:1px solid #34422b;border-radius:4px;padding:8px 11px;font:600 13px/1 inherit;font-family:inherit;cursor:pointer}
	#mosspack-lan button.b:hover{border-color:#6fbf4a}
	#mosspack-lan ol{margin:6px 0 0;padding-left:20px;color:#a8b59c}
	#mosspack-lan ul{margin:6px 0 0;padding-left:18px}
	#mosspack-lan .row{display:flex;gap:8px;margin-top:12px}
	#mosspack-lan .small{font-size:12px;color:#7f8c75}`;
	let panel = null;
	function render() {
		if (state === "closed") { if (panel) { panel.remove(); panel = null; } return; }
		M.style("lan", CSS);
		if (!panel) { panel = M.el("div", { id: "mosspack-lan" }); document.body.appendChild(panel); }
		const el = M.el, btn = M.button;
		panel.textContent = "";
		const hide = btn("×", () => { if (state === "open") { panel.remove(); panel = null; } else { state = "closed"; render(); } }, "x");
		const head = (on, title) => el("h3", {}, el("span", { class: "dot" + (on ? " on" : "") }), title, hide);
		if (state === "noworld") {
			panel.append(head(false, "Open to LAN"), el("p", {}, "Open a singleplayer world first, then press Esc → Open to LAN."));
		} else if (state === "opening") {
			panel.append(head(false, "Opening LAN…"), el("p", {}, "Getting a join code…"));
		} else if (state === "error") {
			panel.append(head(false, "Couldn't open LAN"), el("p", {}, lanError),
				el("div", { class: "row" }, btn("Try again", () => { state = "closed"; openLan(); }, "b")));
		} else {
			const list = players();
			panel.append(head(true, "LAN is open"),
				el("div", { class: "code" }, el("b", {}, code), btn("Copy", (b) => M.copy(code, b), "b")),
				el("p", {}, "Friends can join from any Wi-Fi:"),
				el("ol", {}, el("li", {}, "Open Mosspack"), el("li", {}, "Multiplayer → Direct Connect"), el("li", {}, "Type the code → Join Server")),
				el("p", {}, list.length ? `Playing with you (${list.length}):` : "No one has joined yet."));
			if (list.length) panel.append(el("ul", {}, ...list.map((n) => el("li", {}, n))));
			panel.append(el("div", { class: "row" }, btn("Close LAN", closeLan, "b")),
				el("p", { class: "small" }, "Your world keeps running while LAN is open. Some school and work networks block direct connections."));
		}
	}

	window.__mosspackLAN = { open: openLan, close: closeLan, status: () => ({ state, code, players: players(), world: M.world }) };
})();
