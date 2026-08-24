#!/usr/bin/env bash
# STEP 4-0 batch pipeline for the 16-sample batch (2026-08-23).
# Runs the full existing toolchain per video: ffmpeg signals -> events/continuous
# parsing -> gap-based cut threshold -> cut candidates -> low-motion baseline
# (fixed params, same as game_01's known-failure method) -> motion candidate
# signals (tile/optical-flow/ssim) -> audio candidates -> contact sheet.
# No threshold is tuned per video beyond the documented, uniformly-applied
# gap-detection rule in pick_threshold_by_gap.py.
#
# Usage: ./run_batch_pipeline.sh sample_01 sample_02 ...
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="$(cd "$SCRIPT_DIR/.." && pwd)"
VIDEO_DIR="$BASE/videos/batch"
RESULTS_BASE="$BASE/results/batch"

for VIDEO_ID in "$@"; do
  echo "=================== $VIDEO_ID ==================="
  OUTDIR="$RESULTS_BASE/$VIDEO_ID"
  mkdir -p "$OUTDIR"
  INPUT="$VIDEO_DIR/${VIDEO_ID}.mp4"
  if [ ! -f "$INPUT" ]; then
    echo "SKIP $VIDEO_ID: input not found at $INPUT"
    continue
  fi

  bash "$SCRIPT_DIR/run_ffmpeg_signals_batch.sh" "$VIDEO_ID" "$INPUT" "$OUTDIR"

  python3 "$SCRIPT_DIR/parse_events.py" "$VIDEO_ID" "$OUTDIR/${VIDEO_ID}_stderr.log" "$OUTDIR/${VIDEO_ID}_events.csv"
  python3 "$SCRIPT_DIR/parse_continuous_signals.py" "$VIDEO_ID" "$OUTDIR/${VIDEO_ID}_metadata.log" "$OUTDIR/${VIDEO_ID}_continuous.csv"

  THRESH_JSON="$OUTDIR/${VIDEO_ID}_threshold.json"
  THRESH_LINE=$(python3 "$SCRIPT_DIR/pick_threshold_by_gap.py" "$VIDEO_ID" "$OUTDIR/${VIDEO_ID}_continuous.csv" --out-json "$THRESH_JSON" | tail -1)
  THRESHOLD="${THRESH_LINE#THRESHOLD=}"
  echo "chosen cut threshold: $THRESHOLD"

  python3 "$SCRIPT_DIR/detect_cuts.py" "$VIDEO_ID" "$OUTDIR/${VIDEO_ID}_continuous.csv" "$OUTDIR/${VIDEO_ID}_cuts.csv" "$THRESHOLD" 2

  python3 "$SCRIPT_DIR/detect_low_motion.py" "$VIDEO_ID" "$OUTDIR/${VIDEO_ID}_continuous.csv" "$OUTDIR/${VIDEO_ID}_events.csv" "$OUTDIR/${VIDEO_ID}_lowmotion_baseline.csv"

  python3 "$SCRIPT_DIR/analyze_motion_candidates.py" "$VIDEO_ID" "$INPUT" "$OUTDIR/${VIDEO_ID}_motion_signals.csv" --fps 5 --grid 4 --topk 3 > "$OUTDIR/${VIDEO_ID}_motion_summary.txt" 2>&1

  python3 "$SCRIPT_DIR/parse_audio_loudness.py" "$VIDEO_ID" "$OUTDIR/${VIDEO_ID}_audio_metadata.log" "$OUTDIR/${VIDEO_ID}_audio_candidates.csv" --events-csv "$OUTDIR/${VIDEO_ID}_events.csv" --top-pct 1.0 --merge-gap 0.3

  grep -E "mean_volume|max_volume" "$OUTDIR/${VIDEO_ID}_stderr.log" | tail -2 > "$OUTDIR/${VIDEO_ID}_volumedetect.txt" || true

  CAND_TIMES=$(python3 -c "
import csv
rows=[]
with open('$OUTDIR/${VIDEO_ID}_cuts.csv') as f:
    for r in csv.DictReader(f):
        rows.append((float(r['mafd']), float(r['timestamp_sec'])))
rows.sort(reverse=True)
print(','.join(f'{t:.2f}' for _,t in rows[:6]))
")
  python3 "$SCRIPT_DIR/build_contact_sheet.py" "$INPUT" "$OUTDIR/${VIDEO_ID}_contact_sheet.png" --candidates "$CAND_TIMES" --n-candidates 6 --n-samples 6

  echo "$VIDEO_ID done."
done
