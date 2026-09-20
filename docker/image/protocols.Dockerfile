# syntax=docker/dockerfile:1
FROM node:24-bookworm AS sources
COPY docker/image/sources.json /sources.json
COPY docker/image/protocol-sources.mjs /fetch.mjs
RUN node /fetch.mjs

FROM golang:1.26-bookworm AS build
COPY --from=sources /src /src
WORKDIR /src/open-diag-go
RUN CGO_ENABLED=0 go build -trimpath -o /out/osd-up ./cmd/osd-up
RUN mkdir -p /out/licenses && cp LICENSE /out/licenses/open-diag-go.LICENSE \
    && cp ../open-rfc-go/LICENSE /out/licenses/open-rfc-go.LICENSE \
    && cp ../vsp/LICENSE /out/licenses/vsp.LICENSE \
    && go list -m -json all > /out/go-modules.json
RUN go list -deps -f '{{if .Module}}{{.Module.Path}}{{end}}' ./cmd/osd-up | sort -u > /out/go-used-modules.txt
RUN find /go/pkg/mod -type f \( -iname 'license*' -o -iname 'copying*' -o -iname 'notice*' \) \
    -exec cp --parents {} /out/licenses/ \;

FROM node:24-bookworm-slim AS audit
COPY --from=build /out /out
COPY docker/image/protocol-licenses.mjs /audit.mjs
RUN node /audit.mjs

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=audit /out /opt/protocols
COPY --from=sources /sources.json /opt/protocols/sources.json
COPY docker/image/protocol-entrypoint.sh /opt/protocols/entrypoint.sh
USER 1000:1000
ENV INSTANCE=00 OSD_URL=http://osd:3030 OSD_SID=OSD
ENTRYPOINT ["sh", "/opt/protocols/entrypoint.sh"]
