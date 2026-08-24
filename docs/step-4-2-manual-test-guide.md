# STEP 4-2 수동 검증 가이드 (staging, 실제 브라우저)

이 문서는 이 세션(Claude)에 Chrome 확장이 연결되어 있지 않아 직접 브라우저 테스트를
실행할 수 없기 때문에, 사용자가 로컬에서 직접 돌려볼 수 있도록 작성한 체크리스트입니다.
결과를 알려주시면 그걸 바탕으로 최종 STEP 4-2 보고서(원인 분석 포함)를 작성합니다.

## 0. 준비

```bash
cd C:\Users\joonr\Desktop\youtube-planner
npm install          # tus-js-client 새로 추가됨
```

`.env.local`은 원격 도구 정책상 자동으로 덮어쓸 수 없어서 파일로만 전달했습니다.
**전달받은 `.env.local` 파일 내용으로 로컬 파일을 직접 교체**해주세요 (staging
프로젝트를 가리키고, `NEXT_PUBLIC_ENABLE_DEV_LOGIN=true`가 켜져 있어야 합니다).
프로덕션 값은 그 파일 하단에 주석으로 남겨뒀습니다 — 검증이 끝나면 그걸로 되돌리면 됩니다.

```bash
npm run dev
```

브라우저에서 `http://localhost:3000/login` 접속 → 노란 박스로 표시된
"STEP 4-2 staging 검증 전용 로그인"에 아래 계정으로 로그인:

- 이메일: `step42-tester@youtube-planner.test`
- 비밀번호: `Step42-Test-Pass!9`

(이 계정은 staging DB에 `onboarding_completed=true` + 채널 1개까지 미리 만들어뒀습니다.
로그인하면 온보딩 화면 없이 바로 `/dashboard`로 갑니다.)

테스트용 MP4는 50MB 미만이어야 합니다 (Free plan). 짧은 mp4 아무거나 사용하시면 됩니다.

## 1. 최소 vertical slice 10단계 (메인 플로우)

`http://localhost:3000/upload` 로 이동해서:

1. 로그인된 상태인지 (이미 됨)
2. MP4 파일을 드래그하거나 "파일 선택"으로 고르기 — 파일명/크기가 화면에 보이는지
3. "업로드 시작" 클릭 → 네트워크 탭에서 `create_video_analysis` RPC 호출이 나가는지
4. 반환된 `storage_path`로 업로드가 시작되는지 (진행률 바가 올라가기 시작하면 OK)
5. 실제 TUS 업로드가 되는지 — 네트워크 탭에서 `PATCH .../storage/v1/upload/resumable/...` 요청들이 보이면 OK
6. 진행률 %가 실시간으로 올라가는지
7. 업로드 중 "일시정지" 클릭 → 멈추는지, "이어서 업로드" 클릭 → 0%부터 다시가 아니라 멈춘 지점부터 이어지는지 (진행률 %가 뒤로 가지 않아야 함)
8. 업로드가 끝나면 자동으로 "업로드 확인 중..." → "완료" 카드로 바뀌는지
9. "완료" 카드에 `DB status: uploaded`로 나오는지
10. 실패를 재현하려면: 업로드 도중 Wi-Fi를 잠깐 끄거나 개발자도구 Network 탭에서 요청을 몇 개 차단(block request)해서 강제로 에러를 내보세요 → "재시도" 버튼이 뜨는지, 눌렀을 때 처음부터가 아니라 이어서 업로드되는지

각 단계마다 성공/실패와, 실패했다면 화면에 뜨는 에러 메시지 + 브라우저 콘솔/네트워크 탭에 찍힌 실제 HTTP status/에러 본문을 그대로 알려주세요.

## 2. STEP 4-1에서 미검증으로 남은 항목 (Storage API 레벨)

`/upload`에서 이미 한 번 업로드+완료까지 마친 뒹, 완료 카드에 표시된 `storage_path`
값을 복사해두세요 (예: `<user_id>/<analysis_id>/original.mp4` 형태일 것입니다).

브라우저 개발자도구(F12) → Console 탭에서 아래 스크립트를 실행합니다.
(`/upload` 페이지가 staging 환경에서 로드된 상태여야 `window.__stagingDebug`가 존재합니다.)

```js
async function tusCreate(objectName, bytes) {
  const token = await window.__stagingDebug.getAccessToken();
  const metadata = {
    bucketName: "videos",
    objectName,
    contentType: "video/mp4",
    cacheControl: "3600",
  };
  const metaHeader = Object.entries(metadata)
    .map(([k, v]) => `${k} ${btoa(v)}`)
    .join(",");
  const res = await fetch(`${window.__stagingDebug.supabaseUrl}/storage/v1/upload/resumable`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      apikey: window.__stagingDebug.apikey,
      "tus-resumable": "1.0.0",
      "upload-length": String(bytes),
      "upload-metadata": metaHeader,
      // x-upsert 헤더는 절대 넣지 않습니다.
    },
  });
  console.log("status:", res.status);
  console.log("body:", await res.text());
  console.log("location header:", res.headers.get("location"));
}
```

### 2-1. 동일 경로 재업로드 차단 / overwrite 차단

이미 업로드가 끝난 `storage_path`로 다시 창조(create) 요청을 보내봅니다:

```js
await tusCreate("<완료 카드에서 복사한 storage_path>", 12345);
```

**기대 결과**: `400` (이미 존재하는 오브젝트) 이 나와야 합니다. `x-upsert`를 안 보냈으므로
overwrite 없이 거부되어야 합니다. 만약 `200`/`201`이 나오고 실제로 덮어써진다면 —
이건 STEP 4-1에서 발견한 "storage-api가 `(bucket_id,name)` 유니크 제약 없이 자체
existence-check로만 막는다"는 가정이 실제로는 깨져 있다는 뜻이라, 원인을 봐야 합니다.

### 2-2. 다른 사용자 경로 차단 (cross-user)

같은 스크립트로, 존재하지 않는 **다른 user_id** 경로를 시도합니다 (예:
`00000000-0000-0000-0000-000000000001/fake/original.mp4`):

```js
await tusCreate("00000000-0000-0000-0000-000000000001/fake/original.mp4", 12345);
```

**기대 결과**: `403` (RLS가 막음). `location` 헤더 없이 에러만 나와야 합니다.

### 2-3. 완료 후 SELECT 차단

같은 콘솔에서:

```js
const token = await window.__stagingDebug.getAccessToken();
const res = await fetch(
  `${window.__stagingDebug.supabaseUrl}/storage/v1/object/info/videos/<완료 카드에서 복사한 storage_path>`,
  { headers: { authorization: `Bearer ${token}`, apikey: window.__stagingDebug.apikey } },
);
console.log(res.status, await res.text());
```

**기대 결과**: `400`/`403`/`404` 중 하나 — 업로드가 끝난 뒤에는 `video_objects_select_own_while_pending`
정책이 더 이상 SELECT를 허용하지 않아야 합니다 (0002 RLS 정책 참고). `200`과 함께
오브젝트 메타데이터가 보이면 이건 실제 문제이니 알려주세요.

## 3. 결과를 알려주실 때

아래 형식이면 제가 바로 보고서로 정리할 수 있습니다.

- 1장 10단계: 몇 번까지 성공했는지, 실패한 단계와 에러 내용
- 2-1/2-2/2-3: 각각 나온 HTTP status + 응답 본문
- 콘솔에 다른 에러가 있었다면 그것도 같이

## 4. 끝나면

- `.env.local`을 production 값으로 되돌리세요 (파일 안 주석 참고).
- 검증이 끝났다면 `NEXT_PUBLIC_ENABLE_DEV_LOGIN`을 지우거나 `false`로 바꿔서
  dev 로그인 폼과 `window.__stagingDebug`가 더 이상 노출되지 않게 해주세요.
