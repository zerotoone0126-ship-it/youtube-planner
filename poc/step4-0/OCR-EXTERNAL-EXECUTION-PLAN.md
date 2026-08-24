# OCR 최소 feasibility 검증 — 확정: 환경 제약으로 미검증 (2026-08-23)

## 이 세션에서 확인한 사실 (재현 가능한 테스트 결과)

- `tesseract --list-langs` → `eng`, `osd`만 존재. **한국어(`kor`) 언어팩 없음.**
- `apt-get install -y tesseract-ocr-kor` → `403 Forbidden` (`archive.ubuntu.com`) — 설치 자체가 막힘.
- `pip install --break-system-packages paddleocr` / `easyocr` 등 → pypi.org에서 신규 패키지 설치 전면 403(STT 문서와 동일한 제약, 재확인됨).
- 파일시스템 전체를 뒤져도 `kor.traineddata` 등 한국어 OCR 모델 파일 없음.

**결론**: 이 클라우드 세션 안에서는 한국어 burned-in 자막에 대한 실제 OCR 엔진 실행이 불가능합니다. Claude의 프레임 시각 판독은 스타일 후보 선정에만 썼고 OCR 정확도로 쓰지 않았습니다. **환경 제약으로 미검증**으로 확정합니다.

## 실행 재료는 이미 준비되어 있음 (이 세션이 만든 것)

기존 배치 분석에서 나온 콘택트시트를 다시 훑어 **실제로 한국어 텍스트가 확인된** 프레임만 6개 스타일에 맞춰 선별했습니다(사전에 장르만 보고 가정했던 것과 달리, sample_03/04/06/09 등은 실제로는 영어 자막 콘텐츠였음을 이번에 확인 — 아래 "확인 중 발견한 것" 참고).

| style_tag | frame_file | 출처 |
|---|---|---|
| general_bottom_white (일반 하단) | `results/ocr_minimal_benchmark/frames/style1_general_bottom_sample02_t7.7s.png` | sample_02, t=7.7s |
| color_emphasis (색상) | `results/ocr_minimal_benchmark/frames/style2_color_sample15_t6.2s.png` | sample_15, t=6.2s |
| bordered_shadow (테두리/그림자) | `results/ocr_minimal_benchmark/frames/style3_bordered_shadow_game01_t20s.png` | game_01, t=20s |
| large_emphasis (큰 강조) | `results/ocr_minimal_benchmark/frames/style4_large_emphasis_sample01_t4.7s.png` | sample_01, t=4.7s |
| top_position_plain (중앙/상단) | `results/ocr_minimal_benchmark/frames/style5_top_position_sample14_t13.2s.png` | sample_14, t=13.2s |
| variety_short (짧은 예능형) | `results/ocr_minimal_benchmark/frames/style6_variety_short_sample01_t23.4s.png` | sample_01, t=23.4s |

| 파일 | 내용 |
|---|---|
| `ground-truth-pending/ocr_minimal_benchmark_gt.csv` | ref_text가 비어 있는 ground truth 템플릿 (사람이 프레임을 보고 채워야 함) |
| `results/ocr_minimal_benchmark/prediction_template.csv` | 외부 환경에서 실제 OCR 엔진을 돌린 뒤 채워야 할 예측 결과 CSV 스키마 |
| `scripts/score_ocr.py` | 두 CSV를 받아 detection recall/CER/스타일별 실패사례를 계산 (합성 데이터로 정확성 검증 완료) |

## 확인 중 발견한 것 (스타일 선정 과정에서 나온 정직한 부산물)

6개 스타일을 소싱하려고 기존 콘택트시트를 다시 열어보니, 애초 배치 분석 단계에서 장르만 보고 "한국어 콘텐츠"로 가정했던 샘플 중 상당수가 실제로는 **영어 자막**이었습니다: sample_03(LoL 스트리밍, 영어 리액션 캡션), sample_04·sample_06(길거리 인터뷰, 영어 자막/더빙 채널), sample_09(레시피, 영어 캡션). 실제로 한국어 burned-in 자막이 명확히 확인된 것은 game_01, sample_01, sample_02, sample_14, sample_15뿐이었고, 위 6개 스타일 프레임은 전부 이 5개 영상에서만 뽑았습니다. 또한 `color_emphasis`(sample_15)와 `top_position_plain`(sample_14)은 순수하게 그 속성 하나만 있는 예시가 아니라 다른 스타일(테두리, 큰 글씨)과 섞여 있는 실제 사례라는 한계가 있습니다 — 완벽히 분리된 예시를 찾으려 콘텐츠를 더 뒤지는 대신, 실제로 확인 가능한 예시로 진행했습니다.

## 실제 OCR 엔진 실행 — 인터넷 제한 없는 환경(본인 PC 등)에서 할 것

### 방법 A: PaddleOCR (한국어 지원, 무료, 로컬)
```bash
pip install paddlepaddle paddleocr
python3 -c "
from paddleocr import PaddleOCR
ocr = PaddleOCR(lang='korean')
result = ocr.ocr('style1_general_bottom_sample02_t7.7s.png')
for line in result[0]:
    print(line[1])  # (text, confidence)
"
```
6개 프레임 전부에 대해 실행하고 아래 CSV로 정리:
```
frame_id,video_id,detected_text,confidence
style1_general_bottom,sample_02,<검출된 텍스트>,<confidence>
```
같은 프레임에서 여러 줄이 검출되면 위→아래 순서로 이어붙여 하나의 `detected_text`로 합쳐주세요(ground truth도 같은 규칙으로 작성됩니다).

### 방법 B: EasyOCR (대안)
```bash
pip install easyocr
python3 -c "
import easyocr
reader = easyocr.Reader(['ko','en'])
result = reader.readtext('style1_general_bottom_sample02_t7.7s.png')
for bbox, text, conf in result:
    print(text, conf)
"
```

### 방법 C: 상용 API (Google Cloud Vision, Naver Clova OCR)
API 키는 본인 환경에서만 보관하고 이 세션에는 전달하지 않습니다. 결과 CSV만 다시 업로드해주시면 됩니다.

## 채점 (결과 CSV를 받으면 이 세션에서 바로 실행)
```bash
python3 scripts/score_ocr.py \
  ground-truth-pending/ocr_minimal_benchmark_gt.csv \
  <외부에서 받은 prediction.csv>
```
출력: detection recall, 검출된 프레임의 평균 CER, 스타일별(6종) recall/CER 분해, 실패 사례(미검출 또는 CER>0.3) 목록. threshold나 판정 기준을 결과 보고 조정하지 않습니다.
