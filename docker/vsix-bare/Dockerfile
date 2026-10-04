FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55 AS download
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
# Official update API: /api/versions/1.101.2/linux-x64/stable
RUN curl --fail --location --retry 3 --connect-timeout 30 --max-time 300 \
      https://vscode.download.prss.microsoft.com/dbazure/download/stable/2901c5ac6db8a986a5666c3af51ff804d05af0d4/code-stable-x64-1750797851.tar.gz \
      -o /tmp/code.tar.gz \
    && echo 'ef62ab0835017bec498e7498fe79eb347f7610fe2da7bd71d5f69d8743ded033  /tmp/code.tar.gz' | sha256sum -c - \
    && mkdir /opt/code && tar -xzf /tmp/code.tar.gz -C /opt/code --strip-components=1

FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates xvfb xauth libasound2t64 libatk1.0-0t64 libatk-bridge2.0-0t64 \
      libcups2t64 libdrm2 libgbm1 libgtk-3-0t64 libnss3 libx11-xcb1 libxkbfile1 \
      libxss1 libxtst6 libxshmfence1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1001 smoke && mkdir /smoke && chown smoke:smoke /smoke
COPY --from=download /opt/code /opt/code
COPY entry.sh harness.cjs /opt/smoke/
ENV PATH=/opt/code/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
RUN ! command -v node && ! command -v npm && ! command -v git
USER smoke
WORKDIR /smoke
ENTRYPOINT ["/bin/bash", "/opt/smoke/entry.sh"]
