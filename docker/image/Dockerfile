# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24-bookworm-slim
FROM node:24-bookworm AS protocol-sources
COPY docker/image/sources.json /sources.json
COPY docker/image/protocol-sources.mjs /fetch.mjs
RUN node /fetch.mjs

FROM golang:1.26-bookworm AS protocol-build
COPY --from=protocol-sources /src /src
WORKDIR /src/open-diag-go
RUN CGO_ENABLED=0 go build -trimpath -o /out/osd-up ./cmd/osd-up
RUN mkdir -p /out/licenses && cp LICENSE /out/licenses/open-diag-go.LICENSE \
    && cp ../open-rfc-go/LICENSE /out/licenses/open-rfc-go.LICENSE \
    && cp ../vsp/LICENSE /out/licenses/vsp.LICENSE \
    && go list -m -json all > /out/go-modules.json
RUN go list -deps -f '{{if .Module}}{{.Module.Path}}{{end}}' ./cmd/osd-up | sort -u > /out/go-used-modules.txt
RUN find /go/pkg/mod -type f \( -iname 'license*' -o -iname 'copying*' -o -iname 'notice*' \) \
    -exec cp --parents {} /out/licenses/ \;

FROM node:24-bookworm-slim AS protocol-audit
COPY --from=protocol-build /out /out
COPY docker/image/protocol-licenses.mjs /audit.mjs
RUN node /audit.mjs

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
COPY --from=protocol-audit /out /opt/protocols
COPY --from=protocol-sources /sources.json /opt/protocols/sources.json
RUN mkdir -p /data /opt/osd/.local/tls && chown node:node /data /opt/osd/.local/tls
ARG OSD_IMAGE_REVISION=local
LABEL org.opencontainers.image.source="https://github.com/oisee/open-steamgate" \
      org.opencontainers.image.revision=${OSD_IMAGE_REVISION} \
      org.opencontainers.image.description="OSD Node runtime with DIAG/RFC stubs; license inventories in /opt/osd/image-licenses.json and /opt/protocols/licenses.json"
ENV STG_PORT=3030 STG_TLS_PORT=44300 STG_SERVE=child STG_DB=file OSD_WORKERS=1 INSTANCE=00
USER node
VOLUME ["/data", "/opt/osd/.local/tls"]
EXPOSE 3030 44300
HEALTHCHECK --interval=15s --timeout=12s --start-period=120s --retries=10 \
    CMD ["node", "docker/image/healthcheck.mjs"]
ENTRYPOINT ["node", "docker/image/entrypoint.mjs"]
