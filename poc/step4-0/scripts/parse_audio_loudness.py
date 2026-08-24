#!/usr/bin/env python3
"""
Parse ffmpeg ebur128 momentary-loudness metadata into CANDIDATE audio events.

Per explicit user instruction (2026-08-23): until a human has listened to the
audio and confirmed/labeled it, this script must NOT assert that a moment is
a "loud spike problem" or a "silence problem" -- only that it is a
CANDIDATE, produced purely by a relative/statistical rule on the signal
itself (top/bottom percentile of momentary loudness within THIS video), with
no manually-chosen absolute dB threshold and no claim about the actual
audio content (Claude cannot hear).

Inputs:
  - an ebur128 metadata=print log (frame:/pts_time:/lavfi.r128.M= lines),
    e.g. produced by: -af "ebur128=metadata=1,ametadata=print:file=..."
  - (optional) an existing events CSV from parse_events.py containing
    silencedetect rows (event_type == "silence") -- these are copied through
    as candidate_silence rather than re-derived, since silencedetect is
    already a real, established algorithm; we just relabel the language.

Output CSV columns: video_id,event_type,start_sec,end_sec,peak_or_min_M,note
  event_type in {candidate_loud_event, candidate_silence}

Usage:
  python3 parse_audio_loudness.py <video_id> <ebur128_log> <out_csv> \
      [--events-csv game_01_events.csv] [--top-pct 1.0] [--merge-gap 0.3]
"""
import re
import csv
import argparse

FRAME_RE = re.compile(r"^frame:(\d+)\s+pts:(\d+)\s+pts_time:([\d.]+)")
M_RE = re.compile(r"^lavfi\.r128\.M=(-?[\d.]+)")


def parse_log(path):
    rows = []  # (pts_time, M)
    cur_time = None
    with open(path) as f:
        for line in f:
            m = FRAME_RE.match(line)
            if m:
                cur_time = float(m.group(3))
                continue
            m2 = M_RE.match(line.strip())
            if m2 and cur_time is not None:
                val = float(m2.group(1))
                if val > -100:  # ffmpeg emits -120.7-ish "silence init" sentinel before audio starts
                    rows.append((cur_time, val))
    return rows


def merge_intervals(times_vals, merge_gap):
    """times_vals: sorted list of (time, value) already filtered to candidate points."""
    if not times_vals:
        return []
    intervals = []
    start_t, start_v = times_vals[0]
    end_t = start_t
    best_v = start_v
    for t, v in times_vals[1:]:
        if t - end_t <= merge_gap:
            end_t = t
            if abs(v) > abs(best_v) if False else v > best_v:
                best_v = v
        else:
            intervals.append((start_t, end_t, best_v))
            start_t, end_t, best_v = t, t, v
    intervals.append((start_t, end_t, best_v))
    return intervals


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video_id")
    ap.add_argument("ebur128_log")
    ap.add_argument("out_csv")
    ap.add_argument("--events-csv", default=None, help="parse_events.py output; silence rows are copied through as candidate_silence")
    ap.add_argument("--top-pct", type=float, default=1.0, help="top X%% of momentary loudness -> candidate_loud_event")
    ap.add_argument("--merge-gap", type=float, default=0.3, help="merge candidate points within this many seconds")
    args = ap.parse_args()

    rows = parse_log(args.ebur128_log)
    if not rows:
        print("WARNING: no M values parsed (silent/empty audio track?)")
    vals = sorted(v for _, v in rows)
    n = len(vals)
    threshold = vals[int(n * (1 - args.top_pct / 100.0))] if n else None

    out_rows = []
    if threshold is not None:
        candidates = [(t, v) for t, v in rows if v >= threshold]
        for start_t, end_t, peak_v in merge_intervals(candidates, args.merge_gap):
            out_rows.append((args.video_id, "candidate_loud_event", round(start_t, 2), round(end_t, 2), round(peak_v, 2),
                              f"statistical top {args.top_pct}% of momentary loudness (M) in this video; NOT a confirmed problem, content unheard by Claude"))

    if args.events_csv:
        with open(args.events_csv) as f:
            for r in csv.DictReader(f):
                if r.get("event_type") == "silence" and r.get("video_id") == args.video_id:
                    out_rows.append((args.video_id, "candidate_silence", r["start_sec"], r["end_sec"], "",
                                      "copied from silencedetect (ffmpeg); relabeled as candidate pending human review of context"))

    out_rows.sort(key=lambda r: float(r[2]) if r[2] != "" else 0)
    with open(args.out_csv, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["video_id", "event_type", "start_sec", "end_sec", "peak_or_min_M", "note"])
        w.writerows(out_rows)

    print(f"{args.video_id}: {n} loudness samples parsed, top-{args.top_pct}% threshold={threshold}")
    print(f"wrote {len(out_rows)} candidate rows to {args.out_csv}")


if __name__ == "__main__":
    main()
