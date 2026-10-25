"""Rewrite strings in classes.wasm's string pool (TeaVM WASM-GC), allowing length changes.

The pool is data segment 0 at address 0. TeaVM reads it sequentially at startup
(WasmGCSupport.nextCharArray): LEB128 UTF-16 unit count, then each unit as 1-3 UTF-8-style bytes.
Nothing points into the middle of it, so strings can change length as long as the segment stays
below the heap, which starts at 655360 (memory page 10).

usage: strpool.py IN.wasm OUT.wasm REPLACEMENTS.json
       REPLACEMENTS.json = {"exact old string": "new string", ...}  (each must exist in the pool)
       strpool.py IN.wasm --dump OUT.json
"""
import json, sys

HEAP_START = 655360


def leb(d, i):
    r = s = 0
    while True:
        b = d[i]; i += 1; r |= (b & 0x7f) << s
        if b < 0x80: return r, i
        s += 7


def uleb(v):
    o = bytearray()
    while True:
        b = v & 0x7f; v >>= 7
        if v: o.append(b | 0x80)
        else: o.append(b); return bytes(o)


def sections(d):
    i, out = 8, []
    while i < len(d):
        sid = d[i]; n, j = leb(d, i + 1); out.append((sid, i, j, j + n)); i = j + n
    return out


def decode_pool(seg):
    """Return list of (text, raw_bytes) in pool order."""
    out, i = [], 0
    while i < len(seg):
        start = i
        n, i = leb(seg, i)
        units = []
        for _ in range(n):
            b = seg[i]
            if b < 0x80: u = b; i += 1
            elif b & 0xe0 == 0xc0: u = ((b & 0x1f) << 6) | (seg[i+1] & 0x3f); i += 2
            else: u = ((b & 0x0f) << 12) | ((seg[i+1] & 0x3f) << 6) | (seg[i+2] & 0x3f); i += 3
            units.append(u)
        text = b''.join(u.to_bytes(2, 'little') for u in units).decode('utf-16-le', 'surrogatepass')
        out.append((text, bytes(seg[start:i])))
    return out


def encode_str(text):
    units = text.encode('utf-16-le', 'surrogatepass')
    units = [int.from_bytes(units[k:k+2], 'little') for k in range(0, len(units), 2)]
    o = bytearray(uleb(len(units)))
    for u in units:
        if u < 0x80: o.append(u)
        elif u < 0x800: o += bytes([0xc0 | (u >> 6), 0x80 | (u & 0x3f)])
        else: o += bytes([0xe0 | (u >> 12), 0x80 | ((u >> 6) & 0x3f), 0x80 | (u & 0x3f)])
    return bytes(o)


def read(path):
    d = open(path, 'rb').read()
    sec = [s for s in sections(d) if s[0] == 11][0]
    _, st, j, end = sec
    c, k = leb(d, j)
    assert c == 1 and d[k] == 0 and d[k+1:k+4] == b'\x41\x00\x0b', 'expected one active segment at address 0'
    k += 4
    size, k = leb(d, k)
    return d, sec, decode_pool(d[k:k+size]), d[end:]


def write(path, d, sec, pool, rest):
    _, st, j, end = sec
    seg = b''.join(raw for _, raw in pool)
    if len(seg) > HEAP_START:
        sys.exit(f'string pool too big: {len(seg)} > {HEAP_START}')
    body = uleb(1) + b'\x00\x41\x00\x0b' + uleb(len(seg)) + seg
    open(path, 'wb').write(d[:st] + b'\x0b' + uleb(len(body)) + body + rest)
    return len(seg)


if __name__ == '__main__':
    src = sys.argv[1]
    d, sec, pool, rest = read(src)
    if sys.argv[2] == '--dump':
        json.dump([t for t, _ in pool], open(sys.argv[3], "w"), indent=0)
        ok = all(encode_str(t) == raw for t, raw in pool)
        print(f'{len(pool)} strings; re-encode identical: {ok}'); sys.exit(0)
    repl = json.load(open(sys.argv[3]))
    used = set()
    pool2 = []
    for t, raw in pool:
        if t in repl:
            pool2.append((repl[t], encode_str(repl[t]))); used.add(t)
        else:
            pool2.append((t, raw))
    missing = set(repl) - used
    if missing:
        sys.exit(f'strings not found in pool: {sorted(missing)}')
    size = write(sys.argv[2], d, sec, pool2, rest)
    print(f'string pool: {len(used)} strings replaced, {size:,} / {HEAP_START:,} bytes')
