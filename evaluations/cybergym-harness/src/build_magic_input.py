#!/usr/bin/env python3
"""Input for the file/libmagic fuzzer.

magic_buffer runs the compiled magic database. A text file that matches a
regex rule (here a C `#include` line) makes glibc regexec return success
without MSan seeing a write to pmatch. The patched build initializes
pmatch before the call.
"""
import argparse
import pathlib


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="poc.bin")
    args = ap.parse_args()
    out = pathlib.Path(args.out)
    out.write_bytes(b"#include\n")
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
