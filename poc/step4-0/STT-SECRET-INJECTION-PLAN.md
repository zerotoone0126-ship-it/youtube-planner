# STT 최소 feasibility 검증 — 확정: 환경 제약으로 미검증 (2026-08-23)

## 이 세션에서 확인한 사실 (재현 가능한 테스트 결과)

- `pip install --break-system-packages faster-whisper` → `403 Client Error: Forbidden for url: https://pypi.org/simple/faster-whisper/`
- 대조군으로 아무 관계없는 신규 패키지(`cowsay`)도 동일하게 `403` — 즉 특정 패키지 차단이 아니라 **이 세션에서는 새 pip 패키지 설치 자체가 전면 차단**되어 있음(이미 설치되어 캐시된 패키지만 사용 가능).
- `python3 -c "import whisper"` / `import vosk` / `import speech_recognition` → 전부 `ModuleNotFoundError` (오프라인 ASR 엔진 없음).
- huggingface.co 등 모델 가중치 호스트 접근 불가(기존에 확인된 제약, 재확인 불필요).

**결론**: 이 클라우드 세션 안에서는 어떤 실제 STT 엔진도 실행할 수 없습니다. 억지로 결과를 만들지 않고 **환경 제약으로 미검증**으로 확정합니다. API 키는 이번에도 채팅으로 요구하지 않았습니다.

## 실행 재료는 이미 준비되어 있음 (이 세션이 만든 것)

| 파일 | 내용 |
|---|---|
| `results/stt_minimal_benchmark/clips/game_01_seg1_0.00-15.00s.mp4` | game_01 0:00~0:15 (한국어 게임 커멘터리, 자막으로 한국어 음성 확인됨) |
| `results/stt_minimal_benchmark/clips/game_01_seg2_90.00-105.00s.mp4` | game_01 1:30~1:45 |
| `results/stt_minimal_benchmark/clips/sample_02_seg1_0.00-15.00s.mp4` | sample_02 0:00~0:15 (한국어 마인크래프트 협동 커멘터리) |
| `ground-truth-pending/stt_minimal_benchmark_gt.csv` | ref_text가 비어 있는 ground truth 템플릿 (사람이 클립을 듣고 채워야 함) |
| `results/stt_minimal_benchmark/prediction_template.csv` | 외부 환경에서 실제 STT 엔진을 돌린 뒤 채워야 할 예측 결과 CSV 스키마 |
| `scripts/score_stt.py` | 두 CSV를 받아 CER/WER/timestamp MAE/실패사례를 계산 (합성 데이터로 정확성 검증 완료) |

두 세그먼트를 game_01에서, 한 세그먼트를 sample_02에서 뽑은 이유: 시작 구간(0:00~0:15)은 임의 선택 규칙(영상마다 "처음 15초")으로 cherry-pick 없이 고정했고, game_01은 179초로 길어 중간 구간(1:30~1:45)도 하나 더 추가해 서로 다른 발화 맥락을 포함시켰습니다.

## 사람이 지금 할 일 (이 세션 밖에서, 아무 때나 가능)

`ground-truth-pending/stt_minimal_benchmark_gt.csv`의 `ref_text` 열을 위 3개 클립을 직접 들으면서 실제로 말한 내용 그대로 채워주시면 됩니다(Claude는 오디오를 들을 수 없어 이 항목을 대신 채우지 않습니다).

## 실제 STT 엔진 실행 — 인터넷 제한 없는 환경(본인 PC 등)에서 할 것

### 방법 A: OpenAI Whisper (로컬, 오프라인 실행 가능, 무료)
```bash
pip install openai-whisper
whisper game_01_seg1_0.00-15.00s.mp4 --model medium --language Korean \
  --word_timestamps True --output_format json --output_dir out/
```
JSON 출력의 `segments[].text`, `segments[].start`, `segments[].end`를 아래 CSV로 변환:
```
video_id,segment_id,pred_text,pred_start_sec,pred_end_sec,model_name,processing_time_sec
game_01,seg1,<segments[0].text 이어붙인 것>,<start>,<end>,whisper-medium,<실제 걸린 시간(초)>
```

### 방법 B: faster-whisper (더 빠름, 로컬)
```bash
pip install faster-whisper
python3 -c "
from faster_whisper import WhisperModel
import time
model = WhisperModel('medium', device='cpu')
t0 = time.time()
segments, info = model.transcribe('game_01_seg1_0.00-15.00s.mp4', language='ko', word_timestamps=True)
for s in segments:
    print(s.start, s.end, s.text)
print('elapsed:', time.time() - t0)
"
```

### 방법 C: 상용 API (Groq Whisper API, Google STT 등)
API 키는 본인 환경에서만 보관(`.env`, git에 커밋되지 않도록 `.gitignore` 처리)하고, 이 세션에는 키 값 자체를 전달하지 않습니다. 결과 CSV만 이 세션에 다시 업로드해주시면 채점을 진행합니다.

## 채점 (결과 CSV를 받으면 이 세션에서 바로 실행)
```bash
python3 scripts/score_stt.py \
  ground-truth-pending/stt_minimal_benchmark_gt.csv \
  <외부에서 받은 prediction.csv>
```
출력: 세그먼트별 CER/WER/timestamp MAE, 평균, CER>0.3인 실패 사례 목록, (prediction CSV에 `processing_time_sec`가 있으면) 처리시간까지 함께 보고됩니다. threshold나 판정 기준을 결과 보고 조정하지 않습니다 — 실행 결과 그대로 보고합니다.
