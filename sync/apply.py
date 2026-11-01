# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx>=0.27", "cryptography>=43"]
# ///
"""Applique dans Notion ce que tu envoies depuis la page Révision : résumé en tête d'une note, note de connexion.

La page Révision ajoute des actions chiffrées dans envois.bin, sur la branche « progression ». GitHub lance ce
script à chaque envoi : il applique les actions, les retire de la file et garde le résultat pour la page.
Rien de personnel n'est écrit dans le journal, qui est public sur un dépôt public.

Usage : uv run sync/apply.py <dossier où la branche progression est extraite>
"""

import json
import os
import subprocess
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

import httpx

import vault

CONFIG = json.loads(Path(__file__).with_name("config.json").read_text("utf-8"))
FILE = "envois.bin"
KEEP_RESULTS = 30


class Notion:
    def __init__(self, token: str):
        self.client = httpx.Client(base_url="https://api.notion.com/v1", timeout=60, headers={
            "Authorization": f"Bearer {token}",
            "Notion-Version": "2025-09-03",
            "Content-Type": "application/json",
        })

    def request(self, method: str, path: str, body: dict | None = None) -> dict:
        for attempt in range(6):
            response = self.client.request(method, path, json=body)
            if response.status_code == 429 or response.status_code >= 500:
                time.sleep(float(response.headers.get("Retry-After", 2 ** attempt)))
                continue
            if response.status_code >= 400:
                raise RuntimeError(f"Notion {response.status_code} : {response.json().get('message', '')[:200]}")
            return response.json()
        raise RuntimeError("Notion ne répond pas")


def text(content: str, **annotations) -> dict:
    item: dict = {"type": "text", "text": {"content": content[:2000]}}
    if annotations:
        item["annotations"] = annotations
    return item


def paragraph(content: str) -> dict:
    chunks = [content[i:i + 2000] for i in range(0, len(content), 2000)] or [""]
    return {"object": "block", "type": "paragraph", "paragraph": {"rich_text": [text(c) for c in chunks]}}


def add_summary(notion: Notion, action: dict) -> str:
    bullets = [b.strip() for b in action.get("bullets", []) if b.strip()][:8]
    if not bullets:
        raise ValueError("résumé vide")
    callout = {"object": "block", "type": "callout", "callout": {
        "rich_text": [text("Résumé", bold=True)],
        "icon": {"type": "emoji", "emoji": "🧠"},
        "color": "gray_background",
        "children": [{"object": "block", "type": "bulleted_list_item",
                      "bulleted_list_item": {"rich_text": [text(b)]}} for b in bullets],
    }}
    notion.request("PATCH", f"/blocks/{action['noteId']}/children",
                   {"children": [callout], "position": {"type": "start"}})
    return f"Résumé ajouté en tête de « {action.get('noteTitle', 'la note')} »"


def add_connection(notion: Notion, action: dict) -> str:
    topics: list[str] = []
    for note_id in (action["noteA"], action["noteB"]):
        page = notion.request("GET", f"/pages/{note_id}")
        for rel in page["properties"].get("Topic", {}).get("relation", []):
            if rel["id"] not in topics:
                topics.append(rel["id"])
    title = action.get("title", "").strip() or "Connexion"
    links = {"object": "block", "type": "paragraph", "paragraph": {"rich_text": [
        text("Notes reliées : "),
        {"type": "mention", "mention": {"page": {"id": action["noteA"]}}},
        text("  ·  "),
        {"type": "mention", "mention": {"page": {"id": action["noteB"]}}},
    ]}}
    body = [paragraph(p.strip()) for p in action.get("text", "").split("\n\n") if p.strip()]
    notion.request("POST", "/pages", {
        "parent": {"type": "data_source_id", "data_source_id": CONFIG["notion"]["notes"]},
        "properties": {
            "Name": {"title": [text(title[:200])]},
            "Source Type": {"select": {"name": "Idée"}},
            "Date created": {"date": {"start": date.today().isoformat()}},
            "Topic": {"relation": [{"id": t} for t in topics]},
        },
        "children": body + [links],
    })
    return f"Note « {title} » créée"


HANDLERS = {"summary": add_summary, "connection": add_connection}


def git(folder: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(folder), *args], capture_output=True, text=True)


def main() -> None:
    folder = Path(sys.argv[1])
    password = os.environ["DASHBOARD_PASSWORD"]
    branch = CONFIG.get("progressBranch", "progression")
    path = folder / FILE
    if not path.exists():
        print("Aucun envoi.")
        return
    outbox = vault.unseal(path.read_bytes(), password).get("outbox", [])
    if not outbox:
        print("Aucun envoi en attente.")
        return

    notion = Notion(os.environ["NOTION_TOKEN"])
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    results = []
    for action in outbox:
        try:
            message = HANDLERS[action["type"]](notion, action)
            results.append({"id": action["id"], "ok": True, "message": message, "at": now})
        except Exception as e:
            results.append({"id": action["id"], "ok": False, "message": str(e) or e.__class__.__name__, "at": now})
    print(f"{sum(r['ok'] for r in results)} envoi(s) appliqué(s), {sum(not r['ok'] for r in results)} en échec.")

    # On réécrit le fichier en tenant compte d'un envoi arrivé pendant ce temps.
    done = {r["id"] for r in results}
    salt, iterations = bytes.fromhex(CONFIG["salt"]), int(CONFIG["iterations"])
    git(folder, "config", "user.name", "github-actions[bot]")
    git(folder, "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    for _ in range(5):
        git(folder, "fetch", "origin", branch)
        git(folder, "reset", "--hard", f"origin/{branch}")
        latest = vault.unseal(path.read_bytes(), password) if path.exists() else {}
        latest["outbox"] = [a for a in latest.get("outbox", []) if a["id"] not in done]
        latest["results"] = (results + latest.get("results", []))[:KEEP_RESULTS]
        latest["updatedAt"] = now
        path.write_bytes(vault.seal(latest, password, salt, iterations))
        git(folder, "add", FILE)
        git(folder, "commit", "-m", "Envois appliqués")
        if git(folder, "push", "origin", f"HEAD:{branch}").returncode == 0:
            break
        time.sleep(3)
    else:
        sys.exit("Impossible d'enregistrer le résultat des envois.")

    # Relance la synchro pour que le site montre les changements sans attendre l'heure suivante.
    if any(r["ok"] for r in results) and os.environ.get("GH_TOKEN") and os.environ.get("GITHUB_REPOSITORY"):
        subprocess.run(["gh", "workflow", "run", "sync.yml", "--ref", "main", "-R", os.environ["GITHUB_REPOSITORY"]])


if __name__ == "__main__":
    main()
