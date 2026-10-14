#!/usr/bin/env python3
"""Captures d'écran du README (lancé par capture.sh, réseau partagé avec le container)."""
import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8080"
TOKEN, OUT = sys.argv[1], sys.argv[2]
VIEW = {"width": 1440, "height": 900}
A = ".ws-view.active"


def sign_in(page):
    page.goto(BASE + "/")
    page.fill("#token", TOKEN)
    page.click("button[type=submit]")
    page.wait_for_selector(".home .version-card", timeout=20000)


def run(page, frame, command, wait=1500):
    """Tape une commande dans un terminal du workspace et l'exécute."""
    page.locator(frame).click()
    page.keyboard.type(command)
    page.keyboard.press("Enter")
    page.wait_for_timeout(wait)


with sync_playwright() as p:
    browser = p.chromium.launch()

    # Accueil
    ctx = browser.new_context(viewport=VIEW, locale="en-US")
    page = ctx.new_page()
    sign_in(page)
    page.wait_for_timeout(1000)
    page.screenshot(path=f"{OUT}/home.png")

    # Workspace de production : terminaux et VS Code
    page.click(".sidebar a.nav-item[href='#/w/contoso-prd']")
    page.wait_for_selector(f"{A} .dv-tab", timeout=20000)
    code = page.frame_locator(f"{A} iframe[src^='/code/']")
    code.locator(".monaco-workbench").wait_for(timeout=60000)
    page.wait_for_timeout(6000)  # démarrage des shells
    pwsh = f"{A} iframe[src^='/term/pwsh/']"
    bash = f"{A} iframe[src^='/term/bash/']"
    run(page, pwsh, "Get-Module -ListAvailable Az.Accounts, Microsoft.Graph.Authentication, "
                    "ExchangeOnlineManagement, PnP.PowerShell | Format-Table Name, Version", 9000)
    run(page, bash, "kubectl version --client; helm version --short; tofu version | head -n 1", 4000)
    try:
        code.get_by_role("treeitem", name="deploy.ps1").click(timeout=10000)
        page.wait_for_timeout(2500)
    except Exception as err:  # noqa: BLE001
        print("VS Code : fichier non ouvert", err)
    page.mouse.move(0, 0)
    page.screenshot(path=f"{OUT}/workspace.png")

    # Panneau Connexions : commande saisie dans le terminal Bash, sans être exécutée
    page.locator(bash).click()
    page.keyboard.press("Control+Shift+K")
    page.wait_for_selector(f"{A} .conn-drawer")
    page.click(f"{A} .conn-drawer [data-cmd=az] .insert")
    page.wait_for_timeout(1500)
    page.mouse.move(0, 0)
    page.screenshot(path=f"{OUT}/connections.png")

    # Paramètres du workspace
    page.click(f"{A} .ws-toolbar button:has-text('Settings')")
    page.wait_for_selector("dialog[open] .ws-settings")
    page.wait_for_timeout(500)
    page.screenshot(path=f"{OUT}/settings.png")
    page.click("dialog[open] .dialog-close")

    # Fenêtre Settings de la barre latérale, onglet Terminal puis onglet Assistant IA
    page.click(".sidebar-foot button.nav-item")
    page.click("dialog[open] .prefs-tabs button >> nth=2")
    page.wait_for_selector("dialog[open] .terminal-prefs")
    page.wait_for_timeout(500)
    page.screenshot(path=f"{OUT}/terminal-settings.png")
    page.click("dialog[open] .prefs-tabs button >> nth=3")
    page.wait_for_selector("dialog[open] .ai-provider")
    page.wait_for_timeout(500)
    page.screenshot(path=f"{OUT}/preferences.png")
    ctx.close()

    # Accueil en thème sombre
    ctx = browser.new_context(viewport=VIEW, locale="en-US", color_scheme="dark")
    page = ctx.new_page()
    sign_in(page)
    page.wait_for_timeout(1000)
    page.screenshot(path=f"{OUT}/home-dark.png")
    ctx.close()
    browser.close()
