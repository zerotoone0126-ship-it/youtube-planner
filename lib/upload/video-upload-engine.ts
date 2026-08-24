/**
 * lib/upload/video-upload-engine.ts
 *
 * TUS resumable upload를 감싸는 상태 머신입니다. React를 전혀 모릅니다 —
 * UI(components/upload/video-upload.tsx)와 분리해두는 이유는, 나중에 디자인을
 * 통째로 갈아엎어도(또는 다른 화면에서 재사용해도) 이 파일은 그대로 두면
 * 되게 하기 위해서입니다.
 *
 * Supabase 공식 문서(guides/storage/uploads/resumable-uploads)의 tus-js-client
 * 예제와 동일한 방식입니다:
 *   - endpoint: `${supabaseUrl}/storage/v1/upload/resumable`
 *   - headers: Authorization(사용자 세션 토큰) + apikey
 *   - metadata: bucketName / objectName / contentType
 *   - chunkSize: 6MB 고정 (문서: "it must be set to 6MB (for now)")
 *   - uploadDataDuringCreation: true, removeFingerprintOnSuccess: true
 *
 * ⚠️ `x-upsert` 헤더는 절대 넣지 않습니다 (2026-08-24 지시 — V1은 덮어쓰기를
 * 쓰지 않고, storage.objects에 UPDATE RLS 정책 자체가 없습니다. x-upsert를
 * 보내면 서버가 기존 오브젝트를 덮어쓰려 시도하다가 RLS에 막혀 실패하거나,
 * 의도와 다른 동작을 할 수 있습니다).
 *
 * pause/resume: tus-js-client는 파일 내용 + 메타데이터로 계산한 fingerprint를
 * 브라우저 저장소에 남겨둡니다. abort() 후 같은 파일로 다시 start()하면
 * findPreviousUploads()가 그 fingerprint를 찾아 이어서 올립니다 — 이 파일의
 * pause()/resume()과 "실패 후 재시도"가 내부적으로 같은 메커니즘을 씁니다.
 */

import * as tus from "tus-js-client";

export type UploadStatus = "idle" | "creating" | "uploading" | "paused" | "confirming" | "success" | "error";

export type UploadEngineState = {
  status: UploadStatus;
  bytesUploaded: number;
  bytesTotal: number;
  /** 사용자에게 보여줄 한 줄 에러 메시지. status가 "error"일 때만 값이 있습니다. */
  errorMessage: string | null;
};

export type StartUploadArgs = {
  file: File;
  /** create_video_analysis()가 돌려준 storage_path — 결정적 경로이므로 그대로 씁니다. */
  objectName: string;
  bucketName: string;
  supabaseUrl: string;
  /** 브라우저 세션의 access token. supabase.auth.getSession()에서 얻습니다. */
  accessToken: string;
  apikey: string;
};

const INITIAL_STATE: UploadEngineState = {
  status: "idle",
  bytesUploaded: 0,
  bytesTotal: 0,
  errorMessage: null,
};

/** tus-js-client가 주는 에러를 사람이 읽을 메시지로 바꿉니다. */
function toReadableError(error: Error | tus.DetailedError): string {
  const withResponse = error as tus.DetailedError;
  const status = withResponse.originalResponse?.getStatus?.();

  if (status === 403) {
    return "이 경로에 업로드할 권한이 없습니다. 다른 사용자의 파일이거나 로그인이 만료되었을 수 있어요.";
  }
  if (status === 400) {
    return "이미 업로드된 파일입니다. 같은 영상을 다시 업로드할 수 없어요.";
  }
  if (status === 409) {
    return "다른 업로드와 충돌했습니다. 잠시 후 다시 시도해주세요.";
  }
  return error.message || "업로드 중 오류가 발생했습니다.";
}

export class VideoUploadEngine {
  private upload: tus.Upload | null = null;
  private state: UploadEngineState = { ...INITIAL_STATE };

  constructor(private readonly onStateChange: (state: UploadEngineState) => void) {}

  getState(): UploadEngineState {
    return this.state;
  }

  private setState(patch: Partial<UploadEngineState>) {
    this.state = { ...this.state, ...patch };
    this.onStateChange(this.state);
  }

  start(args: StartUploadArgs) {
    this.setState({
      status: "uploading",
      bytesTotal: args.file.size,
      bytesUploaded: 0,
      errorMessage: null,
    });

    const upload = new tus.Upload(args.file, {
      endpoint: `${args.supabaseUrl}/storage/v1/upload/resumable`,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      headers: {
        authorization: `Bearer ${args.accessToken}`,
        apikey: args.apikey,
        // x-upsert 없음 — 의도적입니다. 위 파일 주석 참고.
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: args.bucketName,
        objectName: args.objectName,
        contentType: args.file.type || "video/mp4",
        cacheControl: "3600",
      },
      chunkSize: 6 * 1024 * 1024,
      onError: (error) => {
        this.setState({ status: "error", errorMessage: toReadableError(error) });
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        this.setState({ bytesUploaded, bytesTotal });
      },
      onSuccess: () => {
        this.setState({ status: "success", bytesUploaded: args.file.size });
      },
    });

    this.upload = upload;

    upload
      .findPreviousUploads()
      .then((previousUploads) => {
        if (previousUploads.length > 0) {
          upload.resumeFromPreviousUpload(previousUploads[0]);
        }
        upload.start();
      })
      .catch((error: Error) => {
        this.setState({ status: "error", errorMessage: toReadableError(error) });
      });
  }

  /** 업로드를 일시 중지합니다. tus 서버에는 이미 전송된 청크가 그대로 남아있습니다. */
  pause() {
    if (!this.upload) return;
    this.upload.abort();
    this.setState({ status: "paused" });
  }

  /** 중지된 업로드를 이어서 진행합니다 — 처음부터 다시 올리지 않습니다. */
  resume() {
    if (!this.upload) return;
    this.setState({ status: "uploading", errorMessage: null });
    this.upload.start();
  }

  /**
   * 실패 후 재시도. 같은 File 객체로 다시 start()를 호출하면 fingerprint가
   * 같아 findPreviousUploads()가 이전 진행분을 찾아 이어서 올립니다 —
   * 처음부터 다시 올리는 게 아닙니다.
   */
  retry(args: StartUploadArgs) {
    this.start(args);
  }

  /** 업로드를 완전히 취소합니다 (서버의 임시 업로드 URL도 함께 정리 시도). */
  cancel() {
    if (this.upload) {
      this.upload.abort(true).catch(() => {
        // 취소 중 네트워크 오류는 무시합니다 — 사용자 입장에서는 어차피 취소된 것으로 보여줍니다.
      });
    }
    this.upload = null;
    this.setState({ ...INITIAL_STATE });
  }

  reset() {
    this.upload = null;
    this.setState({ ...INITIAL_STATE });
  }
}
