#!/usr/bin/env python3
"""
Score an EXTERNALLY-RUN OCR engine's output against human-read ground truth
for burned-in Korean subtitle frames. This session's sandbox has no Korean
tesseract language pack (only eng+osd) and cannot install one or any other
Korean-capable OCR engine (apt-get to archive.ubuntu.com and pip install of
any new package both return 403 -- confirmed 2026-08-23). This script is
what gets run once real OCR output comes back from the user's own
environment -- it does not fabricate any OCR result itself. Claude's own
visual reading of these frames is NEVER used as the ref_text ground truth --
only a human filling in ref_text counts.

Ground truth CSV (human looks at each frame image and types EXACTLY what
text is visibly rendered on screen -- see
ground-truth-pending/ocr_minimal_benchmark_gt.csv):
  frame_id,video_id,timestamp_sec,style_tag,frame_file,ref_text,labeler_id,notes

Prediction CSV (produced by running a real OCR engine externally, see
OCR-EXTERNAL-EXECUTION-PLAN.md for exact commands):
  frame_id,video_id,detected_text,confidence

Usage:
  python3 score_ocr.py <gt_csv> <pred_csv>
"""
import sys
import csv
import argparse
from cer import cer


def load_csv(path, key_field="frame_id"):
    rows = {}
    with open(path) as f:
        for r in csv.DictReader(f):
            rows[r[key_field]] = r
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("gt_csv")
    ap.add_argument("pred_csv")
    ap.add_argument("--cer-fail-threshold", type=float, default=0.3)
    args = ap.parse_args()

    gt = load_csv(args.gt_csv)
    pred = load_csv(args.pred_csv)

    scored = []
    not_transcribed = []
    missing_pred = []
    for frame_id, g in gt.items():
        ref = (g.get("ref_text") or "").strip()
        if not ref:
            not_transcribed.append(frame_id)
            continue
        if frame_id not in pred:
            missing_pred.append(frame_id)
            continue
        p = pred[frame_id]
        hyp = (p.get("detected_text") or "").strip()
        detected = len(hyp) > 0
        c = cer(ref, hyp) if detected else 1.0
        scored.append({"frame_id": frame_id, "video_id": g["video_id"], "style_tag": g.get("style_tag", ""),
                        "ref": ref, "hyp": hyp, "detected": detected, "cer": c})

    if not_transcribed:
        print(f"NOTE: {len(not_transcribed)} ground-truth frames have no ref_text yet (not human-transcribed) "
              f"-- skipped: {not_transcribed}")
    if missing_pred:
        print(f"NOTE: {len(missing_pred)} ground-truth frames have no matching prediction row yet -- skipped: "
              f"{missing_pred}")

    if not scored:
        print("\nNo scoreable frames (need both ref_text AND a matching prediction row). Nothing to report -- "
              "expected until (1) a human transcribes ref_text for each frame and (2) a real OCR engine is run "
              "externally and its output CSV is provided.")
        sys.exit(0)

    n = len(scored)
    detected_n = sum(1 for s in scored if s["detected"])
    recall = detected_n / n
    mean_cer_detected = (sum(s["cer"] for s in scored if s["detected"]) / detected_n) if detected_n else float("nan")

    print(f"\n# Scored {n} frame(s)")
    print(f"Detection recall (text found at all when ref_text non-empty): {detected_n}/{n} = {recall:.3f}")
    print(f"Mean CER (on frames where something was detected): {mean_cer_detected:.3f}" if detected_n else
          "Mean CER: N/A (nothing detected on any frame)")

    print("\nframe_id,video_id,style_tag,detected,CER")
    for s in scored:
        print(f"{s['frame_id']},{s['video_id']},{s['style_tag']},{s['detected']},{s['cer']:.3f}")

    print("\n## Style-wise breakdown")
    styles = sorted(set(s["style_tag"] for s in scored))
    for style in styles:
        rows = [s for s in scored if s["style_tag"] == style]
        d = sum(1 for s in rows if s["detected"])
        mean_c = (sum(s["cer"] for s in rows if s["detected"]) / d) if d else float("nan")
        print(f"  {style}: n={len(rows)} recall={d}/{len(rows)} mean_CER={mean_c if d else 'N/A'}")

    failures = [s for s in scored if (not s["detected"]) or s["cer"] > args.cer_fail_threshold]
    if failures:
        print(f"\nFailure cases (not detected, or CER > {args.cer_fail_threshold}):")
        for s in failures:
            print(f"  [{s['style_tag']}] {s['frame_id']} ({s['video_id']}): detected={s['detected']} CER={s['cer']:.3f}\n"
                  f"    ref: {s['ref']}\n    hyp: {s['hyp']}")
    else:
        print(f"\nNo frames exceeded the CER {args.cer_fail_threshold} failure threshold and all were detected.")


if __name__ == "__main__":
    main()
