#!/usr/bin/env python3
"""
Score detected visual-change candidates against human-labeled categories.

Per user instruction (2026-08-23, revised): a pre-filled candidate list alone
cannot measure recall -- a detector-blind list can only ever confirm what the
detector already found (precision), never what it missed. Ground truth must
therefore let a human independently watch the WHOLE video and add any number
of real edits the detector's candidate list did not contain.

Ground truth CSV format (see ground-truth-pending/*_visual_change_gt_template.csv):
  video_id,timestamp_sec,mafd,source,label_type,labeler_id,notes
  - source == "detected_candidate": one of OUR MAFD-detected candidates
    (pre-filled timestamp+mafd). label_type is the human's classification of
    THAT candidate. Used for PRECISION.
  - source == "human_added_missed_edit": a real edit the human found during
    an independent full watch-through that was NOT in our candidate list.
    Any number of these may be added -- there is no fixed cap. Used for
    RECALL (these are false negatives by definition: the detector missed
    them entirely).
  - A row with label_type == CONFIRM_NO_ADDITIONAL_MISSED_CUTS: used ONLY to
    mark "I did the full independent review and found zero additional real
    edits beyond the candidate list." Do not use this row for anything else.

Recall is computed as:
    TP / (TP + FN)
  where TP = detected_candidate rows labeled as a real-edit type, and
        FN = human_added_missed_edit rows labeled as a real-edit type.
  i.e. denominator = (real edits among detector candidates) + (missed real
  edits the human found by independent review) -- exactly the user's spec.

Recall is only reported when the ground truth shows evidence of a genuine
independent full review: either the CONFIRM_NO_ADDITIONAL_MISSED_CUTS
sentinel is present (reviewed, found nothing extra), or at least one
human_added_missed_edit row exists (reviewed, found N extra). Absent both,
recall is reported as NOT MEASURED -- never assumed to be 1.0.

Categories:
  REAL EDIT (real-edit types): full_cut, partial_edit, transition
  NOT A REAL EDIT (false-positive-prone, non-edit types):
    game_visual_change, visual_effect_non_cut, overlay_change

Usage: python3 score_visual_change_categories.py <video_id> <cuts_csv> <gt_csv> [--tolerance 0.3]
"""
import sys
import csv
import argparse

REAL_EDIT_TYPES = {"full_cut", "partial_edit", "transition"}
NOISE_TYPES = {"game_visual_change", "visual_effect_non_cut", "overlay_change"}
SENTINEL = "CONFIRM_NO_ADDITIONAL_MISSED_CUTS"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video_id")
    ap.add_argument("cuts_csv")
    ap.add_argument("gt_csv")
    ap.add_argument("--tolerance", type=float, default=0.3)
    args = ap.parse_args()

    candidates = []
    with open(args.cuts_csv) as f:
        for r in csv.DictReader(f):
            if r["video_id"] != args.video_id:
                continue
            candidates.append(float(r["timestamp_sec"]))

    detected_rows = []      # (timestamp, label_type)
    missed_rows = []        # (timestamp, label_type)
    sentinel_present = False
    malformed = []

    with open(args.gt_csv) as f:
        for r in csv.DictReader(f):
            if r["video_id"] != args.video_id:
                continue
            if r.get("label_type") == SENTINEL:
                sentinel_present = True
                continue
            if not r.get("label_type"):
                continue  # unfilled row
            source = r.get("source", "").strip()
            ts = float(r["timestamp_sec"]) if r.get("timestamp_sec") else None
            if source == "detected_candidate":
                if ts is None:
                    malformed.append(r)
                    continue
                detected_rows.append((ts, r["label_type"]))
            elif source == "human_added_missed_edit":
                if ts is None:
                    malformed.append(r)
                    continue
                missed_rows.append((ts, r["label_type"]))
            else:
                malformed.append(r)

    if malformed:
        print(f"WARNING: {len(malformed)} GT rows have an unrecognized/missing `source` value "
              f"(must be 'detected_candidate' or 'human_added_missed_edit') -- ignored:")
        for r in malformed:
            print(f"    {dict(r)}")

    # sanity: detected_candidate rows should correspond to actual detector output
    def matches_a_candidate(ts):
        return any(abs(ts - c) <= args.tolerance for c in candidates)

    unverified_detected = [ts for ts, _ in detected_rows if not matches_a_candidate(ts)]
    if unverified_detected:
        print(f"WARNING: {len(unverified_detected)} rows marked source=detected_candidate don't match any "
              f"actual detector timestamp within {args.tolerance}s -- check for a copy/paste or timestamp error: "
              f"{[round(t,2) for t in unverified_detected]}")

    unlabeled_candidates = [c for c in candidates if not any(abs(c - ts) <= args.tolerance for ts, _ in detected_rows)]

    category_counts = {}
    for _, lbl in detected_rows:
        category_counts[lbl] = category_counts.get(lbl, 0) + 1

    tp = sum(1 for _, lbl in detected_rows if lbl in REAL_EDIT_TYPES)
    fp = sum(1 for _, lbl in detected_rows if lbl in NOISE_TYPES)
    fn = sum(1 for _, lbl in missed_rows if lbl in REAL_EDIT_TYPES)
    ignored_missed = [(ts, lbl) for ts, lbl in missed_rows if lbl not in REAL_EDIT_TYPES]

    print(f"# {args.video_id}: {len(candidates)} detected candidates, {len(detected_rows)} labeled as detected_candidate, "
          f"{len(missed_rows)} human_added_missed_edit rows")
    print(f"category breakdown among labeled detected_candidate rows: {category_counts}")
    if unlabeled_candidates:
        print(f"NOTE: {len(unlabeled_candidates)} detector candidates have no matching labeled row yet: "
              f"{[round(t,2) for t in unlabeled_candidates]} -- excluded from precision until labeled")

    precision = tp / (tp + fp) if (tp + fp) else None
    print(f"\nPRECISION: TP={tp} FP={fp} -> {f'{precision:.3f}' if precision is not None else 'N/A (no labeled candidates)'}")
    if fp:
        print("  false positives (detected but NOT a real edit):")
        for ts, lbl in detected_rows:
            if lbl in NOISE_TYPES:
                print(f"    t={ts:.2f}s -> labeled {lbl}")

    review_evidence = sentinel_present or len(missed_rows) > 0
    if review_evidence:
        recall = tp / (tp + fn) if (tp + fn) else None
        print(f"\nRECALL (independent full-review evidence present: "
              f"{'sentinel' if sentinel_present else ''}{' + ' if sentinel_present and missed_rows else ''}"
              f"{f'{len(missed_rows)} missed-edit rows' if missed_rows else ''}): "
              f"TP={tp} FN={fn} -> {f'{recall:.3f}' if recall is not None else 'N/A'}")
        if fn:
            print("  false negatives (real edits the detector missed entirely, found by independent review):")
            for ts, lbl in missed_rows:
                if lbl in REAL_EDIT_TYPES:
                    print(f"    t={ts:.2f}s -> {lbl}")
        if ignored_missed:
            print(f"  NOTE: {len(ignored_missed)} human_added_missed_edit rows labeled as a non-edit type "
                  f"(game_visual_change/visual_effect_non_cut/overlay_change) -- not counted as FN "
                  f"(a 'missed edit' that turned out not to be an edit): {ignored_missed}")
        if precision is not None and recall is not None and (precision + recall) > 0:
            f1 = 2 * precision * recall / (precision + recall)
            print(f"\nF1 = {f1:.3f}")
        else:
            print("\nF1 = N/A")
    else:
        print(f"\nRECALL: NOT MEASURED -- no {SENTINEL} row and no human_added_missed_edit rows found. "
              f"This means there is no evidence the human did an independent full watch-through looking for "
              f"missed cuts (only the pre-filled candidate list may have been graded). Do NOT assume recall=1.0.")
        print("F1 = N/A (recall unmeasured)")


if __name__ == "__main__":
    main()
