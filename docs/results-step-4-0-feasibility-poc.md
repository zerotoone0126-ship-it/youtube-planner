# docs/results-step-4-0-feasibility-poc.md — STEP 4-0 종합 결과 (중간)

**이 문서는 STEP 4-0의 최종 승인용 종합 결과입니다.** production 코드, DB migration, STEP 4-1 작업은 아직 시작하지 않았습니다. 아래 기술별 판정은 실제 사람 ground truth가 도착한 항목에 한해서만 내려지며, 없는 항목은 임의로 F1을 만들지 않고 `검증 부족`으로 유지합니다. Claude의 시각적 판단(콘택트시트 검토, 장르/스타일 추정 등)은 어디에도 정식 ground truth로 쓰지 않았습니다.

## 1. 지금까지 사용한 실제 영상 수

**17개** 실사용자 영상(사용자 본인 제작/소유 영상만 사용, 다운로드한 유튜브 영상 없음):

- story_01 (44.2초, 세로, 편집됨, 무음)
- game_01 (179.2초, 세로, 게임 리액션/해설형, 오디오 있음)
- 배치 15개(sample_01~15, 21.5~182.7초, 세로, 오디오 전부 있음)

`sample_16`(manifest상 21.5초)은 두 번 언급됐지만 실제 파일이 세션에 업로드되지 않아 제외했습니다(7절 참고). smoke_test용 합성 클립은 실측치에 포함하지 않았습니다.

## 2. 장르/편집 스타일 범위

| 그룹 | 샘플 | 특징 |
|---|---|---|
| 게임 + PIP/얼굴캠 | game_01, sample_01, 02, 03 | 웹캠/아바타 인서트 + 게임 화면, 라이브채팅/도네이션 오버레이 포함 |
| 게임, PIP 없음 | sample_11, 13, 14, 15 | 순수 게임 POV, 스킬이펙트/구간전환/UI배너 존재 |
| 길거리 인터뷰, 단일연속샷 | sample_04, 05 | 편집 거의 없음, 다양한 자막 스타일 |
| 길거리 인터뷰, 교차편집 컴필레이션 | sample_06 | 여러 인터뷰이를 번갈아 편집 |
| 브이로그/몽타주 점프컷 | sample_07, 08 | 빠른 장면 전환, 삽입영상(영상-속-영상) 존재 |
| 레시피 숏폼 | sample_09, 10 | 오버헤드 POV 단일컷 / 2카메라 A·B 교차편집 |
| 강의/토크, 단일연속샷 | sample_12 | 그린스크린, 거의 무편집 |
| 스토리텔링/썰 | story_01 | 세로 편집영상, 무음 |

## 3. 처리 시간

- **2-pass 방식**(story_01, game_01 — 오디오/비디오 필터를 별도 ffmpeg 패스로 실행): 21.7%, 20.6%
- **1-pass 결합 방식**(배치 15개 — 오디오+비디오 필터를 하나의 ffmpeg 패스로 결합): 평균 **17.4%**, 중앙값 **17.5%**, 범위 15.2~20.0%
- 두 방식의 차이는 실제 처리 효율 차이입니다(같은 신호를 다르게 측정한 게 아님) — **필터를 하나의 패스로 합치면 처리 비용을 더 줄일 수 있다**는 실용적 결론을 얻었습니다. STEP 4-3 인프라 설계 시 기본값으로 반영 검토 대상입니다.

## 4. Scene/visual-change 결과

**측정 방법**: `scdet=threshold=0:sc_pass=1`로 raw MAFD를 유지하고, `pick_threshold_by_gap.py`(모든 영상에 동일 규칙 적용 — outlier gap 있으면 그 지점, 없으면 고정 P85 fallback)로 threshold를 데이터 기반으로 선택했습니다. 영상마다 눈대중으로 다르게 고르지 않았습니다.

**정성적 신호**: 무편집 원본(sample_13: 후보 1개)과 고편집 하이라이트(sample_15: 후보 35개)에서 후보 수가 실제 편집 밀도와 일치하는 방향으로 나와, 방법 자체의 face validity는 있어 보입니다. 다만 이건 정식 정확도가 아닙니다.

**6종 분류 체계 확정**(2026-08-23, 장르 공통으로 확장 — `plan-step-4-0-feasibility-poc.md` 0-1절): `full_cut`/`partial_edit`/`transition`(실제 편집) vs `game_visual_change`/`visual_effect_non_cut`/`overlay_change`(편집 아님, 오탐 후보).

**정식 검증 완료(2026-08-23)**: `sample_05`(overlay_change 발견 사례), `sample_06`(positive-control), `sample_14`(game_visual_change 경계) 3개 모두 (1) detector candidate에 대한 사람의 6종 분류 라벨링, (2) 전체 영상을 처음부터 끝까지 본 독립 검수를 통한 놓친 실제 편집 추가(`source=human_added_missed_edit`) 또는 `CONFIRM_NO_ADDITIONAL_MISSED_CUTS` 명시적 확정을 모두 마쳤습니다. threshold는 배치 단계에서 이미 고정된 값을 그대로 사용했고, 결과를 보고 재조정하지 않았습니다.

| 영상 | TP | FP | FN | Precision | Recall | F1 | 비고 |
|---|---|---|---|---|---|---|---|
| sample_05 | 8 | 0 | 36 | 1.000 | 0.182 | 0.308 | 44개 실제 컷 중 8개만 탐지 — 원인 분석 아래 |
| sample_06 | 3 | 0 | 0 | 1.000 | 1.000 | 1.000 | positive-control, 완전 일치 |
| sample_14 | 3 | 1 | 3 | 0.750 | 0.500 | 0.600 | FP 1건(game_visual_change 오탐), FN 3건(놓친 실제 컷) |
| **합산(pooled/micro, TP·FP·FN 전체 합산)** | 14 | 1 | 39 | **0.933** | **0.264** | **0.412** | sample_05의 FN 36건이 합산 수치를 지배함 |
| 참고: macro(영상별 F1의 단순평균) | — | — | — | — | — | 0.636 | 영상 하나하나를 동일 가중치로 볼 경우 |

**FP 원인**: sample_14 t=9.73s — detector가 컷 후보로 잡았지만 실제로는 같은 전투 장면 내 스킬/전투 이펙트에 의한 변화(`game_visual_change`)이며 편집 컷이 아니었습니다. 사전에 우려했던 "게임 이펙트-컷 혼동" 패턴의 실증 사례입니다.

**FN 원인 분석**: sample_05의 FN 36건은 전부 `full_cut`이며, 해당 시점들의 MAFD는 대략 23~27 사이에 몰려 있어 채택된 threshold(27.283)보다 근소하게 낮았습니다(예: t=1.93s 구간 최대 MAFD 23.9, t=32.17s 구간 최대 MAFD 27.1). `sample_05_threshold.json`을 보면 이 영상은 "no_clean_gap_fallback_percentile"(최대 상대 하락폭 4.4%로 25% 기준 미달) 경로를 타서 고정 P85 백분위가 적용됐는데, 이 영상은 실제 컷이 매우 잦고(44개/182.7초 ≈ 4초당 1컷) MAFD 값이 서로 비슷한 수준으로 몰려 있어 P85 fallback 규칙이 사실상 "상위 15%만 통과"라는 임의의 상한을 걸어버린 셈이 되었습니다. **즉 컷이 드문드문 있고 크기가 뚜렷히 다른 영상(game_01, story_01)에서는 이 threshold 선택 규칙이 잘 맞았지만, 컷이 조밀하고 크기가 비슷한 "빠른 점프컷/인터뷰 컴필레이션"류 콘텐츠에서는 같은 규칙이 recall을 구조적으로 크게 깎아먹습니다.** sample_14의 FN 3건(28.30/41.87/46.17s)은 성격이 달라, "직전/직후 1프레임 단위로 불연속 전환"되는 실제 편집 특징 자체가 MAFD 신호로 충분히 크게 포착되지 않은 사례로, threshold보다는 신호 자체의 민감도 한계에 가깝습니다.

threshold는 이 결과를 보고 재조정하지 않았습니다 — 위 수치는 배치 단계에서 이미 고정됐던 threshold 그대로의 실제 성능입니다.

**판정 구분(2026-08-23 정정)**: pooled F1 0.412는 기존 판정 기준(F1<0.50 = 제외 후보)에 그대로 적용하면 "제외"에 해당합니다. 다만 이 실패의 원인이 MAFD 신호 자체가 아니라 threshold 선택 방식(no_clean_gap_fallback_percentile / P85)에 있다는 것이 위 원인 분석에서 확인됐으므로, 두 가지를 구분해서 판정합니다:
- **현재 threshold selection/detector heuristic(top-K gap → 없으면 P85 fallback) 그대로**: **제외 후보** (pooled F1 0.412 < 0.50, 조밀한 점프컷 콘텐츠에서 recall 구조적 붕괴)
- **MAFD/scene-change raw 신호 자체의 기술적 가능성**: **조건부 개선 후보** (positive-control인 sample_06에서는 F1 1.000, sample_14도 F1 0.600 — 신호 자체는 유효하나 threshold 선택 로직을 콘텐츠 밀도에 맞게 개선해야 사용 가능)
현재 detector(신호+threshold 선택 로직 전체)를 "조건부 채택"으로 표현하지 않습니다 — threshold 로직까지 포함한 현재 구현 그대로는 제외 후보입니다.

game_01의 176.77초 지점(partial_edit)은 위 3개 표본 채점과는 별개의 영상에서 확정된 단일 포인트로, 이번 P/R/F1 계산에는 포함되지 않았습니다.

**이미 확인된 실패/관찰 사례(정식 채점과 별개로 사실로 기록, 일부는 이번 라벨링으로 갱신됨)**:
- sample_05: 배치 탐색 단계에서는 "이름표/질문박스 그래픽 등장으로 인한 오탐" 위험을 예상했으나, 이번 8개 candidate 정식 라벨링 결과 8개 전부 실제 `full_cut`으로 확인되어 이 영상의 오탐 후보 목록에서는 **재현되지 않았습니다**(가설 정정). 대신 훨씬 심각한 **recall 붕괴**(F1 0.308)라는 다른 실패가 실측으로 확인됐습니다.
- sample_14: 스킬 이펙트(파티클/전투 이펙트)가 컷 후보로 오탐 — **이번에 실제 P/R/F1으로 확정**(FP 1건, t=9.73s).
- sample_03: 도네이션 알림/KO 그래픽 오버레이가 컷 후보로 오탐 (아직 정식 채점 없음, backlog)
- sample_15: 게임 구간(바이옴) 전환 시 색상변화가 실제 컷과 구별 어려움 (아직 정식 채점 없음, backlog)
- sample_11: UI 진행 배너 텍스트 변화가 유사 배경에서 오탐 가능성 (아직 정식 채점 없음, backlog)

## 5. Low-visual-change 결과

**용어 정정(2026-08-23)**: 지금까지 결과상 "화면상 시각적 변화가 적음"과 "콘텐츠가 지루함"은 다른 개념임이 확인됐습니다. V1 사용자 표현은 항상 `low visual change`/`시각적 변화가 적은 구간`으로 쓰고, "지루함"/"boring"으로 해석하지 않습니다. 최종 사용자 피드백은 "관찰 → 근거 → 장르 맥락" 구조를 유지합니다. 예: *"12.4~18.1초 동안 화면 변화량이 낮았습니다. 다만 강의/토킹헤드 장르에서는 정상적인 구성일 수 있습니다."*

**명칭 정리(2026-08-23)**: 아래 두 신호는 이름이 비슷해 보이지만 서로 다른 구현입니다 — 혼동 방지를 위해 이후 문서 전체에서 다음 명칭으로 구분합니다.
- **`legacy_whole_frame_lowmotion_baseline`**: 원안 `detect_low_motion.py`, 화면 전체 평균 YDIF, 고정 파라미터, calibration 없음.
- **`calibrated_whole_frame_diff_signal`**: `analyze_motion_candidates.py`의 `whole_frame_diff`, 5fps·240px 다운샘플, game_01 calibration → sample_02 validation을 거쳐 threshold를 데이터 기반으로 고정한 신호.
두 신호는 서로 다른 판정을 받으며(아래), 이는 같은 기술에 대한 판정 충돌이 아니라 애초에 다른 구현이기 때문입니다.

**`legacy_whole_frame_lowmotion_baseline`의 실측 결과(고정 파라미터, 어떤 영상에도 재조정하지 않음)**:

| 영상 | 저-시각변화 비율 | 해석 |
|---|---|---|
| game_01 | 93% | PIP 희석 의심 |
| sample_04 | 99.6% | 단일연속샷, PIP 아님 |
| sample_05 | 99.9% | 단일연속샷, PIP 아님 |
| sample_12 | 99.3% | 단일연속샷 강의, "지루함과 무관"의 대표 사례 |
| sample_01/02/03 | 20.9~53.3% | PIP 있음, 정도는 콘텐츠마다 다름 |
| sample_07/08/09/10/14/15 | 0% | PIP 없고 빠른 편집 — baseline이 그럴듯한 값을 냄 |

즉 `legacy_whole_frame_lowmotion_baseline`의 실패는 **PIP 희석뿐 아니라 단일연속샷 콘텐츠 전반**에서도 나타나는, 애초 예상보다 넓은 문제입니다. 이 신호는 이후 재조정 없이 **제외 후보**로 유지합니다.

**`calibrated_whole_frame_diff_signal` 등 대안 신호 calibration/validation 완료(2026-08-23)**: game_01에서 사람이 지정한 4개 `positive_static` + 4개 `negative_active` 구간(탐지 결과를 먼저 보여주지 않고 균일 5초 간격 contact sheet + timecode 재생 영상만으로 독립 선정)으로 5개 신호의 threshold를 데이터 기반으로 골라 고정했고, sample_02(마찬가지로 탐지 결과 비공개 상태에서 독립 선정한 4+4구간, 그중 18~22초/41~46초는 의도적으로 PIP/게임 인서트 영역만 움직이는 active 사례로 포함)에 그 threshold를 **재조정 없이 그대로** 적용해 validation을 실행했습니다(이 영상은 배치 탐색 때 한 번 훑어봤으므로 엄밀한 blind holdout이 아니라 "검증(validation)"으로 표현합니다).

| 신호 | 고정 threshold(game_01 calibration) | calibration F1 | validation F1(sample_02) | Δ | validation P / R |
|---|---|---|---|---|---|
| **calibrated_whole_frame_diff_signal**(구 whole_frame_diff) | 3.076 | 0.800 | 0.857 | +0.057 | 1.000 / 0.750 |
| optical_flow_mag | 0.726 | 0.800 | 0.889 | +0.089 | 0.800 / 1.000 |
| ssim_change | 0.076 | 0.800 | 1.000 | +0.200 | 1.000 / 1.000 |
| tile_max_diff | 10.831 | 0.727 | **0.000** | **−0.727** | 0.000 / 0.000 |
| tile_topk_mean | 8.763 | 0.727 | **0.000** | **−0.727** | 0.000 / 0.000 |

**최종 판정(2026-08-23, 사용자 확정 — n=4/4로 표본이 매우 작아 방향성 수준으로 유지)**: `calibrated_whole_frame_diff_signal`/`optical_flow_mag`/`ssim_change` = **채택 후보(방향성, 검증 표본 작음)**, `tile_max_diff`/`tile_topk_mean` = **제외 후보**(calibration에서는 F1 0.727로 그럴듯했으나 validation에서 완전히 붕괴 — 절대 threshold가 영상 간 신호 스케일 차이로 전이되지 않는 것으로 보임, tile 기반 raw 값의 근본적 한계로 추정).

**주목할 관찰**: sample_02의 PIP/게임 인서트 active 구간(18~22초, 41~46초)은 5개 신호 **전부** "active"로 정확히 판별했습니다 — game_01에서 우려했던 "PIP만 움직이면 전체 신호가 희석되어 static으로 오판"하는 패턴이 이번 validation에서는 재현되지 않았습니다. 다만 표본이 2개뿐이라 일반화할 수 없습니다.

**정리**: `legacy_whole_frame_lowmotion_baseline`(제외 후보)과 `calibrated_whole_frame_diff_signal`(채택 후보, 방향성)은 이름은 비슷하지만 서로 다른 구현이라 판정이 다른 것이며, 같은 기술에 대한 모순된 판정이 아닙니다. baseline의 93~99.9% 수준의 높은 오탐률은 여전히 유효한 실패 기록이고, calibrated 신호로 대체하는 것이 이번 검증에서 나온 실질적 개선 방향입니다.

## 6. Audio 결과

`candidate_loud_event`/`candidate_silence` 추출(영상 내 통계적 상위 1% 규칙, 절대 dB 기준 아님)은 story_01, game_01, 배치 15개 전체에서 기술적으로 정상 작동을 확인했습니다. **정확도는 아직 사람이 청취 확인한 사례가 없어 검증 부족입니다.** game_01의 131.7~132.9초 구간 중:
- **132.1~132.9초는 사용자가 직접 청취해 정정**했습니다 — 연속 `silence`가 아니라 132.19~132.48초, 132.59~132.83초 두 번의 짧은 무음이 끼어 있는 `intermittent_silence` 형태였습니다(원래 라벨 스키마에 없던 `intermittent_silence`를 이번에 추가). 이진 `silence`/`not silence` 분류를 억지로 적용하지 않은 사례입니다.
- **131.7~132.1초의 `loud_event`/`normal_loud_event` 질적 판정은 사용자 요청으로 현재 보류 중**입니다. Claude는 이 세션에서 오디오를 직접 청취해 "갑자기 튀는 소리인지/정상 발화인지" 판단할 수 있는 기능이 없어 이 항목을 대신 판단하지 않았고, 사용자도 visual-change/low-visual-change 검증을 우선 마무리하기 위해 이 항목을 뒤로 미뤘습니다.
- 위 상태로는 `candidate_loud_event`/`candidate_silence` 탐지 결과와 실제 ground truth를 정식으로 비교(정확도 산출)할 수 없어, 오디오 기술은 여전히 **검증 부족**입니다.

## 7. OCR/STT 최소 feasibility 검증 — 확정: 환경 제약으로 미검증 (2026-08-23)

목표를 "production 완성도"가 아니라 "한국어 음성이 실제로 텍스트로 나오는지 / segment timestamp를 얻을 수 있는지 / burned-in 한국어 자막을 실제 OCR 엔진으로 읽을 수 있는지"의 최소 확인으로 좁혀서 재시도했습니다. 억지로 결과를 만들지 않고, 이 세션에서 직접 재현 테스트한 결과를 근거로 **둘 다 환경 제약으로 미검증**을 확정합니다.

**STT**: `pip install faster-whisper` 시도 → `403 Forbidden`(pypi.org). 대조군으로 관계없는 신규 패키지(`cowsay`)도 동일하게 403 — 이 세션은 새 pip 패키지 설치가 전면 차단되어 있음(캐시된 패키지만 사용 가능). `whisper`/`vosk`/`speech_recognition` 모두 미설치, 오프라인 대체 엔진 없음. → 실제 엔진 실행 불가능함을 재확인.

**OCR**: `tesseract --list-langs` → `eng`, `osd`만 존재, 한국어 언어팩 없음. `apt-get install tesseract-ocr-kor` → `403 Forbidden`(archive.ubuntu.com). PaddleOCR/EasyOCR pip 설치도 동일하게 차단. 파일시스템에 `kor.traineddata` 등 한국어 모델 파일 자체가 없음. → 한국어 OCR 엔진 실행 불가능함을 재확인. ffprobe로 15개 배치 샘플 전부 임베디드 자막 트랙 0개도 기존과 동일하게 재확인 — 모든 자막이 burned-in.

**이번에 준비해 둔 것(외부 환경에서 최소 노력으로 실행할 수 있도록)**:
- STT: game_01 2구간(0:00~0:15, 1:30~1:45) + sample_02 1구간(0:00~0:15) 짧은 클립을 이미 잘라뒀고, ref_text가 빈 ground truth 템플릿(`ground-truth-pending/stt_minimal_benchmark_gt.csv`)과 채점 스크립트(`scripts/score_stt.py`, CER/WER/timestamp MAE, 합성 데이터로 정확성 검증 완료)를 준비했습니다. 정확한 실행 명령은 `STT-SECRET-INJECTION-PLAN.md`에 있습니다.
- OCR: 콘택트시트를 다시 훑어 **실제로 한국어 텍스트가 확인된** 6개 스타일(일반 하단/색상/테두리그림자/큰강조/중앙상단/짧은예능형) 프레임을 뽑았고, ref_text가 빈 ground truth 템플릿(`ground-truth-pending/ocr_minimal_benchmark_gt.csv`)과 채점 스크립트(`scripts/score_ocr.py`, detection recall/CER/스타일별 실패, 합성 데이터로 검증 완료)를 준비했습니다. 정확한 실행 명령은 `OCR-EXTERNAL-EXECUTION-PLAN.md`에 있습니다.
- **부수적 발견**: 이 스타일 소싱 과정에서, 애초 배치 분석 때 장르만 보고 "한국어 콘텐츠"로 가정했던 sample_03/04/06/09가 실제로는 **영어 자막** 콘텐츠였음을 확인했습니다(8절 14번 참고). 실제 한국어 burned-in 자막이 확인된 것은 game_01/sample_01/sample_02/sample_14/sample_15뿐입니다.
- 사람이 짧은 구간을 듣고/보고 ref_text만 채워주고, 외부 환경에서 실제 엔진을 돌려 예측 CSV를 주면, 위 두 스크립트로 이 세션에서 바로 CER/WER/timestamp MAE/detection recall/스타일별 실패 사례를 계산할 수 있습니다. API 키는 이번에도 채팅으로 요구하지 않았습니다.

## 8. 발견된 주요 실패 사례 (전체 종합, 숨기지 않음)

1. PIP/인서트 화면에서 low-visual-change baseline이 희석되어 오탐(game_01: 93%, sample_01/02/03: 20.9~53.3%)
2. **단일연속샷 콘텐츠에서 baseline이 더 극단적으로 오탐**(sample_04: 99.6%, sample_05: 99.9%, sample_12: 99.3%) — PIP 문제보다 범위가 넓음
3. **자막/오버레이 그래픽 등장이 컷 후보로 오탐**(sample_05 — 신규 발견, 6종 분류에 `overlay_change` 추가 계기)
4. **게임 자체 시각효과가 편집 컷과 구별 안 됨**(sample_14: 스킬이펙트, sample_15: 구간전환 색상, sample_03: 도네이션/KO 그래픽) — 사전 우려의 실증
5. **"시각적 저변화 ≠ 콘텐츠 지루함"** — 개념적 재정의 필요(sample_12), 표현 정정 완료(5절)
6. 정지 프레임 비교만으로는 컷 여부 판단이 어려운 콘텐츠 존재(sample_09, 연속 요리 동작) — 사람이 봐도 애매할 수 있음
7. scdet 컷 threshold가 영상마다 다른 근거(clean_gap vs fallback_percentile)로 선택됨 — 원칙은 일관되나 fallback 사용 시 threshold가 다소 임의적임을 인지해야 함
8. 오디오는 기술적으로 작동하나 정확도 검증 사례가 아직 0건
9. **sample_16 업로드 누락** — story_01 관련 업로드 누락과 같은 유형의 반복되는 취약점
10. 이 세션 환경 자체의 네트워크 제약으로 로컬 STT/OCR 모델 실행 불가(계속 유효)
11. Claude의 시각적 판단(자막 스타일/장르/컷 유형)은 예비 확인일 뿐 정식 ground truth가 아님 — 실제로 game_01의 176.77초처럼 Claude가 틀리게 판단한(미분류) 사례가 이미 확인됨
12. **sample_05 recall 붕괴(정식 실측, F1 0.308 = precision 1.000 / recall 0.182)** — 컷이 조밀하고 크기가 비슷한 콘텐츠(빠른 점프컷/인터뷰 컴필레이션)에서는 threshold 선택 규칙(top-K gap 없을 시 P85 fallback)이 구조적으로 recall을 크게 깎아먹음(44개 실제 컷 중 8개만 탐지). 같은 방법이 game_01/story_01에서는 잘 맞았고, sample_06(positive-control)에서는 F1 1.000이 나온 것과 뚜렷이 대비됨 — **하나의 전역 threshold 선택 규칙이 모든 편집 스타일에 균일하게 적용되지 않는다**는 핵심 실패로 기록.
13. **tile 기반 low-motion 신호(tile_max_diff/tile_topk_mean)의 threshold 전이 실패(정식 실측)** — game_01 calibration F1 0.727에서 sample_02 validation F1 0.000으로 완전 붕괴. 절대(raw) threshold가 영상 간 신호 스케일 차이로 전이되지 않는 것으로 보이며, 재조정 없이 이 실패를 그대로 기록하고 V1 후보에서 제외.
14. **배치 샘플의 자막 언어를 장르만 보고 잘못 가정했던 사례(신규 발견)** — OCR 스타일 소싱 과정에서 콘택트시트를 다시 확인해보니 sample_03(LoL 스트리밍)/sample_04·sample_06(길거리 인터뷰)/sample_09(레시피)의 burned-in 자막이 실제로는 **영어**였습니다. 애초 배치 분석 단계의 "장르 추정"만으로 언어까지 넘겨짚으면 안 된다는 방법론적 교훈이며, 실제 한국어 콘텐츠 검증은 이 사실이 재확인된 game_01/sample_01/sample_02/sample_14/sample_15로 한정해야 합니다.
15. **STT/OCR 실행 불가를 이번에 구체적으로 재확인** — pip 신규 패키지 설치 전면 403(대조군 무관 패키지로도 확인), apt로 한국어 tesseract 언어팩 설치도 403. 환경 제약이 추상적 우려가 아니라 재현 가능한 사실임을 명시적으로 기록.

## 9. 기술별 현재 판정

| 기술 | 판정 | 근거 |
|---|---|---|
| Scene/visual-change 탐지 — **현재 threshold selection/detector heuristic 그대로**(top-K gap → 없으면 P85 fallback) | **제외 후보** | 3영상 합산(pooled) F1 0.412 < 0.50 기준. positive-control(sample_06)은 F1 1.000이지만 조밀한 점프컷 콘텐츠(sample_05)에서 recall 0.182로 붕괴(4절), 원인은 P85 fallback heuristic |
| Scene/visual-change — **MAFD/scene-change raw 신호 자체**(threshold 로직과 분리) | **조건부 개선 후보** | 신호 자체는 sample_06 F1 1.000, sample_14 F1 0.600으로 유효성 있음. threshold 선택 로직을 컷 밀도에 맞게 개선하면 사용 가능성 있음(4절) |
| 6종 분류(full_cut/partial_edit/transition vs game_visual_change/visual_effect_non_cut/overlay_change) | **부분 검증** | 라벨 체계 자체는 사람이 모호함 없이 분류 가능함을 확인(3영상 15건 전부 강제 분류 없이 결정). 실측 확인된 카테고리: full_cut(다수), game_visual_change(1건), partial_edit(game_01 176.77s, 별도 영상). transition/visual_effect_non_cut/overlay_change는 아직 실제 확인 사례 없음 — 이 3종은 여전히 검증 부족 |
| `legacy_whole_frame_lowmotion_baseline`(원안 detect_low_motion.py) | **제외 후보** | 93~99.9% 오탐률이 game_01/sample_04/05/12에서 반복 확인(5절), 재현성 있는 실패 |
| `calibrated_whole_frame_diff_signal` / optical_flow_mag / ssim_change (analyze_motion_candidates.py) | **채택 후보(방향성, 검증 표본 매우 작음 — n=4/4)** | game_01 calibration → sample_02 validation(threshold 고정, 재조정 없음) 결과 validation F1 0.857~1.000. 표본이 작아 최종 확정 기술로 표현하지 않음(5절). `legacy_whole_frame_lowmotion_baseline`과는 다른 구현이며 판정 충돌 아님 |
| tile_max_diff / tile_topk_mean | **제외 후보** | calibration F1 0.727 → validation F1 0.000으로 완전 붕괴, threshold 전이 실패(5절) |
| 음량 후보 탐지(candidate_loud_event/silence) | **검증 부족(backlog)** | 기술적 작동 확인. 132.1~132.9초는 intermittent_silence로 정성적 확인됐으나, 131.7~132.1초 loud/normal 질적 판정은 사용자 결정으로 backlog에 남김(6절) |
| Burned-in 자막 존재/스타일 분류(Claude 시각) | 판정 대상 아님 | OCR 정확도로 쓰지 않음, 디버깅/그라운드트루스 생성 용도 |
| OCR 정확도(실제 엔진, 한국어) | **환경 제약으로 미검증(확정)** | tesseract 한국어 언어팩 없음 + apt/pip 신규 설치 전면 403 재확인(7절). 실행 재료(6스타일 프레임, ground truth 템플릿, 채점 스크립트, 외부 실행 명령)는 준비 완료 — `OCR-EXTERNAL-EXECUTION-PLAN.md` |
| STT(한국어) | **환경 제약으로 미검증(확정)** | 오프라인 ASR 엔진 없음 + pip 신규 설치 전면 403 재확인(7절). 실행 재료(3개 짧은 클립, ground truth 템플릿, 채점 스크립트, 외부 실행 명령)는 준비 완료 — `STT-SECRET-INJECTION-PLAN.md` |
| 처리시간/비용 | (F1 대상 아님, 측정 완료) | 1-pass 결합 시 평균 17.4% — 참고용 |

**최종 판정 범주 정리 (2026-08-23, 4가지로 분리)**:
- **① 실제 검증 완료**: `calibrated_whole_frame_diff_signal`/optical_flow_mag/ssim_change(방향성, n=4/4), scene/visual-change의 raw 신호 자체(조건부 개선 후보로 분리 확정), 처리시간/비용.
- **② 조건부**: MAFD/scene-change raw 신호(threshold 로직 개선 전제) = 조건부 개선 후보, 6종 분류 체계 = 부분 검증(라벨 체계는 검증됨, 3개 카테고리 실사례 없음).
- **③ 제외**: 현재 threshold selection/detector heuristic 그대로의 scene/visual-change 탐지, `legacy_whole_frame_lowmotion_baseline`, tile_max_diff/tile_topk_mean.
- **④ 환경 제약으로 미검증**: OCR(한국어 실제 엔진), STT(한국어), 음량 후보의 질적 loud/normal 판정(사용자 결정으로 backlog).

## 10. STEP 4-0 종료 조건 충족 여부

**충족(2026-08-23, 사용자 지시에 따른 기준으로).** `plan-step-4-0-feasibility-poc.md` 9절의 원래 종료 조건("최종 판정을 사람 ground truth 기반으로 낸 뒤 승인")을, 사용자가 이번에 "① 실제 검증 완료 / ② 조건부 / ③ 제외 / ④ 환경 제약으로 미검증"의 4분류로 명시적으로 재정의했습니다. 이 기준으로 보면:

- 9절 표의 모든 항목이 위 4가지 중 하나로 **명확히 분류**되어 있습니다 — 더 이상 "아직 라벨을 기다리는 중"처럼 열려 있는 항목이 없습니다.
- Scene/visual-change, low-visual-change(대안 신호), 처리시간은 실제 사람 ground truth로 검증 완료했습니다.
- OCR/STT는 이 세션 환경에서 실행이 근본적으로 불가능함을 재현 가능한 테스트로 확정했고(④), 외부 환경에서 실행할 구체적 명령·재료·채점 스크립트까지 이미 준비했습니다.
- 음량의 질적 loud/normal 판정은 사용자가 명시적으로 backlog 처리를 승인했습니다(④).

따라서 **이번에 사용자가 정의한 종료 기준은 충족되었습니다.** 다만 이는 "모든 기술이 production에 쓸 수준으로 검증됐다"는 뜻이 아니라 "더 이상 상태가 불명확한 항목 없이, 각 기술이 무엇을 근거로 어느 범주에 속하는지 확정됐다"는 뜻입니다 — ③ 제외로 분류된 기술은 V1에 그대로 들어가면 안 되고, ④ 항목은 실제 수치 없이 넘어가는 것이므로 STEP 4-1 설계 시 그 사실을 계속 인지해야 합니다.

## 11. STEP 4-1로 넘어가기 전에 남은 것

1. ~~game_01 저모션 calibration 라벨~~ — **완료** (4+4구간, 5절)
2. ~~sample_02 검증 라벨~~ — **완료** (4+4구간, threshold 고정 적용, 5절)
3. ~~sample_05/06/14 visual-change 라벨 + P/R/F1~~ — **완료** (4절)
4. ~~game_01 131.7~132.1초 오디오 `loud_event`/`normal_loud_event` 질적 판정~~ — **backlog로 확정** (사용자 승인, 6/9절). STEP 4-1 착수를 막지 않음.
5. ~~실제 OCR 엔진 실행~~ — **환경 제약으로 미검증 확정, 외부 실행 재료 준비 완료** (7절, `OCR-EXTERNAL-EXECUTION-PLAN.md`). 사용자가 원할 때 외부 환경에서 실행 후 결과 CSV만 주면 `scripts/score_ocr.py`로 바로 채점 가능.
6. ~~STT 검증~~ — **환경 제약으로 미검증 확정, 외부 실행 재료 준비 완료** (7절, `STT-SECRET-INJECTION-PLAN.md`). 사용자가 원할 때 외부 환경에서 실행 후 결과 CSV만 주면 `scripts/score_stt.py`로 바로 채점 가능.
7. **STEP 4-0 종료 조건 충족** (10절). 이 문서를 사용자가 검토하고 명시적으로 승인하면 STEP 4-1(DB 마이그레이션 설계·조사)을 시작합니다 — 이 세션은 사용자 승인 없이 먼저 시작하지 않습니다.
