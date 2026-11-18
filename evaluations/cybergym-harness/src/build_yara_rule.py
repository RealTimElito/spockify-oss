#!/usr/bin/env python3
"""YARA rules-fuzzer input.

rules_fuzzer.cc declares LLVMFuzzerTestOneInput with a char* instead of
uint8_t*, then compiles the buffer as a rule. An empty string match is the
input that crashes the vulnerable build and is silent on the patched one.
"""
import argparse
import pathlib


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="poc.bin")
    args = ap.parse_args()
    out = pathlib.Path(args.out)
    out.write_bytes(b'rule test{strings: $a=""; condition: $a}')
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
