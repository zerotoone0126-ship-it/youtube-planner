#!/usr/bin/env python3
"""Parse the metadata=print log (scdet threshold=0 + signalstats) into a per-frame CSV.

IMPORTANT (found during smoke-testing): scdet only reports lavfi.scd.mafd on frames
where its score exceeds the configured `threshold`. To get a continuous per-frame
MAFD signal (needed to build our own persistence/threshold-based cut classifier,
per the corrected design in plan-v1-revised.md), the ffmpeg command MUST use
`scdet=threshold=0:sc_pass=1` — NOT the "reasonable" threshold like 8. Thresholding
happens in this script instead, in Python, where it can be tuned against ground truth.

Usage: python3 parse_continuous_signals.py <video_id> <metadata_log_path> <out_csv_path>
"""
import re
import sys
import csv


FRAME_RE = re.compile(r"^frame:(\d+)\s+pts:(\d+)\s+pts_time:([\d.]+)")
KV_RE = re.compile(r"^lavfi\.(\S+)=(\S+)$")


def parse(log_path):
    rows = []
    cur = None
    with open(log_path, "r", errors="replace") as f:
        for line in f:
            line = line.rstrip("\n")
            m = FRAME_RE.match(line)
            if m:
                if cur is not None:
                    rows.append(cur)
                cur = {"frame": int(m.group(1)), "pts_time": float(m.group(3))}
                continue
            m = KV_RE.match(line)
            if m and cur is not None:
                cur[m.group(1)] = m.group(2)
    if cur is not None:
        rows.append(cur)
    return rows


def main():
    video_id, log_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    rows = parse(log_path)
    with open(out_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["video_id", "frame", "pts_time", "scd_mafd", "ydif", "udif", "vdif"])
        for r in rows:
            w.writerow([
                video_id, r.get("frame"), r.get("pts_time"),
                r.get("scd.mafd", ""), r.get("signalstats.YDIF", ""),
                r.get("signalstats.UDIF", ""), r.get("signalstats.VDIF", ""),
            ])
    print(f"Parsed {len(rows)} frames -> {out_path}")


if __name__ == "__main__":
    main()
