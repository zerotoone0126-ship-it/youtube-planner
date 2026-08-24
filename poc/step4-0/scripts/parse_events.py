#!/usr/bin/env python3
"""Parse ffmpeg stderr log for silencedetect/blackdetect/freezedetect events.
Usage: python3 parse_events.py <video_id> <stderr_log_path> <out_csv_path>
"""
import re
import sys
import csv


def parse_events(log_text):
    events = {"silence": [], "black": [], "freeze": []}

    for m in re.finditer(r"silence_start:\s*([\d.]+)", log_text):
        events["silence"].append({"start": float(m.group(1)), "end": None})
    ends = re.findall(r"silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)", log_text)
    for i, (end, dur) in enumerate(ends):
        if i < len(events["silence"]):
            events["silence"][i]["end"] = float(end)

    for m in re.finditer(r"black_start:(\S+)\s+black_end:(\S+)\s+black_duration:(\S+)", log_text):
        events["black"].append({"start": float(m.group(1)), "end": float(m.group(2))})

    starts = [float(x) for x in re.findall(r"freeze_start:\s*([\d.]+)", log_text)]
    ends = [float(x) for x in re.findall(r"freeze_end:\s*([\d.]+)", log_text)]
    for i in range(min(len(starts), len(ends))):
        events["freeze"].append({"start": starts[i], "end": ends[i]})

    return events


def main():
    video_id, log_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    with open(log_path, "r", errors="replace") as f:
        text = f.read()
    events = parse_events(text)
    with open(out_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["video_id", "event_type", "start_sec", "end_sec"])
        for etype, items in events.items():
            for it in items:
                w.writerow([video_id, etype, it["start"], it["end"]])
    total = sum(len(v) for v in events.values())
    print(f"Parsed {total} events -> {out_path}")


if __name__ == "__main__":
    main()
