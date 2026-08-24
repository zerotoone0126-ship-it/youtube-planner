#!/usr/bin/env python3
"""Score interval predictions (static segments, subtitle-on segments, etc.) against
human-labeled ground-truth intervals, using overlap-based matching.

A predicted interval matches a ground-truth interval if their overlap (IoU) is
>= iou_threshold (default 0.3 -- deliberately lenient for a first pass; tighten
once real data comes in, and RECORD why in the threshold-change log per the
user's principle #5).

Usage: python3 score_intervals.py <predicted_csv> <ground_truth_csv> <video_id> \
       <out_report_csv> [iou_threshold]

predicted_csv columns expected: video_id, start_sec, end_sec, ...
ground_truth_csv columns expected: video_id, start_sec, end_sec, ...
"""
import sys
import csv


def load_intervals(path, video_id):
    out = []
    with open(path) as f:
        r = csv.DictReader(f)
        for row in r:
            if row.get("video_id") != video_id:
                continue
            s, e = row.get("start_sec"), row.get("end_sec")
            if s in ("", None) or e in ("", None):
                continue
            out.append((float(s), float(e)))
    return out


def iou(a, b):
    s = max(a[0], b[0])
    e = min(a[1], b[1])
    inter = max(0.0, e - s)
    union = (a[1] - a[0]) + (b[1] - b[0]) - inter
    return inter / union if union > 0 else 0.0


def match(pred, gt, iou_threshold):
    gt_remaining = list(gt)
    tp, fp = [], []
    for p in pred:
        best, best_iou = None, 0.0
        for g in gt_remaining:
            score = iou(p, g)
            if score >= iou_threshold and score > best_iou:
                best, best_iou = g, score
        if best is not None:
            tp.append((p, best, best_iou))
            gt_remaining.remove(best)
        else:
            fp.append(p)
    fn = gt_remaining
    return tp, fp, fn


def main():
    pred_csv, gt_csv, video_id, out_path = sys.argv[1:5]
    iou_threshold = float(sys.argv[5]) if len(sys.argv) > 5 else 0.3

    pred = load_intervals(pred_csv, video_id)
    gt = load_intervals(gt_csv, video_id)
    tp, fp, fn = match(pred, gt, iou_threshold)

    precision = len(tp) / len(pred) if pred else float("nan")
    recall = len(tp) / len(gt) if gt else float("nan")
    f1 = (2 * precision * recall / (precision + recall)) if (precision and recall and (precision + recall) > 0) else float("nan")

    with open(out_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["video_id", "n_pred", "n_gt", "n_tp", "n_fp", "n_fn", "precision", "recall", "f1", "iou_threshold"])
        w.writerow([video_id, len(pred), len(gt), len(tp), len(fp), len(fn), precision, recall, f1, iou_threshold])
        w.writerow([])
        w.writerow(["false_positive_intervals (predicted, no matching ground truth)"])
        for p in fp:
            w.writerow(p)
        w.writerow([])
        w.writerow(["false_negative_intervals (ground truth missed)"])
        for g in fn:
            w.writerow(g)

    print(f"{video_id}: P={precision:.3f} R={recall:.3f} F1={f1:.3f} (tp={len(tp)} fp={len(fp)} fn={len(fn)}) -> {out_path}")


if __name__ == "__main__":
    main()
