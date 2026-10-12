#!/usr/bin/env bash
# Fonctions communes des tests de fumée.
set -uo pipefail

FAILED=0
pass() { printf '  \e[32mOK\e[0m    %s\n' "$*"; }
fail() { printf '  \e[31mÉCHEC\e[0m %s\n' "$*"; FAILED=1; }
section() { printf '\n\e[1m== %s\e[0m\n' "$*"; }

# expect <description> <attendu> <obtenu>
expect() {
    if [[ $3 == "$2" ]]; then pass "$1 ($3)"; else fail "$1 : attendu '$2', obtenu '$3'"; fi
}

finish() {
    echo
    if (( FAILED )); then echo "Test de fumée : ÉCHEC"; exit 1; fi
    echo "Test de fumée : OK"
}
