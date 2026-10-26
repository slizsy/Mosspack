"""Patch function bodies in a WebAssembly binary without disassembling it.

    from wasmpatch import patch_code, prepend, swap
    out = patch_code(wasm_bytes, {135682: prepend(b'\\x0f'),                       # return at the start
                                  164086: swap(call(1094), b'\\x1a' * 3)})       # one call -> three drops

Keys are code-section indices: binaryen's `$N` for a defined function (imports are named $fimport$N).
prepend() puts bytes right after the local declarations; swap() replaces a byte sequence that must occur exactly
once in the body with one of the same length, replace() with one of any length. add_global() / add_export()
append a global / an export.
"""
import struct


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


IMPORTED_FUNCS = 102           # call instructions use absolute indices: imports come first


def call(n):
    return b'\x10' + uleb(n + IMPORTED_FUNCS)


def locals_end(body):
    groups, q = leb(body, 0)
    for _ in range(groups):                         # (count, valtype) pairs; valtypes may be multi-byte refs
        _, q = leb(body, q)
        t = body[q]; q += 1
        if t in (0x63, 0x64):                       # (ref null ht) / (ref ht): heap type follows as s33
            while body[q] & 0x80: q += 1
            q += 1
    return q


def prepend(code):
    def fn(body):
        q = locals_end(body)
        return body[:q] + code + body[q:]
    return fn


def swap(old, new):
    assert len(old) == len(new), 'swap must keep the length'
    def fn(body):
        n = body.count(old)
        if n != 1:
            raise ValueError(f'expected 1 occurrence of {old.hex()}, found {n}')
        return body.replace(old, new)
    return fn


def sleb(v):
    o = bytearray()
    while True:
        b = v & 0x7f; v >>= 7
        if (v == 0 and not b & 0x40) or (v == -1 and b & 0x40):
            o.append(b); return bytes(o)
        o.append(b | 0x80)


def i32_const(v):
    return b'\x41' + sleb(v)


def f64_const(v):
    return b'\x44' + struct.pack('<d', v)


def replace(old, new):
    def fn(body):
        n = body.count(old)
        if n != 1:
            raise ValueError(f'expected 1 occurrence of {old.hex()}, found {n}')
        return body.replace(old, new)
    return fn


def sections(d):
    i, out = 8, []
    while i < len(d):
        sid = d[i]; size, j = leb(d, i + 1); out.append((sid, i, j, j + size)); i = j + size
    return out


def add_global(d, init_i32, mutable=True):
    """Append a global (i32) to the global section; returns (new module, its index)."""
    sid, st, j, end = next(s for s in sections(d) if s[0] == 6)
    count, k = leb(d, j)
    content = uleb(count + 1) + d[k:end] + b'\x7f' + (b'\x01' if mutable else b'\x00') + i32_const(init_i32) + b'\x0b'
    return d[:st] + b'\x06' + uleb(len(content)) + content + d[end:], count


def add_export(d, name, kind, index):
    """Append an export (kind: 0 func, 1 table, 2 memory, 3 global) to the export section."""
    sid, st, j, end = next(s for s in sections(d) if s[0] == 7)
    count, k = leb(d, j)
    n = name.encode()
    content = uleb(count + 1) + d[k:end] + uleb(len(n)) + n + bytes([kind]) + uleb(index)
    return d[:st] + b'\x07' + uleb(len(content)) + content + d[end:]


def patch_code(d, patches):
    i = 8
    while i < len(d):
        sid = d[i]; size, j = leb(d, i + 1)
        if sid == 10:
            break
        i = j + size
    else:
        raise ValueError('no code section')
    sec_start, body_start, sec_end = i, j, j + size
    count, k = leb(d, body_start)
    out = [uleb(count)]
    todo = dict(patches)
    for n in range(count):
        fsize, p = leb(d, k)
        body = d[p:p + fsize]
        if n in todo:
            body = todo.pop(n)(body)
        out += [uleb(len(body)), body]
        k = p + fsize
    if todo:
        raise ValueError(f'functions not found: {sorted(todo)}')
    content = b''.join(out)
    return d[:sec_start] + b'\x0a' + uleb(len(content)) + content + d[sec_end:]
