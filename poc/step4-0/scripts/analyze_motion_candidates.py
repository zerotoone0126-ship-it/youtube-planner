#!/usr/bin/env python3
"""
Compare CANDIDATE regional-motion signals for low-motion/static detection.

Background (2026-08-23): detect_low_motion.py uses whole-frame-average YDIF
(via ffmpeg signalstats) and flagged >93% of game_01 as low-motion -- an
implausible result. Root cause suspected: this video has a PIP/inset layout
(mostly-still main webcam shot + a smaller inset region where the actual
change happens), so real regional motion gets diluted into the whole-frame
average.

Per explicit user instruction, the old threshold was NOT retuned to hide this.
Instead this script computes several CANDIDATE signals side by side, applies
NO threshold, and makes NO claim about which is "correct" -- that requires
human-labeled static/low-motion ground truth, which does not exist yet.

Signals computed per consecutive sampled-frame pair:
  1. whole_frame_diff  - mean abs pixel diff, whole frame (baseline; same idea as the old YDIF approach)
  2. tile_max_diff     - frame split into an N x N grid; MAX per-tile mean abs diff
                         (single most-changed tile -- should NOT be diluted by a still main shot)
  3. tile_topk_mean    - mean of the top-K most-changed tiles (more robust to one noisy tile than max)
  4. optical_flow_mag  - mean magnitude of dense Farneback optical flow (motion, not just pixel diff)
  5. ssim_change       - 1 - global SSIM(prev, curr) (structural change, robust to brightness noise)

This is an exploratory PoC comparison, not a validated detector. Sampling is
done at a reduced fps (default 5) to keep an already-established
methodology-comparison PoC tractable; this is declared, not hidden.

Usage:
  python3 analyze_motion_candidates.py <video_id> <video_path> <out_csv> \
      [--fps 5] [--grid 4] [--topk 3] [--width 480] \
      [--anchor times.csv]   # optional: sec values, one per line, for qualitative cross-check

Anchor cross-check (optional): given a list of timestamps we already flagged
as scene-change candidates from a DIFFERENT method (MAFD-based cut detection),
report each signal's value AND percentile-rank at that timestamp. This checks
whether tile/optical-flow signals notice known content changes that the
whole-frame signal misses -- it is a sanity check against our own prior
candidates, NOT human ground truth, and must not be reported as accuracy.
"""
import sys
import csv
import argparse
import numpy as np
import cv2
from skimage.metrics import structural_similarity as ssim


def compute_signals(prev_gray, curr_gray, grid_n, top_k):
    diff = np.abs(curr_gray.astype(np.int16) - prev_gray.astype(np.int16)).astype(np.float64)
    whole_frame_diff = float(diff.mean())

    h, w = diff.shape
    tile_h = h // grid_n
    tile_w = w // grid_n
    tile_diffs = []
    for ty in range(grid_n):
        for tx in range(grid_n):
            y0, y1 = ty * tile_h, (ty + 1) * tile_h if ty < grid_n - 1 else h
            x0, x1 = tx * tile_w, (tx + 1) * tile_w if tx < grid_n - 1 else w
            tile_diffs.append(float(diff[y0:y1, x0:x1].mean()))
    tile_diffs = np.array(tile_diffs)
    tile_max_diff = float(tile_diffs.max())
    k = min(top_k, len(tile_diffs))
    tile_topk_mean = float(np.sort(tile_diffs)[-k:].mean())

    flow = cv2.calcOpticalFlowFarneback(
        prev_gray, curr_gray, None, 0.5, 3, 15, 3, 5, 1.2, 0
    )
    mag = np.sqrt(flow[..., 0] ** 2 + flow[..., 1] ** 2)
    optical_flow_mag = float(mag.mean())

    ssim_val = ssim(prev_gray, curr_gray, data_range=255)
    ssim_change = float(1.0 - ssim_val)

    return whole_frame_diff, tile_max_diff, tile_topk_mean, optical_flow_mag, ssim_change


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video_id")
    ap.add_argument("video_path")
    ap.add_argument("out_csv")
    ap.add_argument("--fps", type=float, default=5.0)
    ap.add_argument("--grid", type=int, default=4)
    ap.add_argument("--topk", type=int, default=3)
    ap.add_argument("--width", type=int, default=240)
    ap.add_argument("--anchor", type=str, default=None, help="optional file: one timestamp (sec) per line")
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.video_path)
    if not cap.isOpened():
        print(f"ERROR: could not open {args.video_path}", file=sys.stderr)
        sys.exit(1)

    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, round(src_fps / args.fps))

    rows = []
    prev_gray = None
    prev_time = None
    frame_idx = 0
    sampled_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % step == 0:
            t = frame_idx / src_fps
            h, w = frame.shape[:2]
            new_h = int(h * (args.width / w))
            small = cv2.resize(frame, (args.width, new_h), interpolation=cv2.INTER_AREA)
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            if prev_gray is not None:
                sigs = compute_signals(prev_gray, gray, args.grid, args.topk)
                rows.append((args.video_id, sampled_idx, round(t, 3), *[round(s, 4) for s in sigs]))
            prev_gray = gray
            prev_time = t
            sampled_idx += 1
        frame_idx += 1
    cap.release()

    with open(args.out_csv, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["video_id", "sample_idx", "time_sec", "whole_frame_diff", "tile_max_diff",
                     "tile_topk_mean", "optical_flow_mag", "ssim_change"])
        w.writerows(rows)

    cols = ["whole_frame_diff", "tile_max_diff", "tile_topk_mean", "optical_flow_mag", "ssim_change"]
    arr = {c: np.array([r[2 + i] for r in rows]) for i, c in enumerate(cols)}
    print(f"# {args.video_id}: {len(rows)} sampled frame-pairs at ~{args.fps}fps (source {src_fps:.1f}fps, "
          f"grid={args.grid}x{args.grid}, topk={args.topk}, width={args.width})")
    print("signal,p10,p25,p50,p75,p90,p95,p99,max")
    for c in cols:
        pct = np.percentile(arr[c], [10, 25, 50, 75, 90, 95, 99])
        print(f"{c}," + ",".join(f"{v:.4f}" for v in pct) + f",{arr[c].max():.4f}")

    if args.anchor:
        with open(args.anchor) as f:
            anchors = [float(x.strip()) for x in f if x.strip()]
        times = np.array([r[2] for r in rows])
        print("\n# Anchor cross-check (qualitative only -- our own prior MAFD-based cut candidates, NOT human ground truth)")
        print("anchor_sec,nearest_sample_sec," + ",".join(f"{c}_value,{c}_percentile_rank" for c in cols))
        for a in anchors:
            idx = int(np.argmin(np.abs(times - a)))
            line = [f"{a:.2f}", f"{times[idx]:.2f}"]
            for i, c in enumerate(cols):
                val = rows[idx][2 + i]
                rank = float((arr[c] < val).mean() * 100)
                line.append(f"{val:.4f}")
                line.append(f"{rank:.1f}")
            print(",".join(line))


if __name__ == "__main__":
    main()
