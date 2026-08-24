#!/usr/bin/env python3
"""
Pick a per-video scdet/MAFD cut-candidate threshold using a DATA-DRIVEN,
UNIFORMLY-APPLIED rule -- not manual eyeballing per video.

Background: for story_01 we manually noticed 4 MAFD values (32-66) clearly
separated from the rest of the distribution by a big gap, and picked the
threshold in that gap. For game_01 no such gap existed, so we picked
threshold=20 by inspection. That manual process does not scale to 16 videos
and risks looking like "whatever gets a nice number of candidates" even when
it isn't. This script automates the SAME logic with one fixed rule applied
identically to every video:

  1. Collect local-maximum MAFD peaks at a very permissive floor (>=5, using
     the same local-max/persistence logic as detect_cuts.py).
  2. Sort descending. Compute the relative drop between each consecutive
     pair: (v[i] - v[i+1]) / v[i].
  3. If the single largest relative drop is >= GAP_RATIO_THRESHOLD (0.25,
     i.e. a >=25% drop), that is a "clean outlier gap" (story_01-like) --
     set the cut threshold at the midpoint of that gap.
  4. Otherwise there is no clean gap (game_01-like, smooth continuum) -- fall
     back to a FIXED percentile (P85) of the candidate distribution, applied
     the same way to every such video. This is a documented uniform default,
     not a per-video choice made to produce a particular result.

Every choice (gap found vs fallback, exact threshold, evidence) is printed
and saved so it can be checked against "did we tune per video to look good".

Usage: python3 pick_threshold_by_gap.py <video_id> <continuous_csv> [--floor 5] [--persist 2] [--gap-ratio 0.25] [--fallback-pct 85]
"""
import sys
import csv
import argparse
import json


def local_maxima(rows, floor, persist):
    candidates = []
    for i, r in enumerate(rows):
        if r["mafd"] < floor:
            continue
        lo, hi = max(0, i - persist), min(len(rows), i + persist + 1)
        window = rows[lo:hi]
        if r["mafd"] >= max(w["mafd"] for w in window):
            candidates.append(r)
    return candidates


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video_id")
    ap.add_argument("continuous_csv")
    ap.add_argument("--floor", type=float, default=5.0)
    ap.add_argument("--persist", type=int, default=2)
    ap.add_argument("--gap-ratio", type=float, default=0.25)
    ap.add_argument("--fallback-pct", type=float, default=85.0)
    ap.add_argument("--search-top-k", type=int, default=20,
                     help="only look for the outlier gap among the top-K highest candidates -- "
                          "a big relative drop deep in the tail (e.g. between the 40th and 41st "
                          "smallest values) is noise, not the story_01-style 'a few real cuts stand "
                          "out from everything else' pattern this heuristic is meant to find")
    ap.add_argument("--out-json", default=None)
    args = ap.parse_args()

    rows = []
    with open(args.continuous_csv) as f:
        for row in csv.DictReader(f):
            try:
                mafd = float(row["scd_mafd"]) if row["scd_mafd"] not in ("", None) else 0.0
            except ValueError:
                mafd = 0.0
            rows.append({"pts_time": float(row["pts_time"]), "mafd": mafd})

    cands = local_maxima(rows, args.floor, args.persist)
    values = sorted((c["mafd"] for c in cands), reverse=True)

    result = {"video_id": args.video_id, "n_candidates_at_floor": len(values), "floor": args.floor}

    if len(values) < 4:
        result.update({"method": "too_few_candidates_fallback", "threshold": args.floor,
                        "reason": f"only {len(values)} candidates found at floor={args.floor}; using floor itself as threshold"})
    else:
        gaps = []
        for i in range(len(values) - 1):
            ratio = (values[i] - values[i + 1]) / values[i] if values[i] > 0 else 0
            gaps.append(ratio)
        search_range = range(min(args.search_top_k, len(gaps)))
        best_i = max(search_range, key=lambda i: gaps[i])
        best_ratio = gaps[best_i]
        if best_ratio >= args.gap_ratio:
            threshold = (values[best_i] + values[best_i + 1]) / 2
            result.update({"method": "clean_gap", "threshold": threshold, "gap_ratio": best_ratio,
                           "gap_between": [values[best_i], values[best_i + 1]],
                           "reason": f"largest relative drop {best_ratio:.2%} >= {args.gap_ratio:.0%} threshold -- clean outlier separation found"})
        else:
            import numpy as np
            threshold = float(np.percentile(values, args.fallback_pct))
            result.update({"method": "no_clean_gap_fallback_percentile", "threshold": threshold,
                           "largest_gap_ratio_found": best_ratio, "fallback_percentile": args.fallback_pct,
                           "reason": f"largest relative drop {best_ratio:.2%} < {args.gap_ratio:.0%} -- no clean outlier gap; "
                                     f"used fixed P{args.fallback_pct} of candidate distribution (same rule applied to every such video)"})

    print(json.dumps(result, indent=2, ensure_ascii=False))
    if args.out_json:
        with open(args.out_json, "w") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
    # also print just the threshold on the last line for easy shell capture
    print(f"THRESHOLD={result['threshold']:.4f}")


if __name__ == "__main__":
    main()
