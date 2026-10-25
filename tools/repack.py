"""Rebuild the EPW package and the single-file HTML, optionally replacing sections.

usage: repack.py ORIGINAL.html OUT.html [--classes x.wasm] [--runtime x.js] [--assets x.epk]
                 [--image SLOT=x.png ...] [--asset PATH_IN_EPK=file ...] [--brand Name]
                 [--title "Name"] [--text OLD::=NEW ...]
"""
import argparse, base64, lzma, os, re, struct, sys, tempfile, zlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import epk

# header slots: (field offset, compressed?) in the order the original file lays them out
SLOTS = {'splash': (100, False), 'icon128': (116, False), 'logo': (132, False), 'icon32': (148, False),
         'loader_js': (164, False), 'loader_wasm': (180, False), 'error_page': (196, True),
         'runtime': (212, True), 'classes': (228, True), 'teadbg': (244, True), 'deobf': (260, True),
         'assets': (292, True)}

# the loader's XZ decoder only accepts dictionaries up to 32 MiB (same setting as the original build)
XZ_FILTERS = [{'id': lzma.FILTER_LZMA2, 'preset': 9, 'dict_size': 32 << 20}]

ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('out')
ap.add_argument('--classes'); ap.add_argument('--runtime'); ap.add_argument('--assets'); ap.add_argument('--teadbg')
ap.add_argument('--loader-js'); ap.add_argument('--error-page')
ap.add_argument('--title'); ap.add_argument('--text', action='append', default=[])
ap.add_argument('--image', action='append', default=[], help='splash|icon128|logo|icon32=file.png')
ap.add_argument('--asset', action='append', default=[], help='path/inside/epk=file')
ap.add_argument('--brand', help='client brand shown in crash reports (max 11 bytes)')
ap.add_argument('--favicon', help='PNG for the browser tab icon')
ap.add_argument('--text-json', help='JSON list of [old, new] HTML replacements (each must match once)')
a = ap.parse_args()

html = open(a.src, encoding='utf-8').read()
m = re.search(r'assetsURI = "data:application/octet-stream;base64,([A-Za-z0-9+/=]+)"', html)
epw = base64.b64decode(m.group(1))
u = lambda o: struct.unpack_from('<I', epw, o)[0]

parts = {}
for k, (f, comp) in SLOTS.items():
    raw = epw[u(f):u(f) + u(f + 4)]
    parts[k] = lzma.decompress(raw) if comp else raw
for k in ('classes', 'runtime', 'assets', 'teadbg'):
    p = getattr(a, k)
    if p: parts[k] = open(p, 'rb').read()
if a.loader_js: parts['loader_js'] = open(a.loader_js, 'rb').read()
if a.error_page: parts['error_page'] = open(a.error_page, 'rb').read()

for spec in a.image:
    slot, path = spec.split('=', 1)
    parts[slot] = open(path, 'rb').read()
if a.asset:
    with tempfile.TemporaryDirectory() as td:
        src = os.path.join(td, 'in.epk'); open(src, 'wb').write(parts['assets'])
        head, entries, foot, _ = epk.read(src)
        repl = dict(s.split('=', 1) for s in a.asset)
        entries = [(tg, nm, open(repl.pop(nm), 'rb').read() if nm in repl else dt) for tg, nm, dt in entries]
        if repl: sys.exit(f'assets not found in EPK: {list(repl)}')
        dst = os.path.join(td, 'out.epk'); epk.write(dst, head, entries, foot)
        parts['assets'] = open(dst, 'rb').read()

out = bytearray(epw[:472])                     # header + string table, laid out exactly as before
if a.brand:
    b = a.brand.encode()
    if len(b) > 11: sys.exit('brand must be at most 11 bytes')
    out[421:432] = b.ljust(11, b'\0')             # brand string slot (NUL-terminated at 432)
    struct.pack_into('<I', out, 36, len(b)); struct.pack_into('<I', out, 60, len(b))
for k, (f, comp) in sorted(SLOTS.items(), key=lambda kv: u(kv[1][0])):
    data = parts[k]
    blob = lzma.compress(data, format=lzma.FORMAT_XZ, check=lzma.CHECK_CRC32, filters=XZ_FILTERS) if comp else data
    struct.pack_into('<II', out, f, len(out), len(blob))
    if comp: struct.pack_into('<I', out, f + 8, len(data))
    out += blob
struct.pack_into('<I', out, 8, len(out))
struct.pack_into('<I', out, 12, zlib.crc32(bytes(out[16:])))

html = html[:m.start(1)] + base64.b64encode(bytes(out)).decode() + html[m.end(1):]
if a.favicon:
    fav = base64.b64encode(open(a.favicon, 'rb').read()).decode()
    html, n = re.subn(r'(rel="shortcut icon" href="data:image/png;base64,)[A-Za-z0-9+/=]+', lambda m: m.group(1) + fav, html)
    if n != 1: sys.exit('favicon link not found')
if a.title:
    html = re.sub(r'<title>[^<]*</title>', f'<title>{a.title}</title>', html, count=1)
pairs = [t.split('::=', 1) for t in a.text]
if a.text_json:
    import json
    pairs += json.load(open(a.text_json))
for old, new in pairs:
    if html.count(old) != 1: sys.exit(f'--text: expected 1 match for {old[:60]!r}, found {html.count(old)}')
    html = html.replace(old, new)
open(a.out, 'w', encoding='utf-8').write(html)
print(f'EPW {len(epw):,} -> {len(out):,} bytes; HTML written to {a.out}')
