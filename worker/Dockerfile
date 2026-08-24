# worker/Dockerfile
#
# STEP 4-3A Cloud Run Job 이미지. 이 저장소에는 재사용할 만한 기존 PoC
# Dockerfile/FFmpeg 설정이 없었습니다(find로 확인 — worker/, Docker 관련
# 파일 모두 이번 STEP에서 처음 만듦) — 그래서 표준 python:slim 베이스로
# 새로 작성했습니다.
#
# ⚠️ FFmpeg는 아직 설치하지 않습니다 — 지시사항 그대로, 실제 처리 파이프라인은
#    이번 STEP 범위가 아닙니다.
# ⚠️ HTTP 서버를 띄우지 않습니다 — Cloud Run **Job**이지 Service가 아닙니다.
#    execution이 시작되면 CMD가 한 번 실행되고 컨테이너가 끝납니다. 포트를
#    LISTEN하거나 요청을 기다리며 계속 떠 있지 않습니다.
# ⚠️ 이 Dockerfile은 이번 세션에서 실제로 빌드해보지 못했습니다 — Docker
#    데몬이 이 샌드박스에 없습니다(/var/run/docker.sock 없음, docker 클라이언트
#    바이너리만 있음). 배포 전 실제 환경에서 `docker build`를 한 번은 직접
#    확인하세요.

FROM python:3.12-slim

# Cloud Run Job 컨테이너를 root로 실행할 필요가 없습니다 — 최소 권한 원칙.
RUN useradd --create-home --uid 1000 worker

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py supabase_client.py ./

RUN chown -R worker:worker /app
USER worker

# 이 이미지는 서버가 아니라 한 번 실행되고 끝나는 배치 작업입니다.
CMD ["python", "main.py"]
