# syntax=docker/dockerfile:1
# Cloudbox — image :cli
# Outils d'administration Azure / Microsoft 365, sans interface web.
# Chaque outil est épinglé (ARG + commentaire Renovate) ; ne jamais installer en « latest ».

# Changement de LTS : manuel (règle Renovate). Les noms de paquets ci-dessous (libicu<N>) en dépendent.
FROM ubuntu:26.04@sha256:c098726dd9b9733f3e885f8de0ef375206a311b0a317eadc40d347b1115fb944

ARG TARGETARCH
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TZ=Etc/UTC \
    # Télémétrie et vérifications de mise à jour désactivées
    AZURE_CORE_COLLECT_TELEMETRY=false \
    AZURE_DEV_COLLECT_TELEMETRY=no \
    POWERSHELL_TELEMETRY_OPTOUT=1 \
    POWERSHELL_UPDATECHECK=Off \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1 \
    CHECKPOINT_DISABLE=1 \
    GH_NO_UPDATE_NOTIFIER=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    CLIMICROSOFT365_NOUPDATE=1 \
    # az utilise le binaire Bicep de l'image au lieu d'en télécharger un dans ~/.azure
    AZURE_BICEP_USE_BINARY_FROM_PATH=true \
    AZURE_BICEP_CHECK_VERSION=false \
    # Shell par défaut (cloudbox-shell, terminal intégré de VS Code) : pwsh | bash
    CLOUDBOX_SHELL=pwsh \
    CLOUDBOX_SUDO=false

# --- Outils de base (paquets Ubuntu, suivis par l'apt upgrade du build hebdomadaire) ---
RUN apt-get update \
 && apt-get upgrade -y \
 && apt-get install -y --no-install-recommends \
      bash bash-completion tmux less vim nano tree fzf ripgrep bat htop \
      openssl ca-certificates gnupg \
      curl wget bind9-dnsutils iputils-ping traceroute mtr-tiny netcat-openbsd whois iproute2 openssh-client \
      jq unzip zip rsync \
      git git-lfs python3 python3-pip pipx make \
      sudo tzdata locales \
      # Dépendances : PowerShell (ICU, Kerberos), archives xz/bz2, man minimal
      libicu78 libgssapi-krb5-2 xz-utils bzip2 apt-transport-https lsb-release \
 && sed -i -e 's/^# *\(en_US.UTF-8\)/\1/' -e 's/^# *\(fr_FR.UTF-8\)/\1/' /etc/locale.gen \
 && locale-gen \
 && ln -s /usr/bin/batcat /usr/local/bin/bat \
 && rm -rf /var/lib/apt/lists/*

# --- Utilisateur dev (uid 1000) : l'image Ubuntu fournit déjà « ubuntu » en 1000, on le retire ---
RUN userdel -r ubuntu 2>/dev/null || true \
 && useradd --create-home --uid 1000 --user-group --shell /bin/bash dev

# --- Azure CLI (dépôt apt Microsoft par version d'Ubuntu, amd64 + arm64) ---
# renovate: datasource=github-releases depName=Azure/azure-cli extractVersion=^azure-cli-(?<version>.+)$
ARG AZURE_CLI_VERSION=2.91.0
RUN . /etc/os-release \
 && install -d -m 0755 /etc/apt/keyrings \
 && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /etc/apt/keyrings/microsoft.gpg \
 && echo "deb [arch=${TARGETARCH} signed-by=/etc/apt/keyrings/microsoft.gpg] https://packages.microsoft.com/repos/azure-cli/ ${VERSION_CODENAME} main" \
      > /etc/apt/sources.list.d/azure-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends "azure-cli=${AZURE_CLI_VERSION}-1~${VERSION_CODENAME}" \
 && apt-mark hold azure-cli \
 && rm -rf /var/lib/apt/lists/*

# --- Azure Developer CLI (pas de somme publiée dans la release) ---
# renovate: datasource=github-releases depName=Azure/azure-dev extractVersion=^azure-dev-cli_(?<version>.+)$
ARG AZD_VERSION=1.37.0
RUN --mount=type=bind,source=build,target=/build \
    . /build/fetch.sh && cd /tmp \
 && a=$(arch_name amd64 arm64) \
 && fetch "https://github.com/Azure/azure-dev/releases/download/azure-dev-cli_${AZD_VERSION}/azd-linux-${a}.tar.gz" azd.tgz \
 && mkdir azd && tar -xzf azd.tgz -C azd \
 && install -m 0755 "azd/azd-linux-${a}" /usr/local/bin/azd \
 && rm -rf /tmp/azd*

# --- Bicep (pas de somme publiée dans la release) ---
# renovate: datasource=github-releases depName=Azure/bicep extractVersion=^v(?<version>.+)$
ARG BICEP_VERSION=0.48.1
RUN --mount=type=bind,source=build,target=/build \
    . /build/fetch.sh \
 && fetch "https://github.com/Azure/bicep/releases/download/v${BICEP_VERSION}/bicep-linux-$(arch_name x64 arm64)" /usr/local/bin/bicep \
 && chmod 0755 /usr/local/bin/bicep

# --- PowerShell 7 ---
# renovate: datasource=github-releases depName=PowerShell/PowerShell extractVersion=^v(?<version>.+)$
ARG POWERSHELL_VERSION=7.6.7
RUN --mount=type=bind,source=build,target=/build \
    . /build/fetch.sh && cd /tmp \
 && f="powershell-${POWERSHELL_VERSION}-linux-$(arch_name x64 arm64).tar.gz" \
 && base="https://github.com/PowerShell/PowerShell/releases/download/v${POWERSHELL_VERSION}" \
 && fetch "$base/$f" "$f" \
 && verify "$f" "$(sum_from_list "$base/hashes.sha256" "$f")" \
 && mkdir -p /opt/microsoft/powershell/7 \
 && tar -xzf "$f" -C /opt/microsoft/powershell/7 \
 && chmod 0755 /opt/microsoft/powershell/7/pwsh \
 && ln -s /opt/microsoft/powershell/7/pwsh /usr/bin/pwsh \
 && { grep -qx /usr/bin/pwsh /etc/shells || echo /usr/bin/pwsh >> /etc/shells; } \
 && rm -f "$f"

# --- Modules PowerShell (scope AllUsers : /usr/local/share/powershell/Modules) ---
# Les modules installés par l'utilisateur (scope CurrentUser) vont dans /home/dev, le volume persistant.
# renovate: datasource=nuget depName=Az registryUrl=https://www.powershellgallery.com/api/v2/
ARG AZ_PS_VERSION=16.4.0
RUN --mount=type=bind,source=build,target=/build \
    pwsh -NoLogo -NoProfile -File /build/install-psmodule.ps1 -Name Az -Version "${AZ_PS_VERSION}"

# renovate: datasource=nuget depName=Microsoft.Graph registryUrl=https://www.powershellgallery.com/api/v2/
ARG MSGRAPH_PS_VERSION=2.41.1
RUN --mount=type=bind,source=build,target=/build \
    pwsh -NoLogo -NoProfile -File /build/install-psmodule.ps1 -Name Microsoft.Graph -Version "${MSGRAPH_PS_VERSION}"

# renovate: datasource=nuget depName=ExchangeOnlineManagement registryUrl=https://www.powershellgallery.com/api/v2/
ARG EXO_PS_VERSION=3.10.1
RUN --mount=type=bind,source=build,target=/build \
    pwsh -NoLogo -NoProfile -File /build/install-psmodule.ps1 -Name ExchangeOnlineManagement -Version "${EXO_PS_VERSION}"

# renovate: datasource=nuget depName=MicrosoftTeams registryUrl=https://www.powershellgallery.com/api/v2/
ARG TEAMS_PS_VERSION=8.0.0
RUN --mount=type=bind,source=build,target=/build \
    pwsh -NoLogo -NoProfile -File /build/install-psmodule.ps1 -Name MicrosoftTeams -Version "${TEAMS_PS_VERSION}"

# renovate: datasource=nuget depName=PnP.PowerShell registryUrl=https://www.powershellgallery.com/api/v2/
ARG PNP_PS_VERSION=3.4.1
RUN --mount=type=bind,source=build,target=/build \
    pwsh -NoLogo -NoProfile -File /build/install-psmodule.ps1 -Name PnP.PowerShell -Version "${PNP_PS_VERSION}"

# --- Node.js LTS ---
# renovate: datasource=node-version depName=node versioning=node
ARG NODE_VERSION=24.22.1
RUN --mount=type=bind,source=build,target=/build \
    . /build/fetch.sh && cd /tmp \
 && f="node-v${NODE_VERSION}-linux-$(arch_name x64 arm64).tar.xz" \
 && base="https://nodejs.org/dist/v${NODE_VERSION}" \
 && fetch "$base/$f" "$f" \
 && verify "$f" "$(sum_from_list "$base/SHASUMS256.txt" "$f")" \
 && tar -xJf "$f" -C /usr/local --strip-components=1 --no-same-owner \
      --exclude='*/CHANGELOG.md' --exclude='*/README.md' --exclude='*/LICENSE' --exclude='*/doc' \
 && rm -f "$f"

# --- CLI for Microsoft 365 ---
# renovate: datasource=npm depName=@pnp/cli-microsoft365
ARG CLI_M365_VERSION=11.11.0
RUN npm install --global --no-audit "@pnp/cli-microsoft365@${CLI_M365_VERSION}" \
 && npm cache clean --force

# --- kubectl ---
# renovate: datasource=github-releases depName=kubernetes/kubernetes extractVersion=^v(?<version>.+)$
ARG KUBECTL_VERSION=1.37.1
RUN --mount=type=bind,source=build,target=/build \
    . /build/fetch.sh && cd /tmp \
 && url="https://dl.k8s.io/release/v${KUBECTL_VERSION}/bin/linux/${TARGETARCH}/kubectl" \
 && fetch "$url" kubectl \
 && verify kubectl "$(sum_from_url "$url.sha256")" \
 && install -m 0755 kubectl /usr/local/bin/kubectl \
 && rm -f kubectl

# --- Helm ---
# renovate: datasource=github-releases depName=helm/helm extractVersion=^v(?<version>.+)$
ARG HELM_VERSION=4.3.1
RUN --mount=type=bind,source=build,target=/build \
    . /build/fetch.sh && cd /tmp \
 && f="helm-v${HELM_VERSION}-linux-${TARGETARCH}.tar.gz" \
 && fetch "https://get.helm.sh/$f" "$f" \
 && verify "$f" "$(sum_from_url "https://get.helm.sh/$f.sha256sum")" \
 && tar -xzf "$f" --strip-components=1 -C /usr/local/bin "linux-${TARGETARCH}/helm" \
 && rm -f "$f"

# --- GitHub CLI ---
# renovate: datasource=github-releases depName=cli/cli extractVersion=^v(?<version>.+)$
ARG GH_VERSION=2.103.0
RUN --mount=type=bind,source=build,target=/build \
    . /build/fetch.sh && cd /tmp \
 && f="gh_${GH_VERSION}_linux_${TARGETARCH}.tar.gz" \
 && base="https://github.com/cli/cli/releases/download/v${GH_VERSION}" \
 && fetch "$base/$f" "$f" \
 && verify "$f" "$(sum_from_list "$base/gh_${GH_VERSION}_checksums.txt" "$f")" \
 && tar -xzf "$f" --strip-components=2 -C /usr/local/bin "gh_${GH_VERSION}_linux_${TARGETARCH}/bin/gh" \
 && rm -f "$f"

# --- OpenTofu ---
# renovate: datasource=github-releases depName=opentofu/opentofu extractVersion=^v(?<version>.+)$
ARG OPENTOFU_VERSION=1.13.1
RUN --mount=type=bind,source=build,target=/build \
    . /build/fetch.sh && cd /tmp \
 && f="tofu_${OPENTOFU_VERSION}_linux_${TARGETARCH}.tar.gz" \
 && base="https://github.com/opentofu/opentofu/releases/download/v${OPENTOFU_VERSION}" \
 && fetch "$base/$f" "$f" \
 && verify "$f" "$(sum_from_list "$base/tofu_${OPENTOFU_VERSION}_SHA256SUMS" "$f")" \
 && tar -xzf "$f" -C /usr/local/bin tofu \
 && rm -f "$f"

# --- Terraform (licence BSL, voir README) ---
# renovate: datasource=github-releases depName=hashicorp/terraform extractVersion=^v(?<version>.+)$
ARG TERRAFORM_VERSION=1.16.6
RUN --mount=type=bind,source=build,target=/build \
    . /build/fetch.sh && cd /tmp \
 && f="terraform_${TERRAFORM_VERSION}_linux_${TARGETARCH}.zip" \
 && base="https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}" \
 && fetch "$base/$f" "$f" \
 && verify "$f" "$(sum_from_list "$base/terraform_${TERRAFORM_VERSION}_SHA256SUMS" "$f")" \
 && unzip -q -o "$f" terraform -d /usr/local/bin \
 && rm -f "$f"

# --- kubelogin ---
# renovate: datasource=github-releases depName=Azure/kubelogin extractVersion=^v(?<version>.+)$
ARG KUBELOGIN_VERSION=0.2.21
RUN --mount=type=bind,source=build,target=/build \
    . /build/fetch.sh && cd /tmp \
 && f="kubelogin-linux-${TARGETARCH}.zip" \
 && base="https://github.com/Azure/kubelogin/releases/download/v${KUBELOGIN_VERSION}" \
 && fetch "$base/$f" "$f" \
 && verify "$f" "$(sum_from_url "$base/$f.sha256")" \
 && unzip -q -j -o "$f" "bin/linux_${TARGETARCH}/kubelogin" -d /usr/local/bin \
 && rm -f "$f"

# --- k9s ---
# renovate: datasource=github-releases depName=derailed/k9s extractVersion=^v(?<version>.+)$
ARG K9S_VERSION=0.51.0
RUN --mount=type=bind,source=build,target=/build \
    . /build/fetch.sh && cd /tmp \
 && f="k9s_Linux_${TARGETARCH}.tar.gz" \
 && base="https://github.com/derailed/k9s/releases/download/v${K9S_VERSION}" \
 && fetch "$base/$f" "$f" \
 && verify "$f" "$(sum_from_list "$base/checksums.sha256" "$f")" \
 && tar -xzf "$f" -C /usr/local/bin k9s \
 && rm -f "$f"

# --- kubectx / kubens ---
# renovate: datasource=github-releases depName=ahmetb/kubectx extractVersion=^v(?<version>.+)$
ARG KUBECTX_VERSION=0.11.0
RUN --mount=type=bind,source=build,target=/build \
    . /build/fetch.sh && cd /tmp \
 && a=$(arch_name x86_64 arm64) \
 && base="https://github.com/ahmetb/kubectx/releases/download/v${KUBECTX_VERSION}" \
 && for tool in kubectx kubens; do \
      f="${tool}_v${KUBECTX_VERSION}_linux_${a}.tar.gz" \
      && fetch "$base/$f" "$f" \
      && verify "$f" "$(sum_from_list "$base/checksums.txt" "$f")" \
      && tar -xzf "$f" -C /usr/local/bin "$tool" \
      && rm -f "$f" || exit 1; \
    done

# --- AzCopy (pas de somme publiée dans la release) ---
# renovate: datasource=github-releases depName=Azure/azure-storage-azcopy extractVersion=^v(?<version>.+)$
ARG AZCOPY_VERSION=10.34.0
RUN --mount=type=bind,source=build,target=/build \
    . /build/fetch.sh && cd /tmp \
 && d="azcopy_linux_${TARGETARCH}_${AZCOPY_VERSION}" \
 && fetch "https://github.com/Azure/azure-storage-azcopy/releases/download/v${AZCOPY_VERSION}/$d.tar.gz" azcopy.tgz \
 && tar -xzf azcopy.tgz --strip-components=1 -C /usr/local/bin "$d/azcopy" \
 && chmod 0755 /usr/local/bin/azcopy \
 && rm -f azcopy.tgz

# --- sqlcmd (go-sqlcmd, pas de somme publiée dans la release) ---
# renovate: datasource=github-releases depName=microsoft/go-sqlcmd extractVersion=^v(?<version>.+)$
ARG SQLCMD_VERSION=1.10.0
RUN --mount=type=bind,source=build,target=/build \
    . /build/fetch.sh && cd /tmp \
 && fetch "https://github.com/microsoft/go-sqlcmd/releases/download/v${SQLCMD_VERSION}/sqlcmd-linux-${TARGETARCH}.tar.bz2" sqlcmd.tbz \
 && tar -xjf sqlcmd.tbz -C /usr/local/bin sqlcmd \
 && rm -f sqlcmd.tbz

# --- yq (mikefarah) ---
# renovate: datasource=github-releases depName=mikefarah/yq extractVersion=^v(?<version>.+)$
ARG YQ_VERSION=4.54.1
RUN --mount=type=bind,source=build,target=/build \
    . /build/fetch.sh && cd /tmp \
 && f="yq_linux_${TARGETARCH}" \
 && base="https://github.com/mikefarah/yq/releases/download/v${YQ_VERSION}" \
 && fetch "$base/$f" "$f" \
 # Le fichier « checksums » liste plusieurs empreintes par ligne ; leur ordre est dans checksums_hashes_order
 && col=$(curl -fsSL "$base/checksums_hashes_order" | grep -nx 'SHA-256' | cut -d: -f1) \
 && verify "$f" "$(curl -fsSL "$base/checksums" | awk -v n="$f" -v c="$((col + 1))" '$1 == n { print $c }')" \
 && install -m 0755 "$f" /usr/local/bin/yq \
 && rm -f "$f"

# --- Complétion Bash des outils qui la génèrent ---
RUN d=/usr/share/bash-completion/completions \
 && kubectl completion bash > "$d/kubectl" \
 && helm completion bash > "$d/helm" \
 && gh completion -s bash > "$d/gh" \
 && azd completion bash > "$d/azd" \
 && k9s completion bash > "$d/k9s" \
 && yq shell-completion bash > "$d/yq" \
 && printf 'complete -C /usr/local/bin/tofu tofu\n' > "$d/tofu" \
 && printf 'complete -C /usr/local/bin/terraform terraform\n' > "$d/terraform" \
 && kubelogin completion bash > "$d/kubelogin" \
 && sqlcmd completion bash > "$d/sqlcmd" \
 && azcopy completion bash > "$d/azcopy"

# --- Fichiers Cloudbox (scripts, profils, sudoers) ---
COPY --chmod=0755 rootfs/usr/local/bin/ /usr/local/bin/
COPY --chmod=0755 rootfs/usr/local/sbin/ /usr/local/sbin/
COPY rootfs/etc/ /etc/
COPY rootfs/opt/ /opt/
RUN chmod 0440 /etc/sudoers.d/cloudbox \
 && visudo -cf /etc/sudoers \
 # Le home de l'image reçoit le squelette Cloudbox (copié dans le volume au premier montage)
 && cp -a /etc/skel/. /home/dev/ \
 && chown -R dev:dev /home/dev \
 && install -d -o root -g root -m 0755 /var/lib/cloudbox \
 && cloudbox-versions --json > /etc/cloudbox/versions.json

USER dev
WORKDIR /home/dev
ENTRYPOINT ["/usr/local/bin/cloudbox-entrypoint"]
CMD ["sleep", "infinity"]
