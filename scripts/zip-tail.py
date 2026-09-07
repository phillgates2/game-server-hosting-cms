#!/usr/bin/env python3
"""List a remote zip's contents via its central directory (tail range fetch).

Audit tool: verifies the layout inside a big upstream zip without downloading
it all (used to validate Xonotic/Bedrock packaging). Not part of `npm run verify`.

  python3 scripts/zip-tail.py <url> <needle> [needle ...]

Usage: zip-tail.py <url> <needle> [needle ...]
Prints total entries plus whether each needle appears in any entry path
(case-insensitive substring). No full download needed.
"""
import sys, struct, subprocess, tempfile, os

def http_size(url):
    out = subprocess.run(
        ["curl", "-fsSL", "--max-time", "60", "-I", url],
        check=False, capture_output=True, text=True,
    ).stdout
    for line in out.split("\r\n"):
        if line.lower().startswith("content-length"):
            return int(line.split(":")[-1].strip())
    return 0

def fetch_range(url, spec, out_path):
    subprocess.run(
        ["curl", "-fsSL", "--max-time", "180", "-r", spec, "-o", out_path, url],
        check=True, capture_output=True,
    )

def main():
    url = sys.argv[1]
    needles = [n.lower() for n in sys.argv[2:]]
    with tempfile.TemporaryDirectory() as td:
        size = http_size(url)
        print(f"total size: {size/1e6:.1f} MB")
        tail_path = os.path.join(td, "tail.bin")
        fetch_range(url, f"bytes=-{6*1024*1024}", tail_path)
        data = open(tail_path, "rb").read()

        eocd = data.rfind(b"PK\x05\x06")
        if eocd < 0:
            print("EOCD not found in tail"); return 1
        (n_disk, n_cd_disk, n_entries_disk, n_total, cd_size, cd_off) = struct.unpack(
            "<H H H H L L", data[eocd+4:eocd+22]
        )
        tail_start = size - len(data)
        cd_in_data = cd_off - tail_start
        if cd_in_data < 0 or cd_in_data + cd_size > len(data):
            print("central directory outside tail; fetching %d B" % (cd_size + 4096))
            cd_size2 = cd_size + 8192
            fetch_range(url, f"bytes=-{cd_size2}", tail_path)
            data = open(tail_path, "rb").read()
            tail_start = size - len(data)
            cd_in_data = cd_off - tail_start
        cd = data[cd_in_data:cd_in_data + cd_size]
        entries = []
        pos = 0
        sig = b"PK\x01\x02"
        while pos + 46 <= len(cd) and cd[pos:pos+4] == sig:
            fname_len = struct.unpack("<H", cd[pos+28:pos+30])[0]
            extra_len = struct.unpack("<H", cd[pos+30:pos+32])[0]
            comment_len = struct.unpack("<H", cd[pos+32:pos+34])[0]
            entries.append(cd[pos+46:pos+46+fname_len].decode("latin1", "replace"))
            pos += 46 + fname_len + extra_len + comment_len
        print(f"entries: {len(entries)} (reported {n_total})")
        for n in needles:
            hits = [e for e in entries if n in e.lower()]
            print(f"  {'FOUND' if hits else 'MISSING'}  {n!r}" + (f"  -> {hits[:3]}" if hits else ""))
        tops = sorted({e.split("/")[0] for e in entries if "/" in e} | {e for e in entries if "/" not in e})[:20]
        print("top-level:", tops)
    return 0

if __name__ == "__main__":
    sys.exit(main())
