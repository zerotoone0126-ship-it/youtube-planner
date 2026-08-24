#!/usr/bin/env python3
"""Aggregate per-video batch results into one summary CSV for the STEP 4-0 batch-16 report."""
import csv
import json
import os
import re
import sys

BASE = "/home/claude/poc/step4-0"
RESULTS = f"{BASE}/results/batch"
MANIFEST = f"{BASE}/videos/batch/manifest.csv"


def load_manifest():
    m = {}
    with open(MANIFEST, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            m[r["sample_id"]] = r
    return m


def load_csv_rows(path):
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return list(csv.DictReader(f))


def sum_intervals(rows, start_key="start_sec", end_key="end_sec"):
    total = 0.0
    for r in rows:
        try:
            total += float(r[end_key]) - float(r[start_key])
        except (ValueError, KeyError):
            pass
    return total


def parse_volumedetect(path):
    if not os.path.exists(path):
        return None, None
    mean_v = max_v = None
    with open(path) as f:
        text = f.read()
    m = re.search(r"mean_volume:\s*(-?[\d.]+)", text)
    if m:
        mean_v = float(m.group(1))
    m = re.search(r"max_volume:\s*(-?[\d.]+)", text)
    if m:
        max_v = float(m.group(1))
    return mean_v, max_v


def main():
    manifest = load_manifest()
    out_rows = []
    for sample_id in sorted(manifest.keys(), key=lambda s: int(s.split("_")[1])):
        d = f"{RESULTS}/{sample_id}"
        if not os.path.isdir(d):
            out_rows.append({"sample_id": sample_id, "status": "NOT_UPLOADED", "duration_s": manifest[sample_id]["duration_s"]})
            continue
        duration = float(manifest[sample_id]["duration_s"])

        proc_time_rows = load_csv_rows(f"{d}/{sample_id}_processing_time.csv")
        proc_time = float(proc_time_rows[0]["elapsed_sec"]) if proc_time_rows else None

        thresh_json_path = f"{d}/{sample_id}_threshold.json"
        thresh = json.load(open(thresh_json_path)) if os.path.exists(thresh_json_path) else {}

        cuts = load_csv_rows(f"{d}/{sample_id}_cuts.csv")
        events = load_csv_rows(f"{d}/{sample_id}_events.csv")
        n_black = sum(1 for e in events if e["event_type"] == "black")
        n_freeze = sum(1 for e in events if e["event_type"] == "freeze")
        n_silence = sum(1 for e in events if e["event_type"] == "silence")

        lowmotion = load_csv_rows(f"{d}/{sample_id}_lowmotion_baseline.csv")
        lowmotion_sec = sum_intervals(lowmotion)
        lowmotion_pct = 100.0 * lowmotion_sec / duration if duration else None

        audio_cands = load_csv_rows(f"{d}/{sample_id}_audio_candidates.csv")
        n_loud = sum(1 for r in audio_cands if r["event_type"] == "candidate_loud_event")
        n_silence_cand = sum(1 for r in audio_cands if r["event_type"] == "candidate_silence")

        mean_v, max_v = parse_volumedetect(f"{d}/{sample_id}_volumedetect.txt")

        out_rows.append({
            "sample_id": sample_id,
            "status": "OK",
            "duration_s": duration,
            "resolution": manifest[sample_id]["resolution"],
            "processing_time_s": round(proc_time, 2) if proc_time else None,
            "processing_ratio_pct": round(100 * proc_time / duration, 1) if proc_time and duration else None,
            "cut_threshold_method": thresh.get("method"),
            "cut_threshold_value": round(thresh.get("threshold", 0), 3) if thresh else None,
            "n_cut_candidates": len(cuts),
            "n_black_events": n_black,
            "n_freeze_events": n_freeze,
            "n_silence_events": n_silence,
            "lowmotion_baseline_pct_of_video": round(lowmotion_pct, 1) if lowmotion_pct is not None else None,
            "n_candidate_loud_event": n_loud,
            "n_candidate_silence": n_silence_cand,
            "mean_volume_db": mean_v,
            "max_volume_db": max_v,
        })
    return out_rows


if __name__ == "__main__":
    rows = main()
    out_path = f"{RESULTS}/batch_summary.csv"
    fieldnames = ["sample_id", "status", "duration_s", "resolution", "processing_time_s", "processing_ratio_pct",
                  "cut_threshold_method", "cut_threshold_value", "n_cut_candidates", "n_black_events",
                  "n_freeze_events", "n_silence_events", "lowmotion_baseline_pct_of_video",
                  "n_candidate_loud_event", "n_candidate_silence", "mean_volume_db", "max_volume_db"]
    with open(out_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fieldnames})
    print(f"wrote {out_path}")
    ok_rows = [r for r in rows if r["status"] == "OK"]
    ratios = [r["processing_ratio_pct"] for r in ok_rows if r["processing_ratio_pct"] is not None]
    if ratios:
        ratios_sorted = sorted(ratios)
        n = len(ratios_sorted)
        mean = sum(ratios_sorted) / n
        median = ratios_sorted[n // 2] if n % 2 else (ratios_sorted[n // 2 - 1] + ratios_sorted[n // 2]) / 2
        print(f"processing_ratio_pct: n={n} mean={mean:.1f} median={median:.1f} min={min(ratios_sorted):.1f} max={max(ratios_sorted):.1f}")
