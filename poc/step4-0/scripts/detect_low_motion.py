#!/usr/bin/env python3
"""Low-motion/static segment detection: 2-signal design per plan-v1-revised.md #2.

Signal A: freezedetect intervals (from parse_events.py output) -- near-total freeze.
Signal B: sustained low YDIF (rolling window average below threshold for >= min_duration_sec).
Output = union (OR) of A and B, merged into non-overlapping intervals.

Usage: python3 detect_low_motion.py <video_id> <continuous_signals_csv> <events_csv> <out_csv> \
       [ydif_threshold] [window_sec] [min_duration_sec]
"""
import sys
import csv


def load_continuous(path):
    rows = []
    with open(path) as f:
        r = csv.DictReader(f)
        for row in r:
            try:
                ydif = float(row["ydif"]) if row["ydif"] not in ("", None) else None
            except ValueError:
                ydif = None
            if ydif is None:
                continue
            rows.append({"t": float(row["pts_time"]), "ydif": ydif})
    return rows


def load_freeze_intervals(events_csv):
    out = []
    with open(events_csv) as f:
        r = csv.DictReader(f)
        for row in r:
            if row["event_type"] == "freeze" and row["end_sec"]:
                out.append((float(row["start_sec"]), float(row["end_sec"])))
    return out


def rolling_low_motion(rows, ydif_threshold, window_sec, min_duration_sec):
    if not rows:
        return []
    flagged = []
    n = len(rows)
    for i in range(n):
        t0 = rows[i]["t"]
        window = [r for r in rows if t0 <= r["t"] < t0 + window_sec]
        if not window:
            continue
        avg = sum(w["ydif"] for w in window) / len(window)
        if avg < ydif_threshold:
            flagged.append(t0)
    if not flagged:
        return []
    intervals = []
    start = flagged[0]
    prev = flagged[0]
    for t in flagged[1:]:
        if t - prev > window_sec * 2:
            if prev - start >= min_duration_sec:
                intervals.append((start, prev))
            start = t
        prev = t
    if prev - start >= min_duration_sec:
        intervals.append((start, prev))
    return intervals


def merge_intervals(intervals):
    if not intervals:
        return []
    intervals = sorted(intervals)
    merged = [list(intervals[0])]
    for s, e in intervals[1:]:
        if s <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])
    return [tuple(m) for m in merged]


def main():
    video_id = sys.argv[1]
    continuous_csv = sys.argv[2]
    events_csv = sys.argv[3]
    out_path = sys.argv[4]
    ydif_threshold = float(sys.argv[5]) if len(sys.argv) > 5 else 2.0
    window_sec = float(sys.argv[6]) if len(sys.argv) > 6 else 5.0
    min_duration_sec = float(sys.argv[7]) if len(sys.argv) > 7 else 5.0

    rows = load_continuous(continuous_csv)
    freeze_intervals = load_freeze_intervals(events_csv)
    motion_intervals = rolling_low_motion(rows, ydif_threshold, window_sec, min_duration_sec)
    combined = merge_intervals(freeze_intervals + motion_intervals)

    with open(out_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["video_id", "start_sec", "end_sec", "source",
                     "ydif_threshold", "window_sec", "min_duration_sec"])
        for s, e in combined:
            w.writerow([video_id, s, e, "freeze_or_low_motion",
                        ydif_threshold, window_sec, min_duration_sec])
    print(f"{len(combined)} low-motion/static intervals -> {out_path}")


if __name__ == "__main__":
    main()
