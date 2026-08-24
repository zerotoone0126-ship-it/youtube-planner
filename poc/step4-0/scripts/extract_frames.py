#!/usr/bin/env python3
"""Extract sampled frames for burned-in subtitle review.

Since this sandbox cannot reach external OCR/model-weight hosts (see README.md),
frames are extracted here and then read directly by Claude (multimodal) rather
than run through PaddleOCR/EasyOCR/a commercial OCR API. This script only does
the (network-free) FFmpeg extraction + a cheap consecutive-frame-difference
prefilter so we don't have to manually look at every single sampled frame.

Usage: python3 extract_frames.py <video_id> <video_path> <out_dir> [fps] [diff_threshold]
Requires: ffmpeg on PATH, Pillow (pip3 install --break-system-packages Pillow)
"""
import sys
import os
import subprocess
import csv


def extract(video_path, out_dir, fps):
    os.makedirs(out_dir, exist_ok=True)
    pattern = os.path.join(out_dir, "frame_%06d.png")
    cmd = [
        "ffmpeg", "-y", "-i", video_path,
        "-vf", f"fps={fps}",
        pattern,
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    files = sorted(f for f in os.listdir(out_dir) if f.startswith("frame_") and f.endswith(".png"))
    return files


def frame_diff_prefilter(out_dir, files, diff_threshold):
    """Return the subset of frame filenames that differ enough from the previous
    kept frame to be worth OCR review (cheap dedup, per research-video-analysis-v1-feasibility.md #1)."""
    try:
        from PIL import Image
        import numpy as np
    except ImportError:
        print("Pillow/numpy not available -- skipping prefilter, keeping all frames.", file=sys.stderr)
        return files

    kept = []
    prev_arr = None
    for fn in files:
        path = os.path.join(out_dir, fn)
        img = Image.open(path).convert("L").resize((160, 90))
        arr = np.asarray(img, dtype=float)
        if prev_arr is None or float(abs(arr - prev_arr).mean()) > diff_threshold:
            kept.append(fn)
            prev_arr = arr
    return kept


def main():
    video_id = sys.argv[1]
    video_path = sys.argv[2]
    out_dir = sys.argv[3]
    fps = float(sys.argv[4]) if len(sys.argv) > 4 else 2.0
    diff_threshold = float(sys.argv[5]) if len(sys.argv) > 5 else 3.0

    files = extract(video_path, out_dir, fps)
    kept = frame_diff_prefilter(out_dir, files, diff_threshold)

    manifest_path = os.path.join(out_dir, f"{video_id}_frame_manifest.csv")
    with open(manifest_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["video_id", "frame_file", "approx_time_sec", "kept_after_prefilter"])
        for i, fn in enumerate(files):
            t = i / fps
            w.writerow([video_id, fn, round(t, 2), fn in kept])

    print(f"Extracted {len(files)} frames at {fps}fps, {len(kept)} kept after prefilter -> {manifest_path}")
    print("Next: Claude reads the kept frames directly (Read tool) to transcribe any burned-in subtitle text and note style.")


if __name__ == "__main__":
    main()
