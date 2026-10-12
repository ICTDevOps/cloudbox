#!/usr/bin/env bash
# Téléchargement d'extensions VS Code depuis Open VSX, avec vérification SHA-256.
# Nécessite les fonctions de image/cli/build/fetch.sh.

# openvsx_fetch <éditeur.nom> <version> <universal|linux-x64|linux-arm64>
#   Dépose /opt/cloudbox/vsix/<éditeur.nom>@<version>.vsix
openvsx_fetch() {
    local id=$1 version=$2 platform=$3
    local ns=${id%%.*} name=${id#*.}
    local api="https://open-vsx.org/api/$ns/$name"
    [[ $platform == universal ]] || api="$api/$platform"
    api="$api/$version"

    local meta download sha_url out="/opt/cloudbox/vsix/$id@$version.vsix"
    meta=$(curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors "$api")
    download=$(jq -er '.files.download' <<<"$meta")
    sha_url=$(jq -er '.files.sha256' <<<"$meta")
    if [[ $(jq -r '.preRelease // false' <<<"$meta") == true ]]; then
        echo "$id $version est une préversion : refusée" >&2
        return 1
    fi
    fetch "$download" "$out"
    verify "$out" "$(sum_from_url "$sha_url")"
}
