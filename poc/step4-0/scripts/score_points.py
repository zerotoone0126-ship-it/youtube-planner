#!/usr/bin/env python3
"""Score point-event predictions (e.g. edit cuts) against human-labeled ground truth.

Matching rule: a predicted timestamp matches a ground-truth timestamp if they are
within `tolerance_sec` of each other (default 0.3s, per plan-step-4-0-feasibility-poc.md
section 3-3). Each ground-truth point can be matched at most once (greedy nearest-match).

Usage: python3 score_points.py <predicted_csv> <predicted_time_col> \
       <ground_truth_csv> <gt_time_col> <video_id> <out_report_csv> [tolerance_sec]

predicted_csv must have a column matching predicted_time_col (e.g. timestamp_sec).
ground_truth_csv must have columns: video_id, ..., <gt_time_col> (e.g. timestamp_sec).
"""
import sys
import csv


def load_times(path, time_col, video_id=None, video_col="video_id"):
    out = []
    with open(path) as f:
        r = csv.DictReader(f)
        for row in r:
            if video_id is not None and row.get(video_col) != video_id:
                continue
            v = row.get(time_col, "")
            if v in ("", None):
                continue
            out.append(float(v))
    return sorted(out)


def match(pred, gt, tolerance):
    gt_remaining = list(gt)
    tp, fp, matched_pairs = [], [], []
    for p in pred:
        best = None
        best_d = None
        for g in gt_remaining:
            d = abs(p - g)
            if d <= tolerance and (best_d is None or d < best_d):
                best, best_d = g, d
        if best is not None:
            tp.append(p)
            matched_pairs.append((p, best))
            gt_remaining.remove(best)
        else:
            fp.append(p)
    fn = gt_remaining
    return tp, fp, fn, matched_pairs


def main():
    pred_csv, pred_col, gt_csv, gt_col, video_id, out_path = sys.argv[1:7]
    tolerance = float(sys.argv[7]) if len(sys.argv) > 7 else 0.3

    pred = load_times(pred_csv, pred_col, video_id=video_id) if _has_video_col(pred_csv) else load_times(pred_csv, pred_col)
    gt = load_times(gt_csv, gt_col, video_id=video_id)

    tp, fp, fn, pairs = match(pred, gt, tolerance)
    precision = len(tp) / len(pred) if pred else float("nan")
    recall = len(tp) / len(gt) if gt else float("nan")
    f1 = (2 * precision * recall / (precision + recall)) if (precision and recall and (precision + recall) > 0) else float("nan")

    with open(out_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["video_id", "n_pred", "n_gt", "n_tp", "n_fp", "n_fn", "precision", "recall", "f1", "tolerance_sec"])
        w.writerow([video_id, len(pred), len(gt), len(tp), len(fp), len(fn), precision, recall, f1, tolerance])
        w.writerow([])
        w.writerow(["false_positive_timestamps (predicted, no matching ground truth)"])
        for x in fp:
            w.writerow([x])
        w.writerow([])
        w.writerow(["false_negative_timestamps (ground truth missed)"])
        for x in fn:
            w.writerow([x])

    print(f"{video_id}: P={precision:.3f} R={recall:.3f} F1={f1:.3f} (tp={len(tp)} fp={len(fp)} fn={len(fn)}) -> {out_path}")


def _has_video_col(path):
    with open(path) as f:
        header = f.readline()
    return "video_id" in header


if __name__ == "__main__":
    main()
