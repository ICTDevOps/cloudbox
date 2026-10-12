#!/usr/bin/env python3
"""Test navigateur du portail (Playwright, Chromium headless).

Lancé par tests/smoke-browser.sh dans un container qui partage le réseau du container Cloudbox
(http://127.0.0.1:8080). Les sessions tmux sont vérifiées via l'API du portail.

    python3 browser_check.py <jeton> <dossier de captures>
"""
import json
import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8080"
TOKEN, OUT = sys.argv[1], sys.argv[2]
WS_ID = "client-demo-prd"
failed = False


def check(label, ok, detail=""):
    global failed
    if ok:
        print(f"  \033[32mOK\033[0m    {label}")
    else:
        failed = True
        print(f"  \033[31mÉCHEC\033[0m {label} {detail}")


def sessions(page):
    data = page.evaluate(f"fetch('/api/workspaces/{WS_ID}').then(r => r.json())")
    return sorted(data.get("sessions", []))


def tab_titles(page):
    return sorted(page.locator(".dv-tab .cb-tab-label").all_inner_texts())


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 1400, "height": 900})
    page = context.new_page()
    console = []
    page.on("console", lambda m: console.append(f"{m.type}: {m.text}"))
    page.on("pageerror", lambda e: console.append(f"pageerror: {e}"))
    page.on("dialog", lambda d: d.accept())  # confirmations (fermeture d'un terminal)

    # --- Connexion ---
    page.goto(BASE + "/")
    check("page de connexion", page.locator("#login-form").count() == 1)
    page.fill("#token", TOKEN)
    page.click("button[type=submit]")
    page.wait_for_selector(".ws-grid", timeout=15000)
    check("accueil affiché après connexion", page.locator(".create-ws").count() == 1)
    page.wait_for_selector(".context-bar .chip", timeout=15000)
    check("barre de contexte réel", page.locator(".context-bar .chip").count() >= 3)
    page.screenshot(path=f"{OUT}/1-accueil.png", full_page=True)

    # --- Création d'un workspace PRD ---
    page.fill(".create-ws input >> nth=0", "Client démo PRD")
    check("identifiant proposé", page.input_value(".create-ws input >> nth=1") == WS_ID,
          page.input_value(".create-ws input >> nth=1"))
    page.click(".env-option.env-prd")
    page.click(".create-ws button[type=submit]")
    page.wait_for_selector(".dock .dv-tab", timeout=20000)
    check("URL du workspace", page.url.endswith(f"#/w/{WS_ID}"), page.url)
    check("cadre PRD", page.locator(".workspace.env-frame-prd").count() == 1)
    check("mention « partagé entre workspaces »", page.locator(".chip-warn").count() == 1)
    page.wait_for_timeout(8000)  # chargement des terminaux et de VS Code
    check("trois panneaux par défaut", tab_titles(page) == ["Bash 2", "PowerShell 1", "VS Code"], tab_titles(page))
    check("sessions tmux des panneaux", sessions(page) == [f"{WS_ID}_bash_2", f"{WS_ID}_pwsh_1"], sessions(page))
    frames = page.locator(".panel-frame iframe")
    srcs = sorted(frames.evaluate_all("els => els.map(e => e.getAttribute('src'))"))
    check("iframes", srcs == [f"/code/?folder=%2Fhome%2Fdev%2Fworkspaces%2F{WS_ID}",
                              f"/term/bash/?arg={WS_ID}~2", f"/term/pwsh/?arg={WS_ID}~1"], srcs)
    code = page.frame_locator("iframe[src^='/code/']")
    try:
        code.locator(".monaco-workbench").wait_for(timeout=30000)
        check("VS Code chargé dans son panneau", True)
    except Exception as err:  # noqa: BLE001
        check("VS Code chargé dans son panneau", False, str(err)[:200])
    page.screenshot(path=f"{OUT}/2-workspace.png")

    # --- Glisser le séparateur vertical au-dessus des iframes ---
    sash = page.locator(".dv-split-view-container.dv-horizontal > .dv-sash-container > .dv-sash").first
    left = page.locator(".dv-groupview").first
    before = left.bounding_box()["width"]
    box = sash.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    for step in range(1, 11):
        page.mouse.move(x - 20 * step, y)  # passe au-dessus de l'iframe de gauche
    page.mouse.up()
    page.wait_for_timeout(500)
    after = left.bounding_box()["width"]
    check("glisser le séparateur au-dessus d'une iframe", before - after > 150, f"{before} → {after}")

    # --- Ajout d'un panneau, puis rechargement : disposition et sessions retrouvées ---
    page.click("text=+ PowerShell")
    page.wait_for_timeout(6000)
    check("panneau ajouté", "PowerShell 3" in tab_titles(page), tab_titles(page))
    page.wait_for_timeout(1500)  # sauvegarde différée
    expected_sessions = sessions(page)
    check("session du nouveau panneau", f"{WS_ID}_pwsh_3" in expected_sessions, expected_sessions)
    width_saved = left.bounding_box()["width"]
    page.reload()
    page.wait_for_selector(".dock .dv-tab", timeout=20000)
    page.wait_for_timeout(5000)
    check("disposition restaurée après rechargement", tab_titles(page) == ["Bash 2", "PowerShell 1", "PowerShell 3", "VS Code"],
          tab_titles(page))
    check("largeur restaurée", abs(page.locator(".dv-groupview").first.bounding_box()["width"] - width_saved) < 5)
    check("aucune session fermée par le rechargement", sessions(page) == expected_sessions, sessions(page))

    # --- Déplacer un onglet ne ferme pas de session ---
    src_tab = page.locator(".dv-tab", has_text="PowerShell 3")
    dst = page.locator(".dv-groupview").last.bounding_box()
    src_tab.drag_to(page.locator(".dv-groupview").last, force=True, target_position={"x": dst["width"] / 2, "y": dst["height"] / 2})
    page.wait_for_timeout(1500)
    check("déplacement d'onglet : sessions intactes", sessions(page) == expected_sessions, sessions(page))

    # --- Fermeture explicite : la session est arrêtée ---
    page.locator(".dv-tab", has_text="PowerShell 3").locator(".cb-tab-close").click()
    page.wait_for_timeout(2500)
    check("panneau fermé", "PowerShell 3" not in tab_titles(page), tab_titles(page))
    check("session fermée", f"{WS_ID}_pwsh_3" not in sessions(page), sessions(page))
    page.reload()
    page.wait_for_selector(".dock .dv-tab", timeout=20000)
    page.wait_for_timeout(2000)
    check("fermeture enregistrée", tab_titles(page) == ["Bash 2", "PowerShell 1", "VS Code"], tab_titles(page))
    page.screenshot(path=f"{OUT}/3-workspace-final.png")

    # --- Console : aucune violation de CSP ni erreur JavaScript du portail ---
    # vsda.js : module propriétaire de VS Code absent de code-server (404 en text/plain, bloqué par
    # nosniff) ; bruit connu, sans rapport avec la CSP ni avec le portail
    csp = [c for c in console
           if ("Content Security Policy" in c or "Refused to" in c) and "/vsda/" not in c]
    errors = [c for c in console if c.startswith("pageerror")]
    check("aucune violation CSP", not csp, json.dumps(csp[:5], ensure_ascii=False))
    check("aucune erreur JavaScript", not errors, json.dumps(errors[:5], ensure_ascii=False))

    browser.close()

sys.exit(1 if failed else 0)
