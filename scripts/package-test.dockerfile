ARG BUN_VERSION=1.4.4
FROM oven/bun:${BUN_VERSION} AS bun
FROM node:24-bookworm-slim
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -r /var/lib/apt/lists/*
WORKDIR /opt/openclaw
ARG OPENCLAW_VERSION=2026.7.1
RUN bun add openclaw@${OPENCLAW_VERSION}
ENV OPENCLAW_STATE_DIR=/tmp/openclaw MOI_DATA_DIR=/tmp/moi MOI_SECRET_BACKEND=file MOI_ENVIRONMENT=local
WORKDIR /opt/moi
CMD ["bun", "/test/scripts/package-openclaw-check.ts"]
