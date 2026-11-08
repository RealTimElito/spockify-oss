#!/usr/bin/env python3
"""Build a fuzz_pkcs15init input.

Layout (fuzz_get_reader_data):
  profile text, one NUL, then uint16le-framed reader chunks.
  Chunk 0 is the ATR and selects the card driver.
  Each later chunk is one APDU response. The last two bytes are SW1 SW2.

The default response is a size-0 FCI (tag 6F) plus SW 90 00, so SELECT
succeeds and READ BINARY does not loop. --bad-index replaces one chunk
with --bad-sw (default 9001: SW1=0x90 and SW2!=0x00).
--acl-none rewrites SOPIN/PIN ACLs to NONE so key generation is not
rejected for a missing PIN.
"""
import argparse
import pathlib


def chunk(data: bytes) -> bytes:
    return len(data).to_bytes(2, "little") + data


def acl_none(text: bytes) -> bytes:
    text = text.replace(b"WRITE=$SOPIN, CREATE=$SOPIN", b"WRITE=NONE, CREATE=NONE")
    text = text.replace(b"WRITE=$PIN, CREATE=$PIN", b"WRITE=NONE, CREATE=NONE")
    text = text.replace(b"*=$SOPIN", b"*=NONE")
    text = text.replace(b"*=$PIN", b"*=NONE")
    return text


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", action="append", required=True)
    ap.add_argument("--atr", required=True, help="ATR hex, no spaces")
    ap.add_argument("--chunks", type=int, default=800)
    ap.add_argument("--bad-index", type=int, default=-1)
    ap.add_argument("--bad-sw", default="9001")
    ap.add_argument("--acl-none", action="store_true")
    ap.add_argument("--out", default="poc.bin")
    args = ap.parse_args()
    parts = []
    for p in args.profile:
        blob = pathlib.Path(p).read_bytes()
        if args.acl_none:
            blob = acl_none(blob)
        parts.append(blob.rstrip())
    profile = b"\n".join(parts)
    atr = bytes.fromhex(args.atr.replace(" ", ""))
    ok = bytes.fromhex("6f04800200009000")
    bad = bytes.fromhex(args.bad_sw.replace(" ", ""))
    reader = [chunk(atr)]
    for i in range(1, args.chunks):
        reader.append(chunk(bad if i == args.bad_index else ok))
    out = pathlib.Path(args.out)
    out.write_bytes(profile + b"\0" + b"".join(reader))
    print(f"wrote {out} ({out.stat().st_size} bytes) bad_index={args.bad_index}")


if __name__ == "__main__":
    main()
