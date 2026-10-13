#!/usr/bin/env python3
# Description d'une release GitHub : outils mis à jour (cloudbox-versions), commits qui touchent
# l'image, paquets Ubuntu mis à jour (dpkg), liste complète des versions.
# Comparaison avec les fichiers de la release précédente (--prev-dir), s'il y en a une.
# Écrit la description (en anglais, comme le README) dans --out et « changed=true|false » sur
# stdout (à ajouter à $GITHUB_OUTPUT) : false si rien n'a changé depuis la release précédente.
import argparse
import json
from pathlib import Path

# Au-delà, le détail des paquets est tronqué (limite de taille de la description d'une release)
MAX_PACKAGES = 300


def tools(path: Path) -> dict[str, dict]:
    data = json.loads(path.read_text())
    return {f"{t['category']} / {t['name']}": t for t in data["tools"]}


def packages(path: Path) -> dict[str, str]:
    out = {}
    for line in path.read_text().splitlines():
        if "\t" in line:
            name, version = line.split("\t", 1)
            out[name] = version
    return out


def diff(before: dict[str, str], after: dict[str, str]) -> list[tuple[str, str, str]]:
    rows = []
    for key in sorted(before.keys() | after.keys(), key=str.lower):
        b, a = before.get(key, "—"), after.get(key, "—")
        if b != a:
            rows.append((key, b, a))
    return rows


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--tag", required=True)
    p.add_argument("--image", required=True)
    p.add_argument("--repo-url", required=True)
    p.add_argument("--versions", type=Path, required=True)
    p.add_argument("--packages", type=Path, required=True)
    p.add_argument("--commits", type=Path, required=True, help="un sujet de commit par ligne")
    p.add_argument("--prev-tag", default="")
    p.add_argument("--prev-dir", type=Path)
    p.add_argument("--out", type=Path, required=True)
    args = p.parse_args()

    cur_tools = tools(args.versions)
    cur_pkgs = packages(args.packages)
    commits = [c for c in args.commits.read_text().splitlines() if c.strip()]
    prev_versions = args.prev_dir / "versions.json" if args.prev_dir else None
    prev_packages = args.prev_dir / "packages.txt" if args.prev_dir else None
    first = not (prev_versions and prev_versions.is_file())

    tool_rows: list[tuple[str, str, str]] = []
    pkg_rows: list[tuple[str, str, str]] = []
    if not first:
        prev = tools(prev_versions)
        tool_rows = diff({k: v["version"] for k, v in prev.items()},
                         {k: v["version"] for k, v in cur_tools.items()})
        if prev_packages and prev_packages.is_file():
            pkg_rows = diff(packages(prev_packages), cur_pkgs)

    lines = [
        "Images:",
        "",
        f"- `{args.image}:{args.tag}-web` (= `:web`, `:latest`)",
        f"- `{args.image}:{args.tag}-cli` (= `:cli`)",
        "",
    ]
    if first:
        lines += ["First release: the next ones list what changed since the previous one.", ""]
    else:
        lines += [f"Changes since [{args.prev_tag}]({args.repo_url}/releases/tag/{args.prev_tag}).", ""]

        lines += ["## Updated tools", ""]
        if tool_rows:
            lines += ["| Tool | Before | After |", "|---|---|---|"]
            names = {**{k: v["name"] for k, v in prev.items()}, **{k: v["name"] for k, v in cur_tools.items()}}
            lines += [f"| {names[k]} | {b} | {a} |" for k, b, a in tool_rows]
        else:
            lines += ["No tool version change."]
        lines.append("")

        if commits:
            lines += ["## Changes in the image", ""]
            lines += [f"- {c}" for c in commits]
            lines.append("")

        lines += ["## Ubuntu packages", ""]
        if pkg_rows:
            shown = pkg_rows[:MAX_PACKAGES]
            lines += [f"<details><summary>{len(pkg_rows)} package(s) updated</summary>", "",
                      "| Package | Before | After |", "|---|---|---|"]
            lines += [f"| {k} | {b} | {a} |" for k, b, a in shown]
            if len(pkg_rows) > len(shown):
                lines += ["", f"… and {len(pkg_rows) - len(shown)} more (see `packages.txt`)."]
            lines += ["", "</details>"]
        else:
            lines += ["No Ubuntu package change."]
        lines.append("")

    lines += ["## All versions", "", f"<details><summary>{len(cur_tools)} tools, modules and extensions</summary>", "",
              "| Category | Tool | Version |", "|---|---|---|"]
    lines += [f"| {t['category']} | {t['name']} | {t['version']} |" for t in cur_tools.values()]
    lines += ["", "</details>", ""]
    args.out.write_text("\n".join(lines))

    changed = first or bool(tool_rows or pkg_rows or commits)
    print(f"changed={'true' if changed else 'false'}")


if __name__ == "__main__":
    main()
