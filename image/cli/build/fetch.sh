#!/usr/bin/env bash
# Fonctions d'aide au build : téléchargement et vérification des sommes de contrôle.
# Chargé par les instructions RUN des Dockerfile (`. /build/fetch.sh`).
set -euo pipefail

# fetch <url> <fichier>
#   Télécharge un fichier en échouant sur toute erreur HTTP.
fetch() {
    curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors -o "$2" "$1"
}

# verify <fichier> <somme>
#   Compare la somme d'un fichier à la valeur attendue (SHA-256, ou SHA-512 selon la longueur).
verify() {
    local file=$1 expected=${2,,}
    if [[ $expected =~ ^[0-9a-f]{64}$ ]]; then
        echo "$expected  $file" | sha256sum -c --strict -
    elif [[ $expected =~ ^[0-9a-f]{128}$ ]]; then
        echo "$expected  $file" | sha512sum -c --strict -
    else
        echo "Somme SHA-256/512 introuvable ou invalide pour $file : '$expected'" >&2
        return 1
    fi
}

# sum_from_list <url de la liste> <nom du fichier>
#   Extrait la somme d'un fichier depuis une liste au format sha256sum
#   (« <somme>  <nom> » ou « <somme> *<nom> »).
sum_from_list() {
    local list
    list=$(mktemp)
    fetch "$1" "$list"
    # Certaines listes (PowerShell) sont en UTF-16 avec BOM et fins de ligne CRLF
    if [[ $(head -c 2 "$list" | od -An -tx1 | tr -d ' ') == fffe ]]; then
        iconv -f UTF-16 -t UTF-8 "$list" > "$list.utf8" && mv "$list.utf8" "$list"
    fi
    tr -d '\r' < "$list" \
        | awk -v name="$2" '{ f = $2; sub(/^\*/, "", f); sub(/^.*\//, "", f) } f == name { print $1; exit }'
    rm -f "$list"
}

# sum_from_url <url>
#   Lit une somme publiée seule dans un fichier (premier mot du fichier).
sum_from_url() {
    curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors "$1" | awk 'NR == 1 { print $1 }'
}

# arch_name <amd64-name> <arm64-name>
#   Renvoie le nom d'architecture propre à un projet selon TARGETARCH.
arch_name() {
    case "${TARGETARCH:?TARGETARCH non défini}" in
        amd64) echo "$1" ;;
        arm64) echo "$2" ;;
        *) echo "Architecture non prise en charge : $TARGETARCH" >&2; return 1 ;;
    esac
}
