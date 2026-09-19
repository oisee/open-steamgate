# open-steamgate in a container: the release directory and nothing else.
#
# The release (`bun scripts/make-release.mjs`) is already self-contained --
# the Bun binary needs no Node and no npm, and the tree it serves travels
# beside it. So the image is a base with a CA bundle and that directory; there
# is no build step here and nothing is compiled at image time.
#
# Built from the repository root so the context can reach .local/release:
#   bun scripts/make-release.mjs .local/release
#   docker build -f docker/Dockerfile -t osd:local .
FROM debian:12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /osd
COPY .local/release/ /osd/

# The database file lives outside the image layer, for the reason
# docs/amdp-in-hana.md records about HANA's own data: a writable layer copies
# on first write and dies with the container.
VOLUME ["/osd/data-run"]
ENV STG_PORT=3030 \
    STG_DB_PATH=/osd/data-run/osd.sqlite \
    OSD_WORKERS=4

EXPOSE 3030
# the Bun binary; ./run.sh sea|node|system picks the other hosts
ENTRYPOINT ["./run.sh"]
CMD ["bun"]
