#!/usr/bin/env python3
"""Input for the FFmpeg IPMovie demuxer fuzzer.

signature_buffer is an uninitialized stack array the size of
"Interplay MVE File\\x1a\\0\\x1a" (22 bytes, including the terminator).
avio_read is not checked, so a shorter input leaves the tail
uninitialized and memcmp reads it. The patched demuxer returns
invalid-data when the read is short. Do not walk the ffmpeg tree:
the tarball is about 1.5GB uncompressed and the images are ~35GB.
"""
import argparse
import pathlib


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="poc.bin")
    args = ap.parse_args()
    blob = b"\x00"
    out = pathlib.Path(args.out)
    out.write_bytes(blob)
    print(f"wrote {out} ({len(blob)} bytes) short of the 22-byte signature")


if __name__ == "__main__":
    main()
