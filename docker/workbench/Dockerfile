# syntax=docker/dockerfile:1.7
FROM ghcr.io/coder/code-server:4.138.0@sha256:81706b71ace316157850cbcfb574714d1067249c107a415b3a03dc6b613ebfbc

USER root

# A browser IDE is command execution. The upstream image grants its user
# passwordless sudo and starts through a setuid uid-rewriter; this sidecar has
# one fixed non-root user and needs neither privilege.
RUN rm -f /etc/sudoers.d/nopasswd /usr/bin/sudo /usr/local/bin/fixuid

ADD --checksum=sha256:816bebcb5cfba92c3fd57a3b58fa476757acd9427bd466380f783a76edb4f773 \
  https://open-vsx.org/api/larshp/vscode-abap/0.5.4/file/larshp.vscode-abap-0.5.4.vsix /tmp/vscode-abap.vsix
ADD --checksum=sha256:c4d8d96629eed392fff3928f0073ae55065b3e8c01cf4e0498914bc9096da0d3 \
  https://open-vsx.org/api/hudakf/cds/0.7.3/file/hudakf.cds-0.7.3.vsix /tmp/cds.vsix
ADD --checksum=sha256:6a05dd256014e1463941eecb8a6318e996b5feb78d60f4a5657c17e270942577 \
  https://github.com/marcellourbani/vscode_abap_remote_fs/releases/download/v2.9.1/vscode-abap-remote-fs-2.9.1.vsix /tmp/abap-fs.vsix

RUN chown coder:coder /tmp/vscode-abap.vsix /tmp/cds.vsix /tmp/abap-fs.vsix \
  && chmod 0444 /tmp/vscode-abap.vsix /tmp/cds.vsix /tmp/abap-fs.vsix \
  && mkdir -p /opt/osd-workbench/extensions /home/coder/.cache/copilot \
  && chown -R coder:coder /opt/osd-workbench /home/coder/.cache \
  && ln -s .cache/copilot /home/coder/.copilot

USER coder
RUN code-server --extensions-dir /opt/osd-workbench/extensions --install-extension /tmp/vscode-abap.vsix \
  && code-server --extensions-dir /opt/osd-workbench/extensions --install-extension /tmp/cds.vsix \
  && code-server --extensions-dir /opt/osd-workbench/extensions --install-extension /tmp/abap-fs.vsix \
  && code-server --extensions-dir /opt/osd-workbench/extensions --list-extensions --show-versions \
     | grep -Fx 'larshp.vscode-abap@0.5.4' \
  && code-server --extensions-dir /opt/osd-workbench/extensions --list-extensions --show-versions \
     | grep -Fx 'hudakf.cds@0.7.3' \
  && code-server --extensions-dir /opt/osd-workbench/extensions --list-extensions --show-versions \
     | grep -Fx 'murbani.vscode-abap-remote-fs@2.9.1'

USER root
COPY --chmod=0444 docker/workbench/patch-abap-fs.mjs /tmp/patch-abap-fs.mjs
# Compatibility fixes are exact replacements against the pinned VSIX. The
# script refuses a changed/minified input instead of silently patching the
# wrong code.
RUN /usr/lib/code-server/lib/node /tmp/patch-abap-fs.mjs \
      /opt/osd-workbench/extensions/murbani.vscode-abap-remote-fs-2.9.1/client/dist/extension.js \
  && rm -f /tmp/vscode-abap.vsix /tmp/cds.vsix /tmp/abap-fs.vsix /tmp/patch-abap-fs.mjs
COPY --chmod=0555 docker/workbench/entrypoint.sh /usr/local/bin/osd-workbench-entrypoint

USER coder
WORKDIR /workspace
EXPOSE 8080
ENTRYPOINT ["/usr/bin/dumb-init", "--", "/usr/local/bin/osd-workbench-entrypoint"]
