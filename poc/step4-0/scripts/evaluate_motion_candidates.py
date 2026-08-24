#!/usr/bin/env python3
"""
Evaluate the 5 candidate low-motion/static signals (from analyze_motion_candidates.py)
against HUMAN-LABELED ground truth, using a calibration/holdout split to avoid
overfitting -- per user instruction (2026-08-23):

  "동일한 ground truth 데이터에서 threshold를 스캔하여 최고 F1을 선택하고, 그 동일
   데이터의 최고 F1을 그대로 채택/조건부/제외 판정에 쓰는 것은 과적합 가능성이 있다."

Two subcommands:

  calibrate   Scan threshold candidates (5th-95th percentile of the signal,
              step 5) on a calibration/dev video's ground truth, pick the
              max-F1 threshold per signal, and save the CHOSEN thresholds
              (not re-selectable later) plus the calibration F1/FP/FN to a
              JSON file. The calibration F1 is explicitly NOT reported as
              final product performance -- it is the number used to CHOOSE
              the threshold, so it is optimistic by construction.

  holdout     Load thresholds from a calibrate run's JSON (FROZEN -- this
              subcommand never re-scans or re-picks a threshold) and apply
              them to a DIFFERENT video's ground truth. This produces the
              real F1 estimate. If holdout data is not available yet, this
              subcommand cannot run -- that is expected and should not be
              worked around by reusing the calibration video.

Ground truth format (see ground-truth-pending/*_lowmotion_gt_template.csv):
  video_id,label_type,start_sec,end_sec,labeler_id,notes
  label_type in {positive_static, negative_active}

Adoption verdict (docs/plan-step-4-0-feasibility-poc.md section 4):
  F1 >= 0.70            -> 채택 후보
  0.50 <= F1 < 0.70     -> 조건부
  F1 < 0.50             -> 제외 후보
Per user instruction, this verdict should be based on HOLDOUT F1 whenever a
holdout run exists. A calibration-only run must not print a final verdict --
it prints "판정 보류 (calibration만 있음, holdout 필요)" instead.

Usage:
  python3 evaluate_motion_candidates.py calibrate <signals.csv> <gt.csv> --video-id game_01 --out calib_game_01.json
  python3 evaluate_motion_candidates.py holdout <signals.csv> <gt.csv> --video-id game_02 --calib calib_game_01.json --out holdout_game_02.json
"""
import sys
import csv
import json
import argparse
import numpy as np

SIGNAL_COLS = ["whole_frame_diff", "tile_max_diff", "tile_topk_mean", "optical_flow_mag", "ssim_change"]


def load_signals(path, video_id):
    rows = []
    with open(path) as f:
        for r in csv.DictReader(f):
            if r["video_id"] != video_id:
                continue
            rows.append({"time_sec": float(r["time_sec"]), **{c: float(r[c]) for c in SIGNAL_COLS}})
    rows.sort(key=lambda r: r["time_sec"])
    return rows


def load_ground_truth(path, video_id):
    intervals = []
    with open(path) as f:
        for r in csv.DictReader(f):
            if r["video_id"] != video_id:
                continue
            if not r.get("start_sec") or not r.get("end_sec"):
                continue
            label = r["label_type"]
            if label not in ("positive_static", "negative_active"):
                continue
            intervals.append({"label": label, "start": float(r["start_sec"]), "end": float(r["end_sec"])})
    return intervals


def score_at_threshold(rows, intervals, signal_col, threshold):
    values = np.array([r[signal_col] for r in rows])
    times = np.array([r["time_sec"] for r in rows])
    tp = fp = fn = tn = 0
    fp_examples, fn_examples = [], []
    for iv in intervals:
        mask = (times >= iv["start"]) & (times <= iv["end"])
        if mask.sum() == 0:
            continue
        frac_static = (values[mask] <= threshold).mean()
        predicted_static = frac_static >= 0.5
        actual_static = (iv["label"] == "positive_static")
        entry = {"start": iv["start"], "end": iv["end"], "frac_static": round(float(frac_static), 3)}
        if actual_static and predicted_static:
            tp += 1
        elif actual_static and not predicted_static:
            fn += 1
            fn_examples.append(entry)  # actually static but we predicted active (missed)
        elif not actual_static and predicted_static:
            fp += 1
            fp_examples.append(entry)  # actually active but we predicted static (false alarm)
        else:
            tn += 1
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    return {"precision": precision, "recall": recall, "f1": f1, "tp": tp, "fp": fp, "fn": fn, "tn": tn,
            "fp_examples": fp_examples, "fn_examples": fn_examples}


def verdict(f1):
    if f1 >= 0.7:
        return "채택 후보"
    if f1 >= 0.5:
        return "조건부"
    return "제외 후보"


def cmd_calibrate(args):
    rows = load_signals(args.signals_csv, args.video_id)
    intervals = load_ground_truth(args.gt_csv, args.video_id)
    n_pos = sum(1 for iv in intervals if iv["label"] == "positive_static")
    n_neg = sum(1 for iv in intervals if iv["label"] == "negative_active")
    print(f"# CALIBRATION on {args.video_id}: {len(rows)} sampled frames, "
          f"{n_pos} positive_static + {n_neg} negative_active intervals")
    if n_pos == 0 or n_neg == 0:
        print("ERROR: no usable ground truth (need >=1 positive_static and >=1 negative_active with start/end filled). "
              "Nothing to calibrate yet.")
        sys.exit(1)
    if n_pos < 3 or n_neg < 3:
        print(f"CAVEAT: only {n_pos} positive / {n_neg} negative -- below planned minimum of 3-5 each. "
              "This calibration is directional only.")

    result = {"video_id": args.video_id, "n_pos": n_pos, "n_neg": n_neg, "signals": {}}
    print("\nsignal,chosen_percentile,chosen_threshold,calibration_f1,calibration_precision,calibration_recall,TP,FP,FN,TN")
    for col in SIGNAL_COLS:
        values = np.array([r[col] for r in rows])
        best = None
        for pct in range(5, 100, 5):
            threshold = float(np.percentile(values, pct))
            s = score_at_threshold(rows, intervals, col, threshold)
            if best is None or s["f1"] > best[1]["f1"]:
                best = (pct, s, threshold)
        pct, s, threshold = best
        result["signals"][col] = {
            "chosen_percentile": pct, "chosen_threshold": threshold,
            "calibration_f1": s["f1"], "calibration_precision": s["precision"], "calibration_recall": s["recall"],
            "tp": s["tp"], "fp": s["fp"], "fn": s["fn"], "tn": s["tn"],
            "fp_examples": s["fp_examples"], "fn_examples": s["fn_examples"],
        }
        print(f"{col},{pct},{threshold:.4f},{s['f1']:.3f},{s['precision']:.3f},{s['recall']:.3f},"
              f"{s['tp']},{s['fp']},{s['fn']},{s['tn']}")

    with open(args.out, "w") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(f"\nSaved FROZEN thresholds + calibration metrics to {args.out}")
    print("NOTE: calibration F1 is NOT final product performance -- it is optimistic by construction "
          "(same data used to pick the threshold). A holdout run on a DIFFERENT video is required before "
          "any 채택/조건부/제외 verdict is issued.")


def cmd_holdout(args):
    with open(args.calib) as f:
        calib = json.load(f)
    rows = load_signals(args.signals_csv, args.video_id)
    intervals = load_ground_truth(args.gt_csv, args.video_id)
    n_pos = sum(1 for iv in intervals if iv["label"] == "positive_static")
    n_neg = sum(1 for iv in intervals if iv["label"] == "negative_active")
    print(f"# HOLDOUT on {args.video_id} (thresholds frozen from calibration video {calib['video_id']}): "
          f"{len(rows)} sampled frames, {n_pos} positive_static + {n_neg} negative_active intervals")
    if n_pos == 0 or n_neg == 0:
        print("ERROR: no usable holdout ground truth yet. Cannot compute a holdout F1 without it -- "
              "this is expected until a second game-genre video's ground truth is provided.")
        sys.exit(1)

    result = {"calibration_video": calib["video_id"], "holdout_video": args.video_id, "signals": {}}
    print("\nsignal,frozen_threshold(from calibration),calibration_f1,holdout_f1,holdout_precision,holdout_recall,TP,FP,FN,TN,verdict(holdout기준)")
    for col in SIGNAL_COLS:
        threshold = calib["signals"][col]["chosen_threshold"]
        s = score_at_threshold(rows, intervals, col, threshold)
        v = verdict(s["f1"])
        result["signals"][col] = {
            "frozen_threshold": threshold, "calibration_f1": calib["signals"][col]["calibration_f1"],
            "holdout_f1": s["f1"], "holdout_precision": s["precision"], "holdout_recall": s["recall"],
            "tp": s["tp"], "fp": s["fp"], "fn": s["fn"], "tn": s["tn"],
            "fp_examples": s["fp_examples"], "fn_examples": s["fn_examples"], "verdict": v,
        }
        print(f"{col},{threshold:.4f},{calib['signals'][col]['calibration_f1']:.3f},{s['f1']:.3f},"
              f"{s['precision']:.3f},{s['recall']:.3f},{s['tp']},{s['fp']},{s['fn']},{s['tn']},{v}")

    with open(args.out, "w") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(f"\nSaved holdout evaluation to {args.out}")
    print("Reminder: if thresholds are re-picked after seeing this holdout result, the result no longer counts "
          "as a valid holdout score (per user instruction) -- a fresh, still-unseen video would be needed.")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("calibrate")
    c.add_argument("signals_csv")
    c.add_argument("gt_csv")
    c.add_argument("--video-id", required=True)
    c.add_argument("--out", required=True)
    c.set_defaults(func=cmd_calibrate)

    h = sub.add_parser("holdout")
    h.add_argument("signals_csv")
    h.add_argument("gt_csv")
    h.add_argument("--video-id", required=True)
    h.add_argument("--calib", required=True)
    h.add_argument("--out", required=True)
    h.set_defaults(func=cmd_holdout)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
