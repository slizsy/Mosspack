"""Read and write Eaglercraft EPK v2 asset packs (gzip-compressed)."""
import struct, sys, zlib, gzip, io

def read(path):
    d = open(path, 'rb').read()
    g = d.find(b'\x1f\x8b')
    o = zlib.decompressobj(31); raw = o.decompress(d[g:])
    header, footer = d[:g], o.unused_data
    entries, i = [], 0
    while i < len(raw):
        tag = raw[i:i+4]; i += 4
        if tag == b'END$': break
        nl = raw[i]; name = raw[i+1:i+1+nl].decode(); i += 1 + nl
        ln = struct.unpack('>I', raw[i:i+4])[0]; i += 4
        if tag == b'FILE':
            crc = raw[i:i+4]; data = raw[i+4:i+ln-1]
            assert struct.unpack('>I', crc)[0] == zlib.crc32(data), name
        else:
            data = raw[i:i+ln]
        entries.append((tag, name, data))
        i += ln + 1  # every entry ends with '>' (FILE data is followed by ':' inside ln)
    return header, entries, footer, raw

def encode(entries):
    out = bytearray()
    for tag, name, data in entries:
        n = name.encode()
        out += tag + bytes([len(n)]) + n
        if tag == b'FILE':
            out += struct.pack('>I', len(data) + 5) + struct.pack('>I', zlib.crc32(data)) + data + b':>'
        else:
            out += struct.pack('>I', len(data)) + data + b'>'
    return bytes(out) + b'END$'

def write(path, header, entries, footer):
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode='wb', compresslevel=9, mtime=0) as gz:
        gz.write(encode(entries))
    open(path, 'wb').write(header + buf.getvalue() + footer)

if __name__ == '__main__':
    h, e, f, raw = read(sys.argv[1])
    print(len(e), 'entries; re-encode identical:', encode(e) == raw)
