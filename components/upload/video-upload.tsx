/**
 * components/upload/video-upload.tsx
 *
 * STEP 4-2 vertical slice UI. 요청받은 최소 요구사항만 담습니다:
 * 드래그앤드롭/파일 선택, 파일명, 파일 크기, 업로드 %, 업로드 중 상태,
 * 실패 메시지, 재시도, 취소. 디자인은 다음에 언제든 바꿀 수 있도록
 * 실제 업로드 로직(lib/upload/video-upload-engine.ts)과 분리했습니다 —
 * 이 컴포넌트는 그 엔진을 "구독"만 하고, TUS/재시도/취소의 실제 동작은
 * 전혀 알지 못합니다.
 *
 * genre 선택은 이 vertical slice를 실행하기 위한 최소 입력일 뿐입니다
 * (video_analyses.genre가 not null이라 뭔가는 넘겨야 합니다) — 실제 genre
 * 선택 UI/온보딩 연동은 이번 STEP 범위가 아닙니다.
 */

"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { createVideoAnalysis, confirmVideoUploaded, cancelVideoAnalysis } from "@/lib/actions/video-analyses";
import { validateVideoFile } from "@/lib/validations/video-upload";
import { formatBytes, MAX_UPLOAD_BYTES } from "@/lib/upload/constants";
import { VideoUploadEngine, type UploadEngineState } from "@/lib/upload/video-upload-engine";
import {
  VIDEO_ANALYSIS_GENRES,
  VIDEO_ANALYSIS_GENRE_LABEL,
  type VideoAnalysis,
  type VideoAnalysisGenre,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, Upload as UploadIcon, X } from "lucide-react";

type Phase = "idle" | "uploading" | "confirming" | "done";

const STATUS_LABEL: Record<UploadEngineState["status"], string> = {
  idle: "대기 중",
  creating: "분석 생성 중...",
  uploading: "업로드 중",
  paused: "일시정지됨",
  confirming: "업로드 확인 중...",
  success: "업로드 완료 — 확인 중...",
  error: "실패",
};

export function VideoUpload({ channelId }: { channelId?: string | null }) {
  const [genre, setGenre] = useState<VideoAnalysisGenre>(VIDEO_ANALYSIS_GENRES[0]);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [clientRequestId, setClientRequestId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<VideoAnalysis | null>(null);
  const [confirmed, setConfirmed] = useState<VideoAnalysis | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [queueStatus, setQueueStatus] = useState<"idle" | "queuing" | "queued" | "error">("idle");
  const [queueErrorMessage, setQueueErrorMessage] = useState<string | null>(null);
  const [engineState, setEngineState] = useState<UploadEngineState>({
    status: "idle",
    bytesUploaded: 0,
    bytesTotal: 0,
    errorMessage: null,
  });
  const [isDragging, setIsDragging] = useState(false);

  const engineRef = useRef<VideoUploadEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new VideoUploadEngine(setEngineState);
  }

  // STEP 4-2 staging 검증 전용 디버그 훅. NEXT_PUBLIC_ENABLE_DEV_LOGIN=true일 때만
  // (즉 staging에서만) window에 붙습니다. 브라우저 콘솔에서 duplicate-path/overwrite
  // 차단처럼 UI만으로는 트리거하기 어려운 Storage API 레벨 테스트를 수동으로
  // 돌려보기 위한 것입니다 — production에서는 이 블록 자체가 실행되지 않습니다.
  // (docs/step-4-2-manual-test-guide.md 참고)
  if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN === "true") {
    (window as unknown as { __stagingDebug?: unknown }).__stagingDebug = {
      getAccessToken: async () => {
        const { data } = await createClient().auth.getSession();
        return data.session?.access_token ?? null;
      },
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    };
  }

  function phaseOf(): Phase {
    if (engineState.status === "idle" && !analysis) return "idle";
    if (confirmed) return "done";
    if (engineState.status === "success" || engineState.status === "confirming") return "confirming";
    return "uploading";
  }
  const phase = phaseOf();

  function pickFile(candidate: File | null) {
    setServerError(null);
    setAnalysis(null);
    setConfirmed(null);
    engineRef.current?.reset();

    if (!candidate) {
      setFile(null);
      setFileError(null);
      return;
    }

    const result = validateVideoFile(candidate);
    if (!result.ok) {
      setFile(null);
      setFileError(result.message);
      return;
    }

    setFile(candidate);
    setFileError(null);
    // 새 파일을 고를 때만 새 client_request_id를 만듭니다.
    // 같은 파일로 재시도하는 동안은 이 값을 그대로 재사용해야 create_video_analysis가
    // 새 행을 만들지 않고 기존 행을 돌려줍니다.
    setClientRequestId(crypto.randomUUID());
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const dropped = event.dataTransfer.files?.[0] ?? null;
    pickFile(dropped);
  }

  async function startUpload() {
    if (!file || !clientRequestId) return;
    setServerError(null);

    const createResult = await createVideoAnalysis({
      genre,
      channelId: channelId ?? null,
      clientRequestId,
    });

    if (createResult.error) {
      setServerError(createResult.error.message);
      return;
    }

    const created = createResult.data as unknown as VideoAnalysis;
    setAnalysis(created);

    const supabase = createClient();
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    if (sessionError || !accessToken) {
      setServerError("로그인 세션을 확인할 수 없습니다. 새로고침 후 다시 로그인해주세요.");
      return;
    }

    engineRef.current!.start({
      file,
      objectName: created.storage_path,
      bucketName: "videos",
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      accessToken,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    });
  }

  // engineState.status가 "success"로 바뀌면 자동으로 업로드 완료 확인 RPC를
  // 호출합니다. useEffect + ref 가드로 처리합니다 — status가 "success"인 동안
  // 다른 이유로 리렌더가 일어나도(예: 부모 리렌더) confirm이 중복 호출되지
  // 않도록, analysis.id 단위로 "이미 confirm을 시작했는지"를 기억합니다.
  const confirmStartedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (engineState.status !== "success" || !analysis || confirmed) return;
    if (confirmStartedForRef.current === analysis.id) return;
    confirmStartedForRef.current = analysis.id;

    let cancelled = false;
    (async () => {
      const confirmResult = await confirmVideoUploaded(analysis.id);
      if (cancelled) return;
      if (confirmResult.error) {
        setServerError(confirmResult.error.message);
        // 실패하면 다시 시도할 수 있도록 가드를 풀어둡니다.
        confirmStartedForRef.current = null;
        return;
      }
      setConfirmed(confirmResult.data as unknown as VideoAnalysis);
    })();

    return () => {
      cancelled = true;
    };
  }, [engineState.status, analysis, confirmed]);

  /**
   * STEP 4-3A: 업로드 확인(confirmed)이 끝나면 자동으로 큐 등록 API를 호출합니다.
   *
   * ⚠️ POST /api/video-analyses/[id]/queue 호출 실패는 업로드 자체의 실패가
   *    아닙니다 — DB의 video_analyses 행은 이미 "queued" 이거나(0011 적용 후
   *    재시도 시 멱등) 여전히 "uploaded"로 남아 있을 뿐, 업로드된 파일이나
   *    STEP 4-2에서 만든 confirmed 상태를 되돌리지 않습니다. 그래서 이 실패는
   *    serverError(업로드 단계 에러)가 아니라 별도의 queueStatus로 표시하고,
   *    "done" 화면에 재시도 버튼만 추가로 보여줍니다.
   *
   * confirmStartedForRef와 같은 이유로 analysis id 단위 가드를 둡니다 —
   * 리렌더가 여러 번 일어나도(예: React StrictMode) 같은 분석에 대해 큐
   * 등록 요청을 중복으로 보내지 않기 위함입니다.
   */
  const queueStartedForRef = useRef<string | null>(null);

  async function triggerQueue(analysisId: string) {
    setQueueStatus("queuing");
    setQueueErrorMessage(null);
    try {
      const res = await fetch(`/api/video-analyses/${analysisId}/queue`, {
        method: "POST",
      });

      if (res.status === 202) {
        setQueueStatus("queued");
        return;
      }

      const body = await res.json().catch(() => null);
      setQueueStatus("error");
      setQueueErrorMessage(body?.error?.message ?? "분석 큐 등록에 실패했습니다.");
    } catch {
      setQueueStatus("error");
      setQueueErrorMessage("분석 큐 등록에 실패했습니다. 네트워크를 확인해주세요.");
    }
  }

  useEffect(() => {
    if (!confirmed) return;
    if (queueStartedForRef.current === confirmed.id) return;
    queueStartedForRef.current = confirmed.id;
    void triggerQueue(confirmed.id);
  }, [confirmed]);

  function handlePause() {
    engineRef.current?.pause();
  }

  function handleResume() {
    if (!file || !analysis) return;
    const accessTokenPromise = createClient().auth.getSession();
    accessTokenPromise.then(({ data }) => {
      const accessToken = data.session?.access_token;
      if (!accessToken) {
        setServerError("로그인 세션을 확인할 수 없습니다.");
        return;
      }
      engineRef.current!.resume();
    });
  }

  function handleRetry() {
    if (!file || !analysis) return;
    createClient()
      .auth.getSession()
      .then(({ data }) => {
        const accessToken = data.session?.access_token;
        if (!accessToken) {
          setServerError("로그인 세션을 확인할 수 없습니다.");
          return;
        }
        engineRef.current!.retry({
          file,
          objectName: analysis.storage_path,
          bucketName: "videos",
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
          accessToken,
          apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        });
      });
  }

  async function handleCancel() {
    engineRef.current?.cancel();
    if (analysis) {
      await cancelVideoAnalysis(analysis.id);
    }
    setFile(null);
    setAnalysis(null);
    setConfirmed(null);
    setServerError(null);
    setClientRequestId(null);
    setQueueStatus("idle");
    setQueueErrorMessage(null);
    queueStartedForRef.current = null;
  }

  const progressPercent =
    engineState.bytesTotal > 0 ? Math.round((engineState.bytesUploaded / engineState.bytesTotal) * 100) : 0;

  return (
    <div className="space-y-5">
      {phase === "idle" && (
        <>
          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-2 text-sm font-medium">장르 (임시 — 실제 선택 UI는 이후 STEP)</legend>
            {VIDEO_ANALYSIS_GENRES.map((g) => (
              <Button
                key={g}
                type="button"
                variant={genre === g ? "default" : "outline"}
                onClick={() => setGenre(g)}
              >
                {VIDEO_ANALYSIS_GENRE_LABEL[g]}
              </Button>
            ))}
          </fieldset>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
              isDragging ? "border-primary bg-primary/5" : "border-border"
            }`}
          >
            <UploadIcon className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              MP4 파일을 여기로 끌어다 놓거나
            </p>
            <label>
              <span className="cursor-pointer text-sm font-medium text-primary underline underline-offset-4">
                파일 선택
              </span>
              <input
                type="file"
                accept="video/mp4"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              지금은 Free plan staging 환경이라 {formatBytes(MAX_UPLOAD_BYTES)} 미만의 MP4만 가능해요.
            </p>
          </div>

          {fileError && <p className="text-sm text-destructive">{fileError}</p>}

          {file && !fileError && (
            <div className="flex items-center justify-between rounded-md border p-3 text-sm">
              <div className="truncate">
                <p className="truncate font-medium">{file.name}</p>
                <p className="text-muted-foreground">{formatBytes(file.size)}</p>
              </div>
              <Button onClick={startUpload}>업로드 시작</Button>
            </div>
          )}
        </>
      )}

      {(phase === "uploading" || phase === "confirming") && file && (
        <div className="space-y-3 rounded-md border p-4">
          <div className="flex items-center justify-between text-sm">
            <div className="truncate">
              <p className="truncate font-medium">{file.name}</p>
              <p className="text-muted-foreground">{formatBytes(file.size)}</p>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={handleCancel} aria-label="취소">
              <X className="size-4" />
            </Button>
          </div>

          <Progress value={progressPercent} />

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {formatBytes(engineState.bytesUploaded)} / {formatBytes(engineState.bytesTotal)} ({progressPercent}%)
            </span>
            <span className="flex items-center gap-1">
              {(engineState.status === "uploading" || engineState.status === "confirming" || phase === "confirming") && (
                <Loader2 className="size-3 animate-spin" />
              )}
              {STATUS_LABEL[engineState.status]}
            </span>
          </div>

          {engineState.status === "uploading" && (
            <Button variant="outline" size="sm" onClick={handlePause}>
              일시정지
            </Button>
          )}
          {engineState.status === "paused" && (
            <Button variant="outline" size="sm" onClick={handleResume}>
              이어서 업로드
            </Button>
          )}
          {engineState.status === "error" && (
            <div className="space-y-2">
              <p className="text-sm text-destructive">{engineState.errorMessage}</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleRetry}>
                  재시도
                </Button>
                <Button size="sm" variant="outline" onClick={handleCancel}>
                  취소
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {serverError && <p className="text-sm text-destructive">{serverError}</p>}

      {phase === "done" && confirmed && (
        <div className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-4 text-sm">
          <p className="font-medium">업로드 완료</p>
          <dl className="space-y-1 text-xs text-muted-foreground">
            <div className="flex justify-between gap-2">
              <dt>analysis id</dt>
              <dd className="truncate font-mono">{confirmed.id}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>DB status</dt>
              <dd className="font-mono">{confirmed.status}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>file_size_bytes</dt>
              <dd className="font-mono">{confirmed.file_size_bytes}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>storage_path</dt>
              <dd className="truncate font-mono">{confirmed.storage_path}</dd>
            </div>
          </dl>

          {queueStatus === "queuing" && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              분석 큐에 등록하는 중...
            </p>
          )}
          {queueStatus === "queued" && (
            <p className="text-xs text-muted-foreground">분석 큐에 등록되었습니다.</p>
          )}
          {queueStatus === "error" && (
            <div className="space-y-2">
              <p className="text-sm text-destructive">{queueErrorMessage}</p>
              <Button size="sm" variant="outline" onClick={() => triggerQueue(confirmed.id)}>
                큐 등록 다시 시도
              </Button>
            </div>
          )}

          <Button variant="outline" size="sm" onClick={handleCancel}>
            새 파일 업로드
          </Button>
        </div>
      )}
    </div>
  );
}
