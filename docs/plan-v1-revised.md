# plan-v1-revised.md

`research-video-analysis-v1-feasibility.md`의 조사 결과를 반영해 이전 V1 계획을 수정한 버전입니다. 코드/마이그레이션/의존성 설치는 아직 진행하지 않았습니다.

---

## 1. V1 사용자 전체 흐름 (변경 없음)

1. 대시보드에서 "영상 분석" 진입
2. MP4 업로드 — **클라이언트 다운스케일 없이 원본을 그대로 업로드**(TUS 재개 가능 업로드), 다만 최대 길이/용량 제한은 둠
3. 장르 선택: 게임 / 스토리·썰 / 정보형
4. 업로드 완료 → "분석 중" 상태로 전환
5. 서버(Cloud Run)에서 FFmpeg 처리 → STT → (필요 항목만) OCR/Vision → 종합 리포트
6. 결과 페이지에서 타임스탬프 기반 피드백 확인 (관찰-근거-장르 맥락 구조, 8번 참고)
7. V1은 "보여주기"까지 — 반영 여부 체크나 재업로드 비교는 V2

---

## 2~3. 피드백 항목 재분류 — 난이도 3단계 + 기술 요구사항

기존 13개를 동일한 난이도로 취급하지 않고, **1차로 10개를 확실하게 만들고 자막/챕터 관련 4개는 별도 단계로 붙이는 구조**로 바꿉니다.

### 신뢰도 높음 (1차 구현 대상, 8개)

| # | 항목 | 기술 요구사항 |
|---|---|---|
| 1 | 무음/저음량 구간 | FFmpeg (`silencedetect`, `ebur128`) |
| 2 | 음량 급변 구간 | FFmpeg (`ebur128`) |
| 3 | 블랙프레임/화면 오류 | FFmpeg (`blackdetect`) |
| 4 | 영상 메타데이터(길이/해상도/코덱 등) | FFmpeg (`ffprobe`) |
| 5 | 대사 반복/늘어지는 구간 | Transcript |
| 6 | 도입부 후킹까지 걸린 시간 | Transcript |
| 7 | 장르별 전환 표현 존재 여부 | Transcript |
| 8 | 전사 기반 설명 밀도(정보 대비 속도) | Transcript |

### 테스트 필요 (1차 구현 대상, 2개 — 방식 수정됨)

| # | 항목 | 기술 요구사항 | 수정 사항 |
|---|---|---|---|
| 9 | 정적 화면 구간 | FFmpeg **2-신호**: `freezedetect`(완전 정지) **+** `signalstats`/`scdet` MAFD를 5~10초 윈도우로 평균한 저모션 신호 | freezedetect 단독 → 2-신호로 변경 |
| 10 | 시각적 변화 빈도 (구 "컷 빈도/리듬") | FFmpeg (`scdet`) + 최소 지속시간 필터 | "편집 컷 수"라고 단정하지 않음. 특히 게임 장르는 리포트에 "카메라 이동/플래시로 인한 오탐 가능" 캐비어트 고정 표기. 실제 컷 수 주장은 STEP 4-0 검증 후 재검토 |

### 생각보다 어려운 것 (2차 구현 대상, V1 내 별도 단계로 분리, 4개)

| # | 항목 | 기술 요구사항 | 비고 |
|---|---|---|---|
| 11 | 자막 존재 여부 | `ffprobe`(임베디드 트랙) + OCR/Vision(burned-in) | 2단 구조 필요 |
| 12 | 자막 커버리지 | 위와 동일 + 구간 병합 | |
| 13 | 자막-음성 싱크 | OCR 타임스탬프 + STT/VAD 타임스탬프 정렬 | 4개 중 가장 비쌈 |
| 14 | 화면 구성 변화(챕터 전환) | Vision AI (선택 프레임) | |

### 종합 리포트

| # | 항목 | 기술 요구사항 |
|---|---|---|
| 15 | 종합 리포트 | LLM (위 신호들 + 장르 기준 종합, Zod 스키마) |

**1차 구현 범위는 10개(신뢰도 높음 8 + 테스트 필요 2)**이고, 자막/챕터 4개는 STEP 4-0 feasibility 결과를 본 뒤 V1 안에서 추가 단계로 진행합니다.

---

## 4. 장르별 분석 기준 (수정: 게임 오디오 밸런스 범위 축소)

### 게임
- 시각적 변화 빈도가 이벤트 발생 타이밍과 맞는지 (단, 캐비어트: 카메라 이동/화면 효과로 인한 오탐 가능성 명시)
- ~~BGM/게임사운드/음성 밸런스~~ → **"대사 구간에서 전체 배경음이 상대적으로 높게 감지되는 구간"** (VAD로 특정한 발화 구간 대비 배경 음량 비교 — source separation 없이 가능한 범위로 축소. "무엇이 원인인지"는 주장하지 않음)
- 하이라이트 구간이 영상 앞부분에 배치되어 있는지

### 스토리·썰
- 도입부 후킹 타이밍
- 정적 구간(2-신호 기준) 존재 여부
- 전환 표현 주변 편집 리듬
- (자막 관련 항목은 2차 단계에서 추가)

### 정보형
- 챕터 전환 시 화면 구성 변화(2차 단계, Vision AI)
- 정보 밀도 대비 설명 속도
- (자막 커버리지는 2차 단계에서 추가 — 정보형은 특히 이 항목의 우선순위가 높음)
- 도입부 명확성

---

## 5. 최소 기술 아키텍처 (수정: 업로드/Job 구조)

```
[클라이언트]
  영상 선택 (다운스케일 없음, 최대 길이/용량/MIME 검증)
  → TUS 재개 가능 업로드로 Supabase Storage에 직접 업로드
    (비공개 버킷, 경로: videos/{uid}/{uuid}.mp4, RLS로 소유권 강제)

[업로드 완료]
  → video_analyses 행 생성 (status: pending)
  → Cloud Tasks에 작업 큐잉 (task 이름: video-{id}, 재시도/백오프 설정)

[Cloud Tasks → Cloud Run Job 트리거]
  → 얇은 Cloud Run 서비스가 Cloud Run Admin API로 Job 실행 트리거
    (또는 Eventarc/Workflows로 Storage 이벤트에서 직접 Job 트리거)
  → Job 시작 시 DB compare-and-swap: status='pending' → 'processing' (실패 시 즉시 종료, 중복 실행 방지)

[Cloud Run Job: FFmpeg 처리 (단일 패스)]
  → 서버 측에서 분석용 proxy 생성 (해상도는 OCR 글자 높이 기준으로 별도 검토)
  → silencedetect / ebur128 / blackdetect / freezedetect / signalstats(변화량) / scdet 신호 산출

[STT + VAD]
  → 음성 전사(타임스탬프 포함) — Transcript 기반 항목에 사용
  → (2차 단계) VAD로 발화 구간 특정 → 배경음 비교

[OCR/Vision] (2차 단계, 선택 프레임만)
  → burned-in 자막 감지, 챕터 전환 화면 분석

[LLM 종합]
  → 신호 + 장르 기준으로 구조화된 리포트 생성 (Zod 검증)

[결과 저장]
  → video_analyses.report 갱신, status='completed' (upsert로 멱등 처리)
  → 실패 시 status='failed' + error_code/error_message 기록, stale-lock 타임아웃으로 회수 가능하게

[클라이언트]
  → 결과 페이지에서 폴링/재방문 시 확인
```

---

## 6. DB 스키마 (단순화)

`video_analysis_results`를 별도 테이블로 쪼개지 않고, 우선 하나의 테이블로 시작합니다. 나중에 "가장 많이 발생하는 피드백 유형" 같은 집계가 필요해지면 그때 분리합니다.

```
video_analyses
- id
- user_id
- channel_id (nullable)
- genre

- storage_path
- duration_sec
- file_size_bytes

- status          -- pending / processing / completed / failed
- current_stage   -- 예: ffmpeg / stt / ocr / llm_report
- progress        -- 0~100 (선택)

- raw_metrics jsonb   -- FFmpeg/STT 등 원시 신호
- report jsonb        -- LLM 종합 리포트 (Zod 스키마로 검증된 구조)

- error_code
- error_message

- pipeline_version   -- 분석 로직 버전 (나중에 로직이 바뀌어도 과거 결과 구분 가능)

- created_at
- started_at    -- stale-lock 판정 기준
- completed_at
```

재사용: `profiles`, `channels`는 기존 그대로 사용 (channel_id로 참조만).

---

## 7. 재시도/실패 처리 전략

- Job 시작 시 `UPDATE video_analyses SET status='processing', started_at=now() WHERE id=$1 AND status='pending'` — 영향받은 행이 없으면 이미 처리 중/완료된 것이므로 즉시 종료 (중복 실행 방지)
- `started_at` 기준으로 일정 시간(예: 처리 예상 시간의 2~3배) 지나도록 `processing` 상태면 워커 비정상 종료로 간주하고 재시도 큐에 다시 넣음 (stale-lock 회수)
- 결과 저장은 `video_id` 기준 upsert — 재시도로 인해 같은 작업이 두 번 완료돼도 결과가 깨지지 않음
- 실패 시 `error_code`로 재시도 가능한 실패(일시적 API 오류 등)와 재시도해도 소용없는 실패(파일 손상, 지원 안 되는 코덱 등)를 구분해 UI에 다르게 안내

---

## 8. 업로드 검증/보안/보관 정책

- 업로드: TUS 재개 가능 업로드(`tus-js-client`/Uppy), 최대 길이/용량/MIME(`video/mp4`)을 클라이언트 검증 + 버킷 설정(`file_size_limit`, `allowed_mime_types`) 양쪽에서 강제
- 경로: `videos/{auth.uid()}/{uuid}.mp4`, 비공개 버킷, `storage.objects`에 RLS 정책으로 본인 경로만 쓰기/읽기 가능하게 강제. 업로드용 signed URL 발급은 사용자 JWT로 (service_role 아님)
- 백엔드 읽기: Cloud Run 워커는 `service_role` 키 또는 워커 전용 단기 signed URL로 읽음
- 보관/삭제: Supabase에 내장 TTL 기능 없음 → `pg_cron` 또는 예약 Edge Function으로 "분석 완료 후 N일" 등의 규칙에 따라 직접 삭제 구현 (정확한 보관 기간은 개인정보 처리방침에 명시할 값이므로 별도 결정 필요 — 지난 라운드의 PIPA 검토와 연결됨)

---

## 9. 결과 화면: 관찰 → 근거 → 장르 맥락

단순히 "여기 문제 있음"만 보여주면 가치가 약하므로, 모든 피드백 항목은 최소 3단 구조로 표시합니다.

```
02:14–02:17 · 무음 구간
3.2초간 대사가 감지되지 않았습니다.

근거
- 이 구간 평균 음량: -47 LUFS
- 영상 전체 평균 음량: -18 LUFS

스토리·썰 기준
- 이 구간은 영상 평균보다 화면 변화도 낮습니다.
```

"시각적 변화 빈도"처럼 신뢰도가 완전하지 않은 항목은 근거 섹션에 캐비어트를 함께 표기합니다. 예: "카메라 이동이 많은 구간에서는 이 수치가 실제 편집 컷보다 높게 나올 수 있습니다."

---

## 10. 최소 STEP 로드맵 (수정: STEP 4-0 확대, 순서 조정)

| STEP | 내용 |
|---|---|
| **4-0** | **분석 정확도/비용 feasibility PoC** (코드/DB 없이 스크립트 수준 검증) — 한국어 STT 정확도, burned-in 자막 OCR 정확도, 게임/스토리/정보형별 scene-detection 신뢰도(오탐률 포함), 정적 화면 탐지(2-신호) 정확도, 5/10/20/30분 영상 처리 시간, 영상 1건당 예상 비용. **여기서 결과가 안 좋은 항목은 DB를 만들기 전에 범위를 다시 조정.** |
| 4-1 | DB 마이그레이션: `video_analyses` (섹션 6 스키마) |
| 4-2 | 업로드 UI + TUS 재개 가능 업로드 연동 (Supabase Storage, RLS 경로 검증) |
| 4-3 | Cloud Tasks 큐 + Cloud Run Job 뼈대 (idempotent 시작/종료, compare-and-swap) |
| 4-4 | FFmpeg 단일 패스 처리 파이프라인 + 서버 측 분석용 proxy 생성 |
| 4-5 | STT 연동 |
| 4-6 | "신뢰도 높음" 8개 + "테스트 필요" 2개 피드백 항목 구현 |
| 4-7 | LLM 종합 리포트 생성 (관찰-근거-장르맥락 구조, Zod 스키마) |
| 4-8 | 결과 표시 UI |
| 4-9 | (4-0 결과가 괜찮다면) 자막/챕터 4개 항목 추가 — OCR 파이프라인 연동 |
| 4-10 | 베타 사용자 테스트 준비 (에러 처리, 무료 오픈) |

---

## 11. 10명 실사용자 노출 시점

STEP 4-8까지 끝나면 (자막/챕터 항목 없이도) 핵심 루프가 동작합니다. 자막 관련 4개 항목이 STEP 4-0에서 실현 가능하다고 확인되면 4-9까지 포함해서, 안 된다면 4-8 상태 그대로 10명에게 보여주는 것을 제안합니다. 결제 로직 없이 무료로 열어 "피드백이 실제로 쓸모 있는가"를 먼저 확인합니다.

이 단계의 목적은 유료 전환율 검증이 아닙니다. "10명 중 몇 명이 결제할 것인가"는 이후 단계에서 검증할 가설로 남겨둡니다.

---

## 12. 제품명 후보

이전 응답에서 제시한 20개 후보에서 변경 사항 없음.

---

## 변경 요약 (이전 계획 대비)

1. 자막 존재/커버리지/싱크: Transcript-only → ffprobe(임베디드) + OCR/Vision(burned-in) + STT/VAD 정렬. 난이도가 가장 높은 항목으로 재분류, 2차 단계로 분리.
2. 정적 화면 구간: freezedetect 단독 → freezedetect + 변화량 윈도우 신호(2-신호).
3. 컷 빈도: "편집 컷 수" 단정 표현 → "시각적 변화 빈도", 게임 장르 오탐 캐비어트 고정 표기.
4. 게임 오디오 밸런스: BGM/게임사운드/음성 분리 → VAD 기반 "배경음 상대적으로 높음" 수준으로 범위 축소.
5. 업로드: 클라이언트 WebCodecs 다운스케일 필수 → 원본 TUS 업로드 + 서버 측 프록시 생성.
6. Job 트리거: webhook → Cloud Run 직접 호출 → Cloud Tasks 큐 + Cloud Run Job + DB compare-and-swap idempotency.
7. STEP 4-0: STT 벤치마크 단독 → STT/OCR/scene-detection/정적탐지 4대 feasibility PoC + 처리시간/비용까지 확대.
8. DB: 처음부터 결과 테이블 분리 → 단일 테이블(jsonb) + status/current_stage/error_code/pipeline_version으로 재시도/버전 관리 반영.
9. 업로드 보안/보관: 명시 안 됨 → 경로 기반 RLS + TUS + pg_cron 자체 보관정책으로 구체화.
10. 결과 화면: 단순 타임스탬프+한줄 설명 → 관찰-근거-장르맥락 3단 구조.
