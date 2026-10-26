<script type="text/javascript">
/* Mosspack LAN relay: Open to LAN without Eaglercraft's relay server.
 *
 * The game's LAN relay address is wss://lan.mosspack (string pool). Connections to it are answered here, in the
 * page, speaking the game's relay protocol, while the actual signaling between host and friends travels through
 * ntfy.sh (public pub/sub) on topics named after the room code. Players then connect to each other directly over
 * WebRTC. A direct connection needs both networks to allow it (STUN); strict networks (many schools, phone
 * hotspots) also need a TURN relay, which can be listed in eaglercraftXOpts.lanTurnServers as
 * [{url: "turn:host:port", username, credential}] (none free without an account is known to work).
 * Relay protocol (all integers big-endian):
 *   00 handshake   game -> relay: [type: 1 host, 2 friend][version 1][str8 ident (host) | code (friend)]
 *                  relay -> game: same header + [str8 room code (host) | peer id (friend)]
 *   01 ICE servers relay -> game: [u16 count] then per server [S|T][str16 url][str8 user][str8 password]
 *   02 new peer    relay -> host: [str8 peer id]
 *   03 candidates / 04 description: [str8 peer id (empty from a friend)][str16 json]
 *   05 connected / 06 failed:       [str8 peer id]
 * Any other use of the relay (a proxy to Java servers) is refused. */
(function () {
	"use strict";
	const RELAY = "wss://lan.mosspack";
	const SIGNAL = "https://ntfy.sh/";
	const STUN = ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302",
		"stun:stun3.l.google.com:19302", "stun:stun4.l.google.com:19302", "stun:stun.cloudflare.com:3478", "stun:global.stun.twilio.com:3478"];
	const TURN = ((window.eaglercraftXOpts || {}).lanTurnServers || []).filter((t) => t && t.url);
	const JOIN_TIMEOUT_MS = 20000;
	const RealWebSocket = window.WebSocket;
	const enc = new TextEncoder(), dec = new TextDecoder();

	// ------------------------------------------------------------------ bytes
	const out = (...parts) => {
		const chunks = parts.map((p) => typeof p === "number" ? Uint8Array.of(p) : p);
		const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
		let k = 0; for (const c of chunks) { all.set(c, k); k += c.length; }
		return all;
	};
	const str8 = (s) => { const b = enc.encode(s); return out(b.length, b); };
	const str16 = (s) => { const b = enc.encode(s); return out(b.length >> 8, b.length & 255, b); };
	class In {
		constructor(b) { this.b = b; this.i = 0; }
		u8() { return this.b[this.i++]; }
		str8() { const n = this.u8(); const s = dec.decode(this.b.subarray(this.i, this.i + n)); this.i += n; return s; }
		str16() { const n = (this.u8() << 8) | this.u8(); const s = dec.decode(this.b.subarray(this.i, this.i + n)); this.i += n; return s; }
	}
	const iceList = () => {
		const n = TURN.length + STUN.length;
		return out(1, n >> 8, n & 255, ...TURN.map((t) => out(0x54, str16(t.url), str8(t.username || ""), str8(t.credential || ""))),
			...STUN.map((u) => out(0x53, str16(u), str8(""), str8(""))));
	};
	const log = (...a) => console.log("[Mosspack LAN]", ...a);
	const randomId = (n, chars) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (v) => chars[v % chars.length]).join("");

	// ------------------------------------------------------------------ signaling (ntfy.sh)
	const topic = (code, peer) => "mosspack26-" + code.toLowerCase() + (peer ? "-" + peer.toLowerCase() : "");
	const queues = new Map();        // one publish at a time per topic, so messages arrive in order
	function publish(name, msg) {
		const next = (queues.get(name) || Promise.resolve())
			.then(() => fetch(SIGNAL + name, { method: "POST", body: JSON.stringify(msg) })).catch(() => {});
		queues.set(name, next);
		return next;
	}
	function subscribe(name, onMessage) {
		return new Promise((resolve, reject) => {
			let ws, closed = false, opened = false, retry = 0;
			const handle = { close() { closed = true; try { ws.close(); } catch (e) {} } };
			const connect = () => {
				ws = new RealWebSocket(SIGNAL.replace("https:", "wss:") + name + "/ws");
				ws.onopen = () => { retry = 0; if (!opened) { opened = true; resolve(handle); } };
				ws.onmessage = (ev) => {
					try { const m = JSON.parse(ev.data); if (m.event === "message") onMessage(JSON.parse(m.message)); } catch (e) {}
				};
				ws.onclose = () => {
					if (closed) return;
					if (!opened) return reject(new Error("signaling offline"));
					setTimeout(connect, Math.min(10000, 500 * 2 ** retry++));
				};
			};
			connect();
		});
	}

	// ------------------------------------------------------------------ the relay socket the game sees
	class RelaySocket extends EventTarget {
		constructor(url) {
			super();
			Object.assign(this, { url, readyState: 0, binaryType: "blob", protocol: "", extensions: "", bufferedAmount: 0,
				onopen: null, onmessage: null, onclose: null, onerror: null, _subs: [] });
			setTimeout(() => { if (this.readyState === 0) { this.readyState = 1; this._emit("open"); } }, 0);
		}
		_emit(type, data) {
			const ev = type === "message" ? new MessageEvent("message", { data })
				: type === "close" ? new CloseEvent("close", { code: 1000, wasClean: true }) : new Event(type);
			this.dispatchEvent(ev);
			if (this["on" + type]) this["on" + type](ev);
		}
		_recv(bytes) {
			if (this.readyState !== 1) return;
			this._emit("message", this.binaryType === "arraybuffer" ? bytes.slice().buffer : new Blob([bytes]));
		}
		send(data) {
			if (this.readyState !== 1) return;
			if (data instanceof Blob) return void data.arrayBuffer().then((b) => this._frame(new Uint8Array(b)));
			this._frame(data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
		}
		close() {
			if (this.readyState >= 2) return;
			this.readyState = 3;
			this._subs.forEach((s) => s.close());
			if (this._code && this._me) publish(topic(this._code), { t: "bye", id: this._me });
			this._emit("close");
		}
		_fail() { this._emit("error"); this.close(); }

		_frame(b) {
			const r = new In(b), id = r.u8();
			if (!this._role) {
				if (id === 0 && (b[1] === 1 || b[1] === 2) && b[2] === 1) return void this._handshake(r);
				return this._fail();                               // not LAN: there is no proxy to Java servers
			}
			if (id === 3 || id === 4) {                          // candidates / description
				const peer = r.str8(), json = r.str16(), t = id === 3 ? "ice" : "desc";
				if (this._role === "host") publish(topic(this._code, peer), { t, json });
				else publish(topic(this._code), { t, id: this._me, json });
			} else if ((id === 5 || id === 6) && this._role === "friend") {
				publish(topic(this._code), { t: id === 5 ? "ok" : "fail", id: this._me });
			} else if (id === 0xfe && this._role === "host") {   // host drops a peer
				publish(topic(this._code, r.str8()), { t: "kick" });
			}
		}
		async _handshake(r) {
			const type = r.u8(); r.u8();
			const arg = r.str8();
			try {
				if (type === 1) {                                 // host: open a room
					this._role = "host";
					this._code = randomId(5, "abcdefghijkmnpqrstuvwxyz23456789");
					this._subs.push(await subscribe(topic(this._code), (m) => this._fromFriend(m)));
					this._recv(out(0, 1, 1, str8(this._code)));
					log("room", this._code, "open");
				} else {                                          // friend: join a room by code
					this._role = "friend";
					this._code = arg.toLowerCase();
					this._me = randomId(16, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
					this._subs.push(await subscribe(topic(this._code, this._me), (m) => this._fromHost(m)));
					publish(topic(this._code), { t: "join", id: this._me });
					log("asking room", this._code, "to let us in");
					this._recv(out(0, 2, 1, str8(this._me)));
					this._timer = setTimeout(() => this._fail(), JOIN_TIMEOUT_MS);   // nobody hosts that code
				}
				this._recv(iceList());
			} catch (e) { this._fail(); }
		}
		_fromFriend(m) {
			if (!m || typeof m.id !== "string") return;
			if (m.t === "join") { log("player", m.id, "wants to join"); this._recv(out(2, str8(m.id))); }
			else if (m.t === "desc" || m.t === "ice") this._recv(out(m.t === "desc" ? 4 : 3, str8(m.id), str16(m.json)));
			else if (m.t === "ok" || m.t === "fail") this._recv(out(m.t === "ok" ? 5 : 6, str8(m.id)));
		}
		_fromHost(m) {
			if (!m) return;
			if (m.t === "desc" || m.t === "ice") { if (m.t === "desc") log("host answered"); clearTimeout(this._timer); this._recv(out(m.t === "desc" ? 4 : 3, str8(""), str16(m.json))); }
			else if (m.t === "kick") this.close();
		}
	}
	for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) RelaySocket[k] = RealWebSocket[k];

	window.WebSocket = new Proxy(RealWebSocket, {
		construct(target, args) {
			return String(args[0]).startsWith(RELAY) ? new RelaySocket(String(args[0])) : new target(...args);
		},
	});
})();
</script>
