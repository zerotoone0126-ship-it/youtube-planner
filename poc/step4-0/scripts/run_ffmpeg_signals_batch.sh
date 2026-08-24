#!/usr/bin/env bash
# Batch-efficient combined FFmpeg signal extraction for STEP 4-0 (16-video batch).
# Same filters as run_ffmpeg_signals.sh (video) + the separate ebur128 pass used
# for game_01 (audio) + volumedetect, all combined into ONE decode pass per video
# to keep total processing time reasonable across many videos. Output content is
# equivalent to running the two original scripts separately.
# Usage: ./run_ffmpeg_signals_batch.sh <video_id> <input_path> <results_dir>
set -euo pipefail
VIDEO_ID="$1"
INPUT="$2"
OUTDIR="${3:-results}"
mkdir -p "$OUTDIR"

START=$(date +%s.%N)

ffmpeg -y -i "$INPUT" \
  -af "silencedetect=n=-30dB:d=0.5,volumedetect,ebur128=metadata=1,ametadata=print:file=${OUTDIR}/${VIDEO_ID}_audio_metadata.log" \
  -vf "blackdetect=d=0.1:pic_th=0.98,freezedetect=n=-60dB:d=1,scdet=threshold=0:sc_pass=1,signalstats,metadata=print:file=${OUTDIR}/${VIDEO_ID}_metadata.log" \
  -f null - 2> "${OUTDIR}/${VIDEO_ID}_stderr.log"

END=$(date +%s.%N)
ELAPSED=$(echo "$END - $START" | bc)
echo "video_id,elapsed_sec" > "${OUTDIR}/${VIDEO_ID}_processing_time.csv"
echo "${VIDEO_ID},${ELAPSED}" >> "${OUTDIR}/${VIDEO_ID}_processing_time.csv"
echo "Done ${VIDEO_ID}: ${ELAPSED}s"
