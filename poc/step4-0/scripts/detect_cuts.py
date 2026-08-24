#!/usr/bin/env python3
"""Candidate cut detection from the continuous scd_mafd signal.

Design (per research-video-analysis-v1-feasibility.md #3): don't trust a bare
per-frame MAFD spike as a "cut" -- require the spike to be a local peak relative
to a persistence check, to reduce false positives from flashes/fast pans.
This is intentionally simple for the PoC: a frame counts as a candidate cut if
its scd_mafd exceeds `threshold` AND is a local max within +/- `persist_frames`.

Usage: python3 detect_cuts.py <video_id> <continuous_signals_csv> <out_csv> [threshold] [persist_frames]
"""
import sys
import csv


def main():
    video_id = sys.argv[1]
    in_path = sys.argv[2]
    out_path = sys.argv[3]
    threshold = float(sys.argv[4]) if len(sys.argv) > 4 else 15.0
    persist = int(sys.argv[5]) if len(sys.argv) > 5 else 2

    rows = []
    with open(in_path) as f:
        r = csv.DictReader(f)
        for row in r:
            try:
                mafd = float(row["scd_mafd"]) if row["scd_mafd"] not in ("", None) else 0.0
            except ValueError:
                mafd = 0.0
            rows.append({"pts_time": float(row["pts_time"]), "mafd": mafd})

    candidates = []
    for i, r in enumerate(rows):
        if r["mafd"] < threshold:
            continue
        lo = max(0, i - persist)
        hi = min(len(rows), i + persist + 1)
        window = rows[lo:hi]
        if r["mafd"] >= max(w["mafd"] for w in window):
            candidates.append(r)

    with open(out_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["video_id", "timestamp_sec", "mafd", "threshold_used", "persist_frames_used"])
        for c in candidates:
            w.writerow([video_id, c["pts_time"], c["mafd"], threshold, persist])
    print(f"{len(candidates)} candidate cuts (threshold={threshold}, persist={persist}) -> {out_path}")


if __name__ == "__main__":
    main()
