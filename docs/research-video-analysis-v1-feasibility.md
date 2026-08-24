# research-video-analysis-v1-feasibility.md

V1(영상 분석 MVP) 기술 설계를 확정하기 전, 사용자가 지적한 6개 구조적 문제 + 3개 운영 문제를 각각 실제 자료로 검증한 결과입니다. 이전 `research-video-analysis.md`의 일부 결론(특히 자막=STT, freezedetect=정적구간, scdet=컷수, 클라이언트 다운스케일 필수, webhook 직접 실행)을 이 문서가 대체/수정합니다.

---

## 1. 자막(#7~9)은 Transcript만으로 판별 불가 — embedded vs burned-in 구분 필요

**문제**: STT는 "무슨 말을 했는가"만 알 뿐, "화면에 자막이 실제로 보이는가"는 모른다. 특히 한국 크리에이터 대다수가 쓰는 방식은 편집 프로그램(프리미어/캡컷/예능 자막 스타일)으로 자막을 영상 픽셀에 직접 렌더링하는 **burned-in 자막**이며, 이는 별도 트랙이 아니라 그냥 화면의 일부다.

**검증 결과**:
- `ffprobe`로 감지 가능한 것은 컨테이너에 실제로 mux된 **자막 스트림**(`codec_type=subtitle`, MP4에서는 보통 `mov_text`)뿐이다. 조회 결과가 비어 있다는 것은 "자막이 없다"가 아니라 "트랙형 자막이 없다"는 뜻이다. burned-in 자막은 픽셀이므로 ffprobe는 원천적으로 볼 수 없고, 프레임 분석(OCR)이 필요하다 — Mux의 공식 기술 문서가 이 구분을 명시한다.
  ```
  ffprobe -v error -select_streams s -show_entries stream=index,codec_name,codec_type:stream_tags=language -of json input.mp4
  ```
- burned-in 자막 OCR 후보:
  - **Google Video Intelligence API의 `TEXT_DETECTION`** — 영상 프레임에서 직접 OCR을 수행하도록 설계되어 있고, 공식 문서가 "burnt-in subtitle 식별"을 명시적 활용 사례로 든다. 프레임 추출을 따로 안 해도 되는 것이 장점. (정확한 분당 단가는 이번 조사에서 확정하지 못함 — 구현 직전 `cloud.google.com/video-intelligence/pricing`에서 재확인 필요)
  - **Google Cloud Vision OCR** — 범용 OCR, 한국어 인쇄체 기준 약 90~93% 수준으로 보고됨. 스타일이 강한(색상/외곽선/애니메이션) 예능 자막에 특화되어 있지 않음.
  - **Naver Clova OCR** — 한국어 인식 정확도가 가장 높다고 보고되나(약 97~99%, 인쇄체 기준) 문서/영수증 OCR 중심 서비스라 예능 스타일 자막 성능은 문서화되어 있지 않음. 월 5,000건 무료 이후 유료.
  - **PaddleOCR(자체 호스팅, 무료)** — 2025년 중반부터 한국어 인식 모델(`korean_PP-OCRv5_mobile_rec`)이 정식 추가됨. 컴퓨트 비용만 발생하나 강한 그래픽 효과에 대한 공식 벤치마크는 없음.
  - **VideOCR**(오픈소스 참고 구현) — burned-in 자막 추출 전용 도구로, PaddleOCR 또는 Google Lens 백엔드 선택 가능, 프레임 샘플링 간격 조절, 인접 프레임 간 SSIM으로 중복 프레임을 걸러내고 감지 결과를 하나의 자막 구간으로 병합하는 구조를 이미 구현해 둠 — 우리 파이프라인의 참고 아키텍처로 그대로 쓸 만하다.
- 비용 절감을 위한 표준 캐스케이드: (1) 1~2fps로 프레임 샘플링 → (2) SSIM/텍스트 가능성 휴리스틱으로 1차 필터링(텍스트가 있을 법한 프레임만 남김) → (3) 필터를 통과한 프레임만 OCR 실행 → (4) 감지된 타임스탬프를 인접 구간끼리 병합해 "자막 표시 구간" 리스트 생성.
- 자막-음성 싱크는 OCR로 얻은 "자막 표시 구간"과 STT/VAD로 얻은 "발화 구간"을 각각 타임라인으로 만든 뒤 비교하는 문제다. 단어 단위 타임스탬프 + VAD가 포함된 **WhisperX**가 현재 이 용도로 자주 쓰이는 도구로 확인됨.

**결론**: #7(자막 존재 여부)·#9(자막 커버리지)는 "ffprobe로 트랙 확인 + OCR로 burned-in 확인"의 2단 구조로 재설계해야 하고, #8(자막-음성 싱크)은 여기에 STT/VAD 정렬까지 얹는 추가 단계이므로 세 항목 중 가장 비용이 크다.

**출처**
- [Mux — Extracting subtitles and captions from video files with FFmpeg](https://www.mux.com/articles/extracting-subtitles-and-captions-from-video-files-with-ffmpeg)
- [Video Intelligence API — Text Detection](https://docs.cloud.google.com/video-intelligence/docs/feature-text-detection)
- [Cloud Vision API Pricing](https://cloud.google.com/vision/pricing)
- [CLOVA OCR overview](https://guide.ncloud-docs.com/docs/en/clovaocr-overview)
- [PaddleOCR Korean support — GitHub Discussion #15371](https://github.com/PaddlePaddle/PaddleOCR/discussions/15371)
- [VideOCR (GitHub)](https://github.com/timminator/VideOCR)
- [WhisperX 2026 가이드](https://localaimaster.com/blog/whisperx-guide)

---

## 2. `freezedetect` ≠ "정적/무편집 구간"

**문제**: freezedetect는 프레임이 거의 완전히 멈춘 경우만 잡는다. 사람이 조금씩 움직이거나 게임 메뉴에서 커서만 움직이는, 사람이 보기엔 지루한데 픽셀은 계속 바뀌는 구간은 감지하지 못한다.

**검증 결과**: 이 우려는 정확하다. FFmpeg 자체에 "저모션 지속 구간"을 위한 필터는 없지만, 다음 신호들을 조합해서 만들 수 있다.
- `signalstats`가 프레임별로 `YDIF/UDIF/VDIF`(직전 프레임 대비 평균 픽셀 변화량)를 뽑아준다 — 별도 필터 없이 바로 쓸 수 있는 연속값.
- `scdet`이 계산하는 MAFD(Mean Absolute Frame Difference)도 사실상 같은 신호이며, 임계값을 낮추거나 `sc_pass=1`로 두면 컷 감지가 아니라 원시 변화량 시계열로 쓸 수 있다.
- `tblend=all_mode=difference` + `signalstats` 조합은 변화의 공간적 분포까지 볼 수 있지만 프레임마다 차분 영상을 렌더링해야 해서 더 무겁다.
- SSIM(구조적 유사도)은 사람이 느끼는 "달라 보임"과 더 잘 맞지만 연산 비용이 더 크다.

**실제 사용 사례**: DaVinci Resolve의 "Boring Detector"는 컷이 일정 시간(기본 45초) 이상 없으면 단순 편집 타이밍만으로 지루한 구간을 잡는다. 커뮤니티 도구(`class-proxima/FFmpeg-Motion-Detection`)는 변화량 신호에 5~10초 슬라이딩 윈도우와 히스테리시스(짧게 움직임이 돌아오면 취소)를 적용하는 방식을 쓴다. 즉 "freezedetect + 연속 변화량 신호(윈도우 평균)"라는 2-신호 설계는 실제로 업계에서 쓰이는 정상적인 패턴이다.

**결론**: #3(정적 화면 구간)은 freezedetect(완전 정지 감지) OR 변화량-윈도우-임계값(저모션 지속 감지) 두 신호를 함께 쓰는 것으로 재설계.

**출처**
- [freezedetect — FFmpeg 필터 문서](https://ayosec.github.io/ffmpeg-filters-docs/8.0/Filters/Video/freezedetect.html)
- [Frame differencing with FFmpeg](https://www.arj.no/2022/01/09/frame-differencing-with-ffmpeg/)
- [class-proxima/FFmpeg-Motion-Detection](https://github.com/class-proxima/FFmpeg-Motion-Detection)
- [DaVinci Resolve Boring Detector 설명](https://photography.tutsplus.com/articles/what-is-the-davinci-resolve-boring-detector-and-how-to-use-it--cms-108010)

---

## 3. `scdet`의 scene change ≠ 실제 편집 컷 (게임 영상에서 특히)

**문제**: 게임 카메라의 빠른 패닝, 폭발/플래시, 화면 전환은 편집을 안 했어도 scene change로 잡힐 수 있다.

**검증 결과**: 이건 FFmpeg만의 문제가 아니라 shot-boundary-detection(SBD) 분야에서 20년 넘게 알려진 미해결 문제다.
- PySceneDetect(비슷한 원리를 쓰는 널리 쓰이는 도구)에 정확히 이 문제로 등록된 이슈가 있다: 플래시/스트로브로 인한 오탐(#35, 미해결로 마일스톤에 등록), 카메라 이동으로 인한 오탐(#153, "고정 임계값으로는 진짜 컷과 카메라 이동을 구분 못 함").
- 2018년 MDPI *Entropy* 리뷰와 2024년 Springer 리뷰 모두 "플래시, 카메라 팬/줌/틸트"를 SBD 오탐의 주요 원인으로 명시하며, "효율적인 전환 감지 방법은 아직 없다"고 결론 내린다.
- 완화 방법: (a) 변화가 N프레임 이상 유지되어야 컷으로 인정(순간 플래시 제거), (b) 고정 임계값 대신 주변 구간 평균 대비 상대적 크기로 판단, (c) 모션 보정 후 차분, (d) 오디오 편집 지점과의 교차 검증(GSoC 2022 프로젝트가 시각+오디오 융합으로 오탐을 줄인 사례).

**결론**: #4는 "편집 컷 수"라고 단정하지 말고 "시각적 변화 빈도"로 표현하며, 특히 게임 장르에는 신뢰도 캐비어트를 명시한다. 실제 컷 수를 주장하려면 최소 지속시간 필터 + 실제 샘플 영상 검증이 선행되어야 한다.

**출처**
- [PySceneDetect #35 — Light Flash/Strobe Suppression](https://github.com/Breakthrough/PySceneDetect/issues/35)
- [PySceneDetect #153 — False positives from camera movement](https://github.com/Breakthrough/PySceneDetect/issues/153)
- [Methods and Challenges in Shot Boundary Detection: A Review (MDPI Entropy, 2018)](https://www.mdpi.com/1099-4300/20/4/214)
- [Video shot-boundary detection: issues, challenges and solutions (Springer, 2024)](https://link.springer.com/article/10.1007/s10462-024-10742-1)
- [GSoC 2022 — Film Edit Detection (오디오-비주얼 융합)](https://medium.com/@apapoudakis/film-edit-detection-gsoc-2022-228edd3cefc6)

---

## 4. 최종 믹스 오디오에서 BGM/게임사운드/음성 분리는 FFmpeg만으로 불가능

**문제**: 최종 MP4는 오디오가 이미 한 트랙으로 섞여 있다. `ebur128`은 전체 음량만 알려줄 뿐 "무엇이 목소리를 가리고 있는지"는 모른다.

**검증 결과**:
- **Demucs**(Meta) — 가장 널리 쓰이는 오픈소스 분리 모델이지만 2025년 1월 원 저장소가 아카이브됨(포크에서 버그 수정만 유지). 보컬/드럼/베이스/기타로 분리하는 **음악 전용 모델**이라, 게임 SFX·UI 사운드처럼 음악이 아닌 소리를 넣으면 분리 품질이 보장되지 않는다.
- **Spleeter**는 2026년 기준 사실상 Demucs로 대체된 상태로 평가됨.
- **LALAL.AI**(분당 과금), **AudioShake**(대사 분리에 특화, 영화/방송 로컬라이제이션용) — 둘 다 API로 쓸 수 있지만 게임 콘텐츠용으로 검증된 바 없고, AudioShake는 엔터프라이즈 단가.
- 결론적으로 "보이스 vs 게임사운드"를 분리하도록 학습된 모델은 존재하지 않는다 — 있는 도구를 학습 분포 밖의 용도로 쓰는 셈이라 품질을 신뢰하기 어렵다.
- 대안(더 저렴하고 정직한 방법): STT/VAD로 발화 구간을 특정한 뒤, 그 구간 안에서 배경 음량/에너지(`ebur128`, 스펙트럼 에너지)를 다른 구간과 비교해 "이 구간은 다른 구간보다 배경음이 상대적으로 높다"까지만 판단한다. "무엇이 원인인지"는 주장하지 않는다.

**결론**: V1에서는 완전한 소스 분리를 넣지 않는다. 게임 장르 기준의 오디오 밸런스 항목은 "대사 구간에서 전체 배경음이 상대적으로 높게 감지되는 구간"으로 범위를 낮춘다.

**출처**
- [facebookresearch/demucs (archived)](https://github.com/facebookresearch/demucs)
- [Spleeter vs Demucs 2026 비교](https://stemsplit.io/blog/spleeter-vs-demucs)
- [AudioShake — dialogue separation](https://www.audioshake.ai/post/audioshake-launches-latest-dialogue-separation-model)
- [LALAL.AI 가격](https://www.lalal.ai/pricing/)

---

## 5. 클라이언트 WebCodecs 다운스케일을 V1 필수 전제로 두면 위험

**검증 결과**:
- Chromium(Chrome/Edge)에서는 WebCodecs가 안정적이지만, **Firefox는 데스크톱 지원이 2024년 9월(Firefox 130)부터**라 상대적으로 최근이고, **Safari/WebKit은 iOS의 모든 브라우저(사파리로 위장한 크롬/파이어폭스 포함)에 강제 적용**되므로 WebKit 쪽 문제가 생기면 iOS 사용자 전체가 영향받는다.
- 하드웨어 인코더 지원 여부가 기기별로 달라 저사양 기기에서는 소프트웨어 인코딩으로 자동 전환되며, 20~30분 1080p 영상 기준 매우 느려질 수 있다(배터리 소모 포함).
- `VideoFrame`은 수동으로 `close()`해야 하는 네이티브 메모리라 흔한 실수 지점이고, iOS Safari는 메모리 초과 시 탭을 강제 종료할 수 있어 긴 인코딩 작업의 완주를 보장할 수 없다.
- 결론적으로, 지원 안 되는 브라우저/기기를 위한 "원본 그대로 업로드" 폴백은 **어차피 만들어야 한다** — 그렇다면 V1에서는 그 폴백을 유일한 경로로 삼는 것이 합리적이다.
- 대안: 원본을 (적절한 길이/용량 제한과 함께) 그대로 업로드받고, Cloud Run에서 FFmpeg로 "분석용 프록시"를 서버에서 생성한다. Google Cloud Run 공식 문서에도 Storage 이벤트로 트리거되는 FFmpeg 트랜스코딩 작업 패턴이 나와 있다.
- OCR 정확도를 위한 해상도 하한은 컨테이너 해상도가 아니라 **글자 높이(픽셀)** 기준으로 정해야 한다 — 실제 예능 자막 샘플로 실측 필요. 필요하면 자막 인식용 패스는 더 높은 해상도(또는 자막 영역 크롭)를 별도로 사용할 수 있다.

**결론**: V1은 클라이언트 다운스케일을 요구하지 않는다. 업로드는 (용량/길이 제한 + TUS 재개 가능 업로드로) 원본을 그대로 받고, 프록시 생성은 서버(Cloud Run)에서 한다.

**출처**
- [Firefox 130 WebCodecs 데스크톱 지원](https://www.phoronix.com/news/Firefox-130)
- [MDN — WebCodecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)
- [GPU-accelerated video transcoding with FFmpeg on Cloud Run jobs](https://docs.cloud.google.com/run/docs/tutorials/video-encoding)
- [OCR을 위한 권장 문자 높이(픽셀)](https://nuance.custhelp.com/app/answers/detail/a_id/6346/~/recommended-height-(in-pixels)-of-characters-for-optimal-ocr)

---

## 6. DB webhook → Cloud Run 직접 실행 대신 Queue 기반 idempotent worker

**검증 결과**:
- Google이 권장하는 패턴은 이벤트 소스가 Cloud Run을 직접 부르지 않고 **Cloud Tasks에 작업을 큐잉**하는 것이다. Cloud Tasks가 서비스 계정의 OIDC 토큰으로 Cloud Run을 호출하며, 큐 레벨에서 `max_attempts`/`min_backoff`/`max_backoff` 등 재시도 정책을 설정한다.
- Cloud Tasks는 **2xx 응답만 성공으로 간주**하고, 그 외(4xx/5xx, 타임아웃)는 재시도한다. "at-least-once" 배달이므로 작업이 실제로는 끝났는데 응답만 유실된 경우에도 재시도가 온다 — 그래서 idempotency는 선택이 아니라 필수다.
- "영상 하나를 끝까지 처리"하는 작업 특성상 **Cloud Run Jobs**(요청-응답 모델이 아닌 컨테이너 실행형)가 Cloud Run Service보다 더 자연스럽다. 다만 Cloud Tasks의 HTTP 타겟은 Job을 직접 못 부르므로 (a) Cloud Tasks → 얇은 Cloud Run 서비스 → Cloud Run Admin API로 Job 실행, 또는 (b) Cloud Tasks 없이 Eventarc/Workflows로 Storage 이벤트에서 바로 Job 트리거, 둘 중 하나로 구성한다.
- **idempotency 실제 구현**: 큐 레벨에서는 결정적 task 이름(`video-{videoId}`)으로 완화하고, 진짜 안전장치는 DB 레벨의 compare-and-swap이다 — `UPDATE video_analyses SET status='processing', started_at=now() WHERE id=$1 AND status='pending'` 실행 후 영향받은 행이 없으면 즉시 200을 반환하고 재처리하지 않는다. 워커가 중간에 죽는 경우를 위해 "processing 상태가 너무 오래 지속되면 회수" 하는 stale-lock 타임아웃도 필요하다. 결과 저장도 `video_id` 기준 upsert로 멱등하게 만든다.
- 비용: Cloud Tasks는 MVP 수준(월 수백 건)에서 사실상 무료. Cloud Run도 무료 티어 안에 들어올 가능성이 높다. 실제 비용은 GCP 인프라가 아니라 STT/AI API 호출 쪽에서 더 크게 발생할 것으로 예상됨(정확한 수치는 STEP 4-0에서 재계산).

**결론**: `업로드 완료 → video_analyses 생성(status=pending) → Cloud Tasks 큐잉 → Cloud Run Job 실행(idempotent, DB compare-and-swap) → 결과 upsert`.

**출처**
- [Create HTTP target tasks — Cloud Tasks docs](https://docs.cloud.google.com/tasks/docs/creating-http-target-tasks)
- [Set retry parameters for a task](https://docs.cloud.google.com/tasks/docs/configure-retry-task)
- [Executing asynchronous tasks — Cloud Run docs](https://docs.cloud.google.com/run/docs/triggering/using-tasks)
- [Execute a Cloud Run job triggered by Storage events (Workflows tutorial)](https://docs.cloud.google.com/workflows/docs/tutorials/execute-cloud-run-jobs-stored-events?hl=en)
- [Cloud Run pricing](https://cloud.google.com/run/pricing) / [Cloud Tasks pricing](https://cloud.google.com/tasks/pricing)

---

## 7. STEP 4-0을 STT 벤치마크에서 4대 기술 feasibility PoC로 확대

위 1~4번 조사 결과, 다음 4개 기술 요소가 모두 "이론적으로는 가능하지만 정확도/비용이 검증 안 된" 상태다: 한국어 STT, burned-in 자막 OCR, 장르별 scene detection, 정적 화면 탐지. 이 중 하나라도 실사용 수준에 못 미치면 해당 피드백 항목 자체를 빼거나 범위를 다시 낮춰야 하므로, DB/코드를 만들기 전에 4개를 함께 검증하는 것이 맞다. (세부 내용은 개정된 V1 계획 문서의 STEP 4-0 항목 참고.)

---

## 8. 재시도/실패 처리 전략

6번 조사에서 확인한 idempotency 요구사항을 DB 스키마에 직접 반영해야 한다: `status`(pending/processing/completed/failed), `current_stage`(진행 단계 표시), `started_at`(stale-lock 판정용), `error_code`/`error_message`(실패 원인 구분 및 재시도 가능 여부 판단), `pipeline_version`(분석 로직이 바뀌었을 때 과거 결과와 구분). 세부 내용은 개정된 V1 계획 문서의 DB 섹션 참고.

---

## 9. 업로드 검증/보안/보관 정책 (Supabase Storage)

**검증 결과**:
- 비공개 버킷(`public: false`) + 경로에 `auth.uid()`를 prefix로 강제(`videos/{uid}/{uuid}.mp4`) + `storage.objects` 테이블에 RLS 정책(`storage.foldername(name)` 헬퍼로 경로의 첫 세그먼트가 본인 UID인지 확인)을 거는 것이 공식 권장 패턴이다. 이 방식이 성립하려면 업로드용 signed URL을 발급받을 때 클라이언트가 **사용자 JWT**로 호출해야 하며(service_role 키 아님), 그래야 RLS가 실제로 평가된다.
- 일반 signed upload URL/단순 `upload()` 경로는 몇 MB 수준에서 실패 사례가 보고되어 있어(공식 트러블슈팅 문서, GitHub 이슈) 우리 영상 크기(수백 MB~수 GB)에는 맞지 않는다. **TUS 프로토콜 기반 재개 가능 업로드**가 정식 지원되며 최대 50GB(이후 릴리스에서 더 상향)까지 지원한다고 확인됨 — `tus-js-client`/Uppy로 구현. 버킷에 `allowed_mime_types`(video/mp4)와 `file_size_limit`도 설정 가능.
- 백엔드(Cloud Run 워커)는 `service_role` 키(서버 전용 비밀값)로 RLS를 우회해 읽거나, 워커용으로 범위가 좁은 단기 signed URL을 발급하는 방식 중 하나를 쓴다.
- **보관/삭제 정책은 Supabase에 내장 기능이 없다.** "만료 오브젝트" 기능은 아직 논의 중인 요청 사항일 뿐 실제 기능이 아니다. `pg_cron` 또는 예약 실행되는 Edge Function으로 오브젝트 나이/`processed_at`을 확인해 직접 삭제하는 방식이 현재의 표준 구현이다.

**결론**: 업로드는 TUS 재개형으로, 경로는 `videos/{uid}/{uuid}.mp4` + RLS로 소유권 강제, 최대 길이/용량/MIME은 버킷 설정과 업로드 폼 양쪽에서 검증, 백엔드는 service_role 또는 단기 signed URL로 읽기, 삭제는 pg_cron 기반 자체 구현.

**출처**
- [Storage Access Control](https://supabase.com/docs/guides/storage/security/access-control)
- [Storage Ownership](https://supabase.com/docs/guides/storage/security/ownership)
- [Resumable Uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)
- [Storage v3: Resumable Uploads with support for 50GB files](https://supabase.com/blog/storage-v3-resumable-uploads)
- [Expiring objects — GitHub Discussion #20171 (미구현, 요청 상태)](https://github.com/orgs/supabase/discussions/20171)

---

## 조사 방법에 대한 메모

일부 항목(Video Intelligence 정확한 분당 단가, WebCodecs의 최신 상세 호환성 수치)은 이번 조사 중 웹 조회 도구의 세션 한도에 걸려 원문 페이지 전체를 확인하지 못했다. 해당 부분은 본문에 "확인 필요"로 명시해 두었고, 구현 직전 공식 문서에서 재확인이 필요하다. 이는 이미 승인된 원칙(비용 수치는 구현 직전에 재계산)과 일치한다.
