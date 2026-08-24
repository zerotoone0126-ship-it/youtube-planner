#!/usr/bin/env bash
# Single-pass FFmpeg signal extraction for STEP 4-0 PoC.
# Usage: ./run_ffmpeg_signals.sh <video_id> <input_path> <results_dir>
set -euo pipefail
VIDEO_ID="$1"
INPUT="$2"
OUTDIR="${3:-results}"
mkdir -p "$OUTDIR"

START=$(date +%s.%N)

ffmpeg -y -i "$INPUT" \
  -af "silencedetect=n=-30dB:d=0.5" \
  -vf "blackdetect=d=0.1:pic_th=0.98,freezedetect=n=-60dB:d=1,scdet=threshold=0:sc_pass=1,signalstats,metadata=print:file=${OUTDIR}/${VIDEO_ID}_metadata.log" \
  -f null - 2> "${OUTDIR}/${VIDEO_ID}_stderr.log"

END=$(date +%s.%N)
ELAPSED=$(echo "$END - $START" | bc)
echo "video_id,elapsed_sec" > "${OUTDIR}/${VIDEO_ID}_processing_time.csv"
echo "${VIDEO_ID},${ELAPSED}" >> "${OUTDIR}/${VIDEO_ID}_processing_time.csv"
echo "Done. stderr log: ${OUTDIR}/${VIDEO_ID}_stderr.log ; metadata log: ${OUTDIR}/${VIDEO_ID}_metadata.log ; time: ${ELAPSED}s"
