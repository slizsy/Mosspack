"""Scan `wasm-dis` output from stdin without storing it (the full text of the 26.3 client is over 14 GB).

usage: wasm-dis ... client.wasm | python3 watscan.py OUTDIR [NEEDLE ...]
  OUTDIR/header.wat     everything before the first function (types, imports, globals)
  OUTDIR/funcs.tsv      every function: index, name, bytes of text, number of global.set
  OUTDIR/initstrings.wat the function with the most global.set (TeaVM's string-constant setup)
  OUTDIR/hits.wat       every function whose text contains one of the NEEDLEs (exact substrings);
                        a NEEDLE written as ^$name selects the function with that name instead
"""
import os, sys

out, needles = sys.argv[1], [n.encode() for n in sys.argv[2:] if not n.startswith('^')]
names = {n[1:].encode() + b' ' for n in sys.argv[2:] if n.startswith('^')}
os.makedirs(out, exist_ok=True)
src = sys.stdin.buffer
SEP = b'\n (func '
buf, header_done, index = b'', False, 0
best = (0, b'')
tsv = open(os.path.join(out, 'funcs.tsv'), 'w')
hits = open(os.path.join(out, 'hits.wat'), 'wb')


def handle(chunk):
    global index, best
    name = chunk[1:chunk.find(b' ')].decode(errors='replace')
    sets = chunk.count(b'global.set ')
    tsv.write(f'{index}\t{name}\t{len(chunk)}\t{sets}\n')
    if sets > best[0]:
        best = (sets, chunk)
    if (needles and any(n in chunk for n in needles)) or (names and chunk[:chunk.find(b' ') + 1] in names):
        hits.write(b' (func ' + chunk + b'\n')
    index += 1


while True:
    data = src.read(64 << 20)
    if not data:
        break
    buf += data
    if not header_done:
        k = buf.find(SEP)
        if k < 0:
            continue
        open(os.path.join(out, 'header.wat'), 'wb').write(buf[:k + 1])
        buf, header_done = buf[k + len(SEP):], True
    parts = buf.split(SEP)
    buf = parts.pop()                      # last one may be incomplete
    for p in parts:
        handle(p)
if header_done and buf:
    handle(buf)
open(os.path.join(out, 'initstrings.wat'), 'wb').write(b' (func ' + best[1])
print(f'{index} functions; string setup candidate has {best[0]} global.set')
