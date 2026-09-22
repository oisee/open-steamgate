# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /work/osd
COPY package.json package-lock.json ./
RUN npm ci --include=dev --include=optional --no-audit --no-fund
COPY . .
ARG OSD_IMAGE_REVISION=local
ENV OSD_IMAGE_REVISION=${OSD_IMAGE_REVISION}
RUN node docker/image/build.mjs

FROM ${NODE_IMAGE} AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates libatomic1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/osd
COPY --from=build --chown=node:node /image/ ./
RUN mkdir -p /data /opt/osd/.local/tls && chown node:node /data /opt/osd/.local/tls
ARG OSD_IMAGE_REVISION=local
LABEL org.opencontainers.image.source="https://github.com/oisee/open-steamgate" \
      org.opencontainers.image.revision=${OSD_IMAGE_REVISION} \
      org.opencontainers.image.description="OSD Node runtime with built-in MIT JavaScript DIAG and RFC-to-ADT listeners"
ENV STG_PORT=3030 STG_TLS_PORT=44300 STG_SERVE=child STG_DB=file OSD_WORKERS=1 INSTANCE=00
USER node
VOLUME ["/data", "/opt/osd/.local/tls"]
EXPOSE 3030 44300
HEALTHCHECK --interval=15s --timeout=12s --start-period=120s --retries=10 \
    CMD ["node", "docker/image/healthcheck.mjs"]
ENTRYPOINT ["node", "docker/image/entrypoint.mjs"]
