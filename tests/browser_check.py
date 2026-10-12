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
A = ".ws-view.active"  # vue du workspace affiché (d'autres peuvent rester montées, masquées)
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


BUFFER_JS = (
    "() => { const b = window.term?.buffer.active; if (!b) return null;"
    " const l = []; for (let i = 0; i < b.length; i++) { const r = b.getLine(i);"
    "   const t = r?.translateToString(true) || ''; if (r?.isWrapped && l.length) l[l.length - 1] += t; else l.push(t); }"
    " return l.join('\\n'); }")


def terminal_text(page, frame_selector):
    """Contenu du terminal (xterm.js de ttyd, exposé en window.term), lignes coupées réassemblées."""
    return page.frame_locator(frame_selector).locator("body").evaluate(BUFFER_JS)


def tab_titles(page):
    return sorted(page.locator(f"{A} .dv-tab .cb-tab-label").all_inner_texts())


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 1400, "height": 900})
    context.grant_permissions(["clipboard-read", "clipboard-write"], origin=BASE)
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
    check("accueil affiché après connexion", page.locator(".home .create-ws").count() == 1)
    check("barre latérale", page.locator(".sidebar .nav-new").count() == 1)
    page.wait_for_selector(".context-bar .chip", timeout=15000)
    check("barre de contexte réel", page.locator(".context-bar .chip").count() >= 3)
    page.screenshot(path=f"{OUT}/1-accueil.png", full_page=True)

    # --- Création d'un workspace PRD depuis la barre latérale ---
    page.click(".sidebar .nav-new")
    form = "dialog[open] .create-ws"
    page.wait_for_selector(form)
    page.fill(f"{form} input >> nth=0", "Client démo PRD")
    check("identifiant proposé", page.input_value(f"{form} input >> nth=1") == WS_ID,
          page.input_value(f"{form} input >> nth=1"))
    page.click(f"{form} .env-option.env-prd")
    page.click(f"{form} button[type=submit]")
    page.wait_for_selector(f"{A} .dv-tab", timeout=20000)
    check("URL du workspace", page.url.endswith(f"#/w/{WS_ID}"), page.url)
    check("cadre PRD", page.locator(f"{A}.env-frame-prd").count() == 1)
    check("mention « partagé entre workspaces »", page.locator(f"{A} .chip-warn").count() == 1)
    check("workspace dans la barre latérale, actif", page.locator(f".sidebar a.nav-item.active[href='#/w/{WS_ID}']").count() == 1)
    page.wait_for_timeout(8000)  # chargement des terminaux et de VS Code
    check("trois panneaux par défaut", tab_titles(page) == ["Bash 2", "PowerShell 1", "VS Code"], tab_titles(page))
    check("sessions tmux des panneaux", sessions(page) == [f"{WS_ID}_bash_2", f"{WS_ID}_pwsh_1"], sessions(page))
    frames = page.locator(f"{A} .panel-frame iframe")
    srcs = sorted(frames.evaluate_all("els => els.map(e => e.getAttribute('src'))"))
    check("iframes", srcs == [f"/code/?folder=%2Fhome%2Fdev%2Fworkspaces%2F{WS_ID}",
                              f"/term/bash/?arg={WS_ID}~2", f"/term/pwsh/?arg={WS_ID}~1"], srcs)
    code = page.frame_locator(f"{A} iframe[src^='/code/']")
    try:
        code.locator(".monaco-workbench").wait_for(timeout=30000)
        check("VS Code chargé dans son panneau", True)
    except Exception as err:  # noqa: BLE001
        check("VS Code chargé dans son panneau", False, str(err)[:200])
    page.screenshot(path=f"{OUT}/2-workspace.png")

    # --- Glisser le séparateur vertical au-dessus des iframes ---
    sash = page.locator(f"{A} .dv-split-view-container.dv-horizontal > .dv-sash-container > .dv-sash").first
    left = page.locator(f"{A} .dv-groupview").first
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
    page.locator(f"{A} .ws-toolbar button", has_text="+ PowerShell").click()
    page.wait_for_timeout(6000)
    check("panneau ajouté", "PowerShell 3" in tab_titles(page), tab_titles(page))
    page.wait_for_timeout(1500)  # sauvegarde différée
    expected_sessions = sessions(page)
    check("session du nouveau panneau", f"{WS_ID}_pwsh_3" in expected_sessions, expected_sessions)
    width_saved = left.bounding_box()["width"]
    page.reload()
    page.wait_for_selector(f"{A} .dv-tab", timeout=20000)
    page.wait_for_timeout(5000)
    check("disposition restaurée après rechargement", tab_titles(page) == ["Bash 2", "PowerShell 1", "PowerShell 3", "VS Code"],
          tab_titles(page))
    check("largeur restaurée", abs(page.locator(f"{A} .dv-groupview").first.bounding_box()["width"] - width_saved) < 5)
    check("aucune session fermée par le rechargement", sessions(page) == expected_sessions, sessions(page))

    # --- Deux onglets sur le même workspace : chacun ajoute un terminal, sessions distinctes ---
    page2 = context.new_page()
    page2.on("dialog", lambda d: d.accept())
    page2.goto(f"{BASE}/#/w/{WS_ID}")
    page2.wait_for_selector(f"{A} .dv-tab", timeout=20000)
    page2.wait_for_timeout(3000)
    before_two = set(sessions(page))
    page.locator(f"{A} .ws-toolbar button", has_text="+ PowerShell").click()
    page2.locator(f"{A} .ws-toolbar button", has_text="+ PowerShell").click()
    page.wait_for_timeout(6000)
    new_sessions = sorted(set(sessions(page)) - before_two)
    check("deux onglets : deux nouvelles sessions distinctes", len(new_sessions) == 2, new_sessions)
    page2.close()
    page.reload()
    page.wait_for_selector(f"{A} .dv-tab", timeout=20000)
    page.wait_for_timeout(3000)
    # On revient à la disposition attendue par la suite : fermeture des panneaux ajoutés par cette page
    for title in [t for t in tab_titles(page) if t not in ("Bash 2", "PowerShell 1", "PowerShell 3", "VS Code")]:
        page.locator(f"{A} .dv-tab", has_text=title).locator(".cb-tab-close").click()
        page.wait_for_timeout(1500)
    for s in new_sessions:  # session de l'autre onglet, absente de cette disposition (dernière sauvegarde gagnante)
        page.evaluate(f"fetch('/api/workspaces/{WS_ID}/sessions/{s}', {{method: 'DELETE', headers: {{'Content-Type': 'application/json'}}}})")
    page.wait_for_timeout(1500)
    expected_sessions = sessions(page)
    check("retour à la disposition de référence", tab_titles(page) == ["Bash 2", "PowerShell 1", "PowerShell 3", "VS Code"],
          tab_titles(page))

    # --- Déplacer un onglet ne ferme pas de session ---
    src_tab = page.locator(f"{A} .dv-tab", has_text="PowerShell 3")
    dst = page.locator(f"{A} .dv-groupview").last.bounding_box()
    src_tab.drag_to(page.locator(f"{A} .dv-groupview").last, force=True, target_position={"x": dst["width"] / 2, "y": dst["height"] / 2})
    page.wait_for_timeout(1500)
    check("déplacement d'onglet : sessions intactes", sessions(page) == expected_sessions, sessions(page))

    # --- Fermeture explicite : la session est arrêtée ---
    page.locator(f"{A} .dv-tab", has_text="PowerShell 3").locator(".cb-tab-close").click()
    page.wait_for_timeout(2500)
    check("panneau fermé", "PowerShell 3" not in tab_titles(page), tab_titles(page))
    check("session fermée", f"{WS_ID}_pwsh_3" not in sessions(page), sessions(page))
    page.reload()
    page.wait_for_selector(f"{A} .dv-tab", timeout=20000)
    page.wait_for_timeout(2000)
    check("fermeture enregistrée", tab_titles(page) == ["Bash 2", "PowerShell 1", "VS Code"], tab_titles(page))
    page.screenshot(path=f"{OUT}/3-workspace-final.png")

    # --- Panneau Connexions : paramètres du workspace, cible d'insertion, saisie sans Entrée ---
    D = f"{A} .conn-drawer"
    page.click(f"{A} .conn-toggle")
    page.wait_for_selector(D)
    check("panneau Connexions ouvert", page.locator(D).count() == 1)
    check("commande az sans tenant", page.locator(f"{D} [data-cmd=az] .conn-cmd").inner_text() == "az login --use-device-code")
    check("PnP : valeurs à compléter", "app-id" in page.locator(f"{D} [data-cmd=pnp] .conn-missing").inner_text())
    page.click(f"{D} .link-button")
    sform = "dialog[open] .ws-settings"
    page.wait_for_selector(sform)
    page.fill(f"{sform} input[name=tenant]", "contoso.onmicrosoft.com")
    page.fill(f"{sform} input[name=clientId]", "pas-un-guid")
    page.click(f"{sform} button[type=submit]")
    page.wait_for_selector(f"{sform} .error")
    check("paramètre invalide refusé", "ClientId" in page.locator(f"{sform} .error").inner_text())
    page.fill(f"{sform} input[name=clientId]", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    page.click(f"{sform} button[type=submit]")
    page.wait_for_selector(sform, state="detached")
    check("az complétée avec le tenant",
          page.locator(f"{D} [data-cmd=az] .conn-cmd").inner_text() == "az login --use-device-code --tenant contoso.onmicrosoft.com")
    pnp = page.locator(f"{D} [data-cmd=pnp] .conn-cmd").inner_text()
    check("PnP : URL déduite du tenant et ClientId",
          pnp.startswith("Connect-PnPOnline -Url https://contoso.sharepoint.com -DeviceLogin -ClientId aaaaaaaa-"), pnp)
    check("cadre PRD conservé", page.locator(f"{A}.env-frame-prd").count() == 1)

    bash_frame = f"{A} iframe[src^='/term/bash/?arg={WS_ID}~2']"
    page.locator(f"{A} iframe[src^='/term/pwsh/?arg={WS_ID}~1']").click()
    page.wait_for_timeout(300)
    page.locator(bash_frame).click()
    page.wait_for_timeout(300)
    check("cible : dernier terminal utilisé", "Bash 2" in page.locator(f"{D} [data-cmd=az] .insert").inner_text(),
          page.locator(f"{D} [data-cmd=az] .insert").inner_text())
    check("cmdlet PowerShell : terminal PowerShell", "PowerShell 1" in page.locator(f"{D} [data-cmd=graph] .insert").inner_text(),
          page.locator(f"{D} [data-cmd=graph] .insert").inner_text())
    page.click(f"{D} [data-cmd=az] .insert")
    page.wait_for_selector(f"{D} .conn-message")
    check("saisie confirmée", "Bash 2" in page.locator(f"{D} .conn-message").inner_text(), page.locator(f"{D} .conn-message").inner_text())
    page.wait_for_timeout(800)
    check("focus rendu au terminal", page.evaluate("document.activeElement?.getAttribute('src') || ''").startswith("/term/bash/"))
    line = terminal_text(page, bash_frame)
    if line is None:
        print("  (tampon xterm inaccessible : contenu du terminal non vérifié)")
    else:
        # dernière ligne non vide avant la barre d'état de tmux
        last = [l for l in line.split("\n") if l.strip()][-2:-1]
        check("commande saisie, non exécutée (dernière ligne)",
              bool(last) and last[0].rstrip().endswith("az login --use-device-code --tenant contoso.onmicrosoft.com"), last)
    page.keyboard.press("Control+Shift+K")  # depuis le terminal (focus dans l'iframe)
    page.wait_for_timeout(300)
    check("Ctrl+Maj+K depuis un terminal ferme le panneau", page.locator(D).count() == 0)
    page.keyboard.press("Control+Shift+K")
    page.wait_for_selector(D)
    page.reload()
    page.wait_for_selector(f"{A} .dv-tab", timeout=20000)
    check("panneau Connexions rouvert après rechargement", page.locator(D).count() == 1)
    page.wait_for_timeout(2000)
    page.screenshot(path=f"{OUT}/4-connexions.png")
    page.click(f"{D} .conn-filter")  # au chargement, ttyd donne le focus au terminal
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    check("Échap ferme le panneau", page.locator(D).count() == 0)

    # --- Copier-coller dans tmux : double-clic copié (OSC 52), Ctrl+V colle ---
    page.locator(bash_frame).click()
    page.keyboard.press("Control+U")  # efface la commande insérée plus haut
    page.keyboard.type("clear; echo cloudboxcopie42")
    page.keyboard.press("Enter")
    page.wait_for_timeout(1000)
    term = page.frame_locator(bash_frame)
    pos = term.locator("body").evaluate(
        "() => { const t = window.term, b = t.buffer.active;"
        " for (let y = 0; y < t.rows; y++) { const s = b.getLine(b.viewportY + y)?.translateToString(true) || '';"
        "   if (s.trim() === 'cloudboxcopie42') { const r = document.querySelector('.xterm-screen').getBoundingClientRect();"
        "     return { x: (3.5 * r.width) / t.cols, y: ((y + 0.5) * r.height) / t.rows }; } } return null; }")
    if pos is None:
        check("copie : ligne repérée dans le terminal", False, (terminal_text(page, bash_frame) or "")[-300:])
    else:
        screen_box = term.locator(".xterm-screen").bounding_box()  # coordonnées dans la page principale
        page.mouse.dblclick(screen_box["x"] + pos["x"], screen_box["y"] + pos["y"])
        page.wait_for_timeout(1500)
        clip = page.evaluate("navigator.clipboard.readText()")
        check("double-clic dans tmux : mot copié dans le presse-papiers", clip == "cloudboxcopie42", repr(clip))
    page.evaluate("navigator.clipboard.writeText('echo colle-ok')")
    page.locator(bash_frame).click()
    page.keyboard.press("Control+U")
    page.keyboard.press("Control+V")
    page.wait_for_timeout(800)
    lines = [l for l in (terminal_text(page, bash_frame) or "").split("\n") if l.strip()][-2:-1]
    check("Ctrl+V colle le presse-papiers", bool(lines) and lines[0].rstrip().endswith("echo colle-ok"), lines)
    page.keyboard.press("Control+U")

    # --- Navigation entre workspaces par la barre latérale, sans rechargement ---
    pwsh_frame = f"{A} iframe[src^='/term/pwsh/?arg={WS_ID}~1']"
    origin_before = page.locator(pwsh_frame).evaluate("f => f.contentWindow.performance.timeOrigin")
    page.click(".sidebar .nav-new")
    page.fill("dialog[open] .create-ws input >> nth=0", "Projet B")
    page.click("dialog[open] .create-ws button[type=submit]")
    page.wait_for_selector(f"{A}.env-frame-dev .dv-tab", timeout=20000)
    page.wait_for_timeout(4000)
    check("second workspace ouvert", page.url.endswith("#/w/projet-b"), page.url)
    check("deux workspaces dans la barre", page.locator(".sidebar .nav-list a.nav-item").count() == 2)
    check("deux workspaces gardés ouverts", page.locator(".sidebar .alive-dot").count() == 2)
    page.click(f".sidebar a.nav-item[href='#/w/{WS_ID}']")
    page.wait_for_timeout(1500)
    check("retour au premier workspace", page.locator(f"{A}.env-frame-prd").count() == 1)
    origin_after = page.locator(pwsh_frame).evaluate("f => f.contentWindow.performance.timeOrigin")
    check("terminal non rechargé au retour", origin_before == origin_after, f"{origin_before} → {origin_after}")
    check("disposition intacte au retour", tab_titles(page) == ["Bash 2", "PowerShell 1", "VS Code"], tab_titles(page))
    page.screenshot(path=f"{OUT}/5-navigation.png")

    # --- Barre latérale repliée, préférence conservée ---
    page.click(".sidebar-toggle")
    page.wait_for_timeout(400)
    check("barre repliée", page.locator(".sidebar.collapsed").count() == 1)
    page.reload()
    page.wait_for_selector(f"{A} .dv-tab", timeout=20000)
    check("repli conservé après rechargement", page.locator(".sidebar.collapsed").count() == 1)
    page.screenshot(path=f"{OUT}/6-barre-repliee.png")
    page.click(".sidebar-toggle")

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
