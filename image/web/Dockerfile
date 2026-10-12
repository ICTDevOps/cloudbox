# syntax=docker/dockerfile:1
# Cloudbox — image :web
# Image :cli + interface web : portail, terminal web (ttyd + tmux) et VS Code web (code-server),
# derrière Caddy (seul port réseau : 8080), supervisés par s6-overlay.
#
# Contexte de build : racine du dépôt (réutilise image/cli/build/fetch.sh).
#   docker build -f image/web/Dockerfile --build-arg BASE_IMAGE=cloudbox:cli -t cloudbox:web .

ARG BASE_IMAGE=ghcr.io/ictdevops/cloudbox:cli
FROM ${BASE_IMAGE}

ARG TARGETARCH
USER root
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# --- s6-overlay (supervision, PID 1) ---
# renovate: datasource=github-releases depName=just-containers/s6-overlay extractVersion=^v(?<version>.+)$
ARG S6_OVERLAY_VERSION=3.2.3.2
RUN --mount=type=bind,source=image/cli/build,target=/build \
    . /build/fetch.sh && cd /tmp \
 && base="https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}" \
 && for f in s6-overlay-noarch.tar.xz "s6-overlay-$(arch_name x86_64 aarch64).tar.xz"; do \
      fetch "$base/$f" "$f" \
      && verify "$f" "$(sum_from_url "$base/$f.sha256")" \
      && tar -C / -Jxpf "$f" \
      && rm -f "$f" || exit 1; \
    done \
 && echo "${S6_OVERLAY_VERSION}" > /etc/cloudbox/s6-overlay.version

# --- ttyd (terminal web) ---
# renovate: datasource=github-releases depName=tsl0922/ttyd
ARG TTYD_VERSION=1.7.7
RUN --mount=type=bind,source=image/cli/build,target=/build \
    . /build/fetch.sh && cd /tmp \
 && f="ttyd.$(arch_name x86_64 aarch64)" \
 && base="https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}" \
 && fetch "$base/$f" "$f" \
 && verify "$f" "$(sum_from_list "$base/SHA256SUMS" "$f")" \
 && install -m 0755 "$f" /usr/local/bin/ttyd \
 && rm -f "$f"

# Page d'accueil de ttyd : celle du binaire + blocage du menu contextuel du navigateur
COPY image/web/build/ttyd-index.sh image/web/build/ttyd-index-addon.html /tmp/ttyd-index/
RUN bash /tmp/ttyd-index/ttyd-index.sh /usr/share/cloudbox/ttyd/index.html \
 && rm -rf /tmp/ttyd-index

# --- Caddy (reverse proxy, authentification, portail) ---
# renovate: datasource=github-releases depName=caddyserver/caddy extractVersion=^v(?<version>.+)$
ARG CADDY_VERSION=2.11.7
RUN --mount=type=bind,source=image/cli/build,target=/build \
    . /build/fetch.sh && cd /tmp \
 && f="caddy_${CADDY_VERSION}_linux_${TARGETARCH}.tar.gz" \
 && base="https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}" \
 && fetch "$base/$f" "$f" \
 && verify "$f" "$(sum_from_list "$base/caddy_${CADDY_VERSION}_checksums.txt" "$f")" \
 && tar -xzf "$f" -C /usr/local/bin caddy \
 && rm -f "$f"

# --- code-server (VS Code web ; pas de somme publiée dans la release) ---
# renovate: datasource=github-releases depName=coder/code-server extractVersion=^v(?<version>.+)$
ARG CODE_SERVER_VERSION=4.141.0
RUN --mount=type=bind,source=image/cli/build,target=/build \
    . /build/fetch.sh && cd /tmp \
 && f="code-server-${CODE_SERVER_VERSION}-linux-${TARGETARCH}.tar.gz" \
 && fetch "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/$f" "$f" \
 && mkdir -p /usr/lib/code-server \
 && tar -xzf "$f" -C /usr/lib/code-server --strip-components=1 --no-same-owner \
 && ln -s /usr/lib/code-server/bin/code-server /usr/local/bin/code-server \
 && rm -f "$f"

# --- Extensions code-server (Open VSX), installées dans le home au démarrage ---
# Bicep (ms-azuretools.vscode-bicep) n'est pas publié sur Open VSX : non installé.
# renovate: datasource=custom.openvsx depName=ms-vscode.powershell
ARG EXT_POWERSHELL_VERSION=2025.4.0
# renovate: datasource=custom.openvsx depName=hashicorp.terraform
ARG EXT_TERRAFORM_VERSION=2.40.0
# renovate: datasource=custom.openvsx depName=opentofu.vscode-opentofu
ARG EXT_OPENTOFU_VERSION=0.6.3
# renovate: datasource=custom.openvsx depName=redhat.vscode-yaml
ARG EXT_YAML_VERSION=1.25.0
# renovate: datasource=custom.openvsx depName=ms-kubernetes-tools.vscode-kubernetes-tools
ARG EXT_KUBERNETES_VERSION=1.4.1
RUN --mount=type=bind,source=image/cli/build,target=/build \
    --mount=type=bind,source=image/web/build,target=/build-web \
    . /build/fetch.sh && . /build-web/openvsx.sh \
 && install -d /opt/cloudbox/vsix \
 && openvsx_fetch ms-vscode.powershell "${EXT_POWERSHELL_VERSION}" universal \
 && openvsx_fetch hashicorp.terraform "${EXT_TERRAFORM_VERSION}" "linux-$(arch_name x64 arm64)" \
 && openvsx_fetch opentofu.vscode-opentofu "${EXT_OPENTOFU_VERSION}" "linux-$(arch_name x64 arm64)" \
 && openvsx_fetch redhat.vscode-yaml "${EXT_YAML_VERSION}" universal \
 && openvsx_fetch ms-kubernetes-tools.vscode-kubernetes-tools "${EXT_KUBERNETES_VERSION}" universal \
 && ls -l /opt/cloudbox/vsix

# --- Fichiers Cloudbox web (services s6, Caddyfile, portail) ---
COPY --chmod=0755 image/web/rootfs/usr/local/bin/ /usr/local/bin/
COPY image/web/rootfs/etc/ /etc/
COPY image/web/rootfs/srv/ /srv/
RUN chmod 0755 /etc/s6-overlay/scripts/* /etc/s6-overlay/s6-rc.d/*/run \
 && caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
 # s6-overlay tourne en dev (USER) : /run doit lui appartenir
 && chown dev:dev /run \
 && cloudbox-versions --json > /etc/cloudbox/versions.json \
 && cp /etc/cloudbox/versions.json /srv/portal/versions.json

ENV CLOUDBOX_MODE=web \
    S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0 \
    S6_KILL_GRACETIME=5000 \
    S6_VERBOSITY=1

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD [ "$CLOUDBOX_MODE" = shell ] || curl -fsS -o /dev/null http://127.0.0.1:8080/_health

USER dev
WORKDIR /home/dev
ENTRYPOINT ["/usr/local/bin/cloudbox-web-entrypoint"]
CMD []
