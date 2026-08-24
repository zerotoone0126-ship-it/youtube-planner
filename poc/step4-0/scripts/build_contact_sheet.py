#!/usr/bin/env python3
"""
Build one annotated contact-sheet image per video for Claude's VISUAL
PRELIMINARY review (never a substitute for real OCR / human ground truth --
see OCR-EXTERNAL-EXECUTION-PLAN.md and the "no fabricated ground truth"
principle). Two sections:

  1. Cut-candidate pairs: for up to N candidate timestamps (highest MAFD
     first), a before/after frame pair (t-0.4s / t+0.4s) -- used to visually
     judge full_cut / partial_edit / game_visual_change / transition /
     visual_effect_non_cut / needs_human_review.
  2. Evenly-spaced sampling frames across the whole video -- used to spot
     burned-in subtitle presence/style and get a rough sense of genre/layout
     (e.g. PIP/inset), NOT for OCR accuracy.

Usage:
  python3 build_contact_sheet.py <video_path> <out_png> \
      --candidates t1,t2,t3,... --n-candidates 6 --n-samples 6
"""
import sys
import argparse
import subprocess
import tempfile
import os
from PIL import Image, ImageDraw


def extract_frame(video_path, t, out_path):
    t = max(0.0, t)
    subprocess.run(
        ["ffmpeg", "-y", "-ss", f"{t:.3f}", "-i", video_path, "-frames:v", "1", "-q:v", "3", out_path],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False
    )
    return os.path.exists(out_path) and os.path.getsize(out_path) > 0


def get_duration(video_path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video_path],
        capture_output=True, text=True
    )
    return float(out.stdout.strip())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video_path")
    ap.add_argument("out_png")
    ap.add_argument("--candidates", default="", help="comma-separated candidate timestamps, highest-priority first")
    ap.add_argument("--n-candidates", type=int, default=6)
    ap.add_argument("--n-samples", type=int, default=6)
    ap.add_argument("--thumb-width", type=int, default=220)
    args = ap.parse_args()

    duration = get_duration(args.video_path)
    cand_times = [float(x) for x in args.candidates.split(",") if x.strip()][:args.n_candidates]
    sample_times = [duration * (i + 0.5) / args.n_samples for i in range(args.n_samples)]

    with tempfile.TemporaryDirectory() as tmp:
        thumbs = []  # (label, PIL.Image)

        for t in cand_times:
            for tag, tt in [("before", t - 0.4), ("after", t + 0.4)]:
                p = os.path.join(tmp, f"cand_{t:.2f}_{tag}.jpg")
                if extract_frame(args.video_path, tt, p):
                    img = Image.open(p)
                    ratio = args.thumb_width / img.width
                    img = img.resize((args.thumb_width, int(img.height * ratio)))
                    thumbs.append((f"cut@{t:.2f}s {tag}", img))

        sample_thumbs = []
        for t in sample_times:
            p = os.path.join(tmp, f"sample_{t:.2f}.jpg")
            if extract_frame(args.video_path, t, p):
                img = Image.open(p)
                ratio = args.thumb_width / img.width
                img = img.resize((args.thumb_width, int(img.height * ratio)))
                sample_thumbs.append((f"t={t:.1f}s", img))

        if not thumbs and not sample_thumbs:
            print("ERROR: no frames extracted", file=sys.stderr)
            sys.exit(1)

        cols_cand = 4
        cols_sample = 4
        label_h = 20
        row_h = (thumbs[0][1].height if thumbs else sample_thumbs[0][1].height) + label_h
        w = args.thumb_width * cols_cand

        rows_cand = -(-len(thumbs) // cols_cand) if thumbs else 0
        rows_sample = -(-len(sample_thumbs) // cols_sample) if sample_thumbs else 0
        header_h = 24
        total_h = header_h + rows_cand * row_h + (header_h if sample_thumbs else 0) + rows_sample * row_h + 10

        canvas = Image.new("RGB", (w, total_h), "white")
        draw = ImageDraw.Draw(canvas)
        y = 0
        draw.text((5, y + 4), "CUT CANDIDATES (before/after, sorted by MAFD)", fill="black")
        y += header_h
        for i, (label, img) in enumerate(thumbs):
            col, row = i % cols_cand, i // cols_cand
            x = col * args.thumb_width
            yy = y + row * row_h
            canvas.paste(img, (x, yy + label_h))
            draw.text((x + 2, yy + 2), label, fill="red")
        y += rows_cand * row_h

        if sample_thumbs:
            draw.text((5, y + 4), "EVENLY-SPACED SAMPLES (subtitle style / genre / layout scan)", fill="black")
            y += header_h
            for i, (label, img) in enumerate(sample_thumbs):
                col, row = i % cols_sample, i // cols_sample
                x = col * args.thumb_width
                yy = y + row * row_h
                canvas.paste(img, (x, yy + label_h))
                draw.text((x + 2, yy + 2), label, fill="blue")

        canvas.save(args.out_png)
        print(f"saved {args.out_png} ({w}x{total_h}, {len(thumbs)} cand thumbs, {len(sample_thumbs)} sample thumbs)")


if __name__ == "__main__":
    main()
