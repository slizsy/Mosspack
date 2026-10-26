"""Rewrite strings in a TeaVM WASM-GC module's string pool (Eaglercraft 26.x builds).

Data segment 0 at address 0 is the pool: TeaVM reads it sequentially at startup, each string as a LEB128
UTF-16 unit count followed by each unit as 1-3 UTF-8-style bytes. Segment 1 (resources) follows it at a fixed
address, so the pool may shrink but never grow past that address; any space left over is simply unused.

usage: strpool.py IN.wasm OUT.wasm REPLACEMENTS.json     {"exact old string": "new string", ...}
       strpool.py IN.wasm --dump OUT.json
"""
import json, sys


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


def read_segments(d):
    """Data section -> (section, [(offset, bytes), ...]) for active segments in memory 0."""
    sec = [s for s in sections(d) if s[0] == 11][0]
    count, k = leb(d, sec[2])
    segs = []
    for _ in range(count):
        assert d[k] == 0 and d[k+1] == 0x41, 'expected active segments with i32.const offsets'
        off, k = leb(d, k + 2)
        assert d[k] == 0x0b; k += 1
        size, k = leb(d, k)
        segs.append((off, d[k:k+size])); k += size
    return sec, segs


def write_segments(d, sec, segs):
    body = uleb(len(segs))
    for off, data in segs:
        body += b'\x00\x41' + uleb(off) + b'\x0b' + uleb(len(data)) + data
    _, st, _, end = sec
    return d[:st] + b'\x0b' + uleb(len(body)) + body + d[end:]


def pool(path):
    d = open(path, 'rb').read()
    sec, segs = read_segments(d)
    assert segs[0][0] == 0, 'string pool must be segment 0 at address 0'
    return d, sec, segs, decode_pool(segs[0][1])


if __name__ == '__main__':
    d, sec, segs, strings = pool(sys.argv[1])
    if sys.argv[2] == '--dump':
        json.dump([t for t, _ in strings], open(sys.argv[3], 'w'), indent=0, ensure_ascii=False)
        print(f'{len(strings)} strings; re-encode identical: {all(encode_str(t) == raw for t, raw in strings)}')
        sys.exit(0)
    repl = json.load(open(sys.argv[3]))
    used, out = set(), []
    for t, raw in strings:
        if t in repl: out.append(encode_str(repl[t])); used.add(t)
        else: out.append(raw)
    if set(repl) - used:
        sys.exit(f'strings not found in pool: {sorted(set(repl) - used)}')
    new = b''.join(out)
    limit = segs[1][0] if len(segs) > 1 else None
    if limit is not None and len(new) > limit:
        sys.exit(f'string pool grew past the next segment: {len(new):,} > {limit:,} bytes (shorten something)')
    segs[0] = (0, new)
    open(sys.argv[2], 'wb').write(write_segments(d, sec, segs))
    print(f'string pool: {len(used)} strings replaced, {len(new):,} / {limit:,} bytes')
