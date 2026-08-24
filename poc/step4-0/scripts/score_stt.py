#!/usr/bin/env python3
"""
Score an EXTERNALLY-RUN STT engine's output against human-written ground
truth transcripts. This session's sandbox cannot run any real ASR engine
(no network access to model-weight hosts, no pip install of new packages --
confirmed 2026-08-23: even a trivial new pypi package returns 403). This
script is what gets run once real prediction output comes back from the
user's own environment -- it does not fabricate any STT result itself.

Ground truth CSV (human listens to the clip and transcribes exactly what
was said -- see ground-truth-pending/stt_minimal_benchmark_gt.csv):
  video_id,segment_id,start_sec,end_sec,ref_text,labeler_id,notes

Prediction CSV (produced by running a real STT engine externally, see
STT-SECRET-INJECTION-PLAN.md for exact commands):
  video_id,segment_id,pred_text,pred_start_sec,pred_end_sec,model_name,processing_time_sec

Usage:
  python3 score_stt.py <gt_csv> <pred_csv>
"""
import sys
import csv
import argparse
from cer import cer, wer


def load_csv(path):
    rows = {}
    with open(path) as f:
        for r in csv.DictReader(f):
            key = (r["video_id"], r["segment_id"])
            rows[key] = r
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("gt_csv")
    ap.add_argument("pred_csv")
    ap.add_argument("--cer-fail-threshold", type=float, default=0.3,
                     help="segments with CER above this are listed as failure cases")
    args = ap.parse_args()

    gt = load_csv(args.gt_csv)
    pred = load_csv(args.pred_csv)

    scored = []
    missing_pred = []
    missing_gt_text = []
    for key, g in gt.items():
        ref = (g.get("ref_text") or "").strip()
        if not ref:
            missing_gt_text.append(key)
            continue
        if key not in pred:
            missing_pred.append(key)
            continue
        p = pred[key]
        hyp = (p.get("pred_text") or "").strip()
        c = cer(ref, hyp)
        w = wer(ref, hyp)
        ts_mae = None
        try:
            gs, ge = float(g["start_sec"]), float(g["end_sec"])
            ps, pe = float(p["pred_start_sec"]), float(p["pred_end_sec"])
            ts_mae = (abs(gs - ps) + abs(ge - pe)) / 2
        except (KeyError, ValueError, TypeError):
            pass
        scored.append({"key": key, "ref": ref, "hyp": hyp, "cer": c, "wer": w, "ts_mae": ts_mae,
                        "processing_time_sec": p.get("processing_time_sec")})

    if missing_gt_text:
        print(f"NOTE: {len(missing_gt_text)} ground-truth rows have no ref_text yet (not transcribed) -- skipped: "
              f"{missing_gt_text}")
    if missing_pred:
        print(f"NOTE: {len(missing_pred)} ground-truth segments have no matching prediction row yet -- skipped: "
              f"{missing_pred}")

    if not scored:
        print("\nNo scoreable segments (need both ref_text AND a matching prediction row). "
              "Nothing to report -- this is expected until (1) a human transcribes ref_text and "
              "(2) a real STT engine is run externally and its output CSV is provided.")
        sys.exit(0)

    print(f"\n# Scored {len(scored)} segment(s)\n")
    print("video/segment,CER,WER,timestamp_MAE_sec,processing_time_sec")
    for s in scored:
        vid, seg = s["key"]
        ts = f"{s['ts_mae']:.2f}" if s["ts_mae"] is not None else "N/A"
        print(f"{vid}/{seg},{s['cer']:.3f},{s['wer']:.3f},{ts},{s.get('processing_time_sec','N/A')}")

    mean_cer = sum(s["cer"] for s in scored) / len(scored)
    mean_wer = sum(s["wer"] for s in scored) / len(scored)
    ts_vals = [s["ts_mae"] for s in scored if s["ts_mae"] is not None]
    mean_ts = sum(ts_vals) / len(ts_vals) if ts_vals else None
    print(f"\nMean CER: {mean_cer:.3f}")
    print(f"Mean WER: {mean_wer:.3f} (secondary metric -- CER is primary for Korean)")
    print(f"Mean timestamp MAE: {mean_ts:.3f}s" if mean_ts is not None else "\nMean timestamp MAE: N/A (no timestamps provided)")

    failures = [s for s in scored if s["cer"] > args.cer_fail_threshold]
    if failures:
        print(f"\nFailure cases (CER > {args.cer_fail_threshold}):")
        for s in failures:
            vid, seg = s["key"]
            print(f"  {vid}/{seg}: CER={s['cer']:.3f}\n    ref: {s['ref']}\n    hyp: {s['hyp']}")
    else:
        print(f"\nNo segments exceeded the CER {args.cer_fail_threshold} failure threshold.")


if __name__ == "__main__":
    main()
