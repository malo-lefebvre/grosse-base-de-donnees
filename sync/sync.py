# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx>=0.27", "cryptography>=43"]
# ///
"""Exporte le second cerveau (Notion + Readwise) pour le dashboard, chiffré avec ton mot de passe.

Usage : uv run sync/sync.py [--env-file chemin/.env ...] [--out site]
Variables : NOTION_TOKEN, DASHBOARD_PASSWORD, READWISE_TOKEN (facultatif).
"""

import argparse
import gzip
import html
import json
import os
import re
import struct
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((Path(__file__).with_name("config.json")).read_text("utf-8"))

NOTION_API = "https://api.notion.com/v1"
NOTION_VERSION = "2025-09-03"
READWISE_API = "https://readwise.io/api/v2"
MAX_TEXT = 20_000  # caractères de texte brut gardés par note pour la recherche


def fail(message: str) -> None:
    print(f"Erreur : {message}", file=sys.stderr)
    sys.exit(1)


def load_env(path: str) -> None:
    for line in Path(path).read_text("utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


# --- Notion -------------------------------------------------------------------

class Notion:
    def __init__(self, token: str):
        self.client = httpx.Client(base_url=NOTION_API, timeout=60, headers={
            "Authorization": f"Bearer {token}",
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        })
        self.calls = 0

    def request(self, method: str, path: str, body: dict | None = None, params: dict | None = None) -> dict:
        for attempt in range(6):
            self.calls += 1
            response = self.client.request(method, path, json=body, params=params)
            if response.status_code == 429 or response.status_code >= 500:
                time.sleep(float(response.headers.get("Retry-After", 2 ** attempt)))
                continue
            if response.status_code == 401:
                fail("token Notion invalide (NOTION_TOKEN).")
            if response.status_code >= 400:
                fail(f"Notion {response.status_code} sur {path} : {response.text[:300]}")
            return response.json()
        fail("Notion ne répond pas (trop de requêtes), réessaie plus tard.")

    def query_all(self, data_source_id: str) -> list[dict]:
        results, cursor = [], None
        while True:
            body: dict = {"page_size": 100}
            if cursor:
                body["start_cursor"] = cursor
            data = self.request("POST", f"/data_sources/{data_source_id}/query", body)
            results += data["results"]
            if not data.get("has_more"):
                return results
            cursor = data["next_cursor"]

    def children(self, block_id: str) -> list[dict]:
        results, cursor = [], None
        while True:
            params = {"page_size": 100, **({"start_cursor": cursor} if cursor else {})}
            data = self.request("GET", f"/blocks/{block_id}/children", params=params)
            results += data["results"]
            if not data.get("has_more"):
                return results
            cursor = data["next_cursor"]


def prop(page: dict, name: str) -> dict:
    return page["properties"].get(name) or {}


def title_of(page: dict) -> str:
    for value in page["properties"].values():
        if value["type"] == "title":
            return "".join(t["plain_text"] for t in value["title"]).strip()
    return ""


def relation(page: dict, name: str) -> list[str]:
    return [r["id"] for r in prop(page, name).get("relation", [])]


def select(page: dict, name: str) -> str:
    value = prop(page, name)
    chosen = value.get("select") or value.get("status")
    return chosen["name"] if chosen else ""


def checkbox(page: dict, name: str) -> bool:
    return bool(prop(page, name).get("checkbox"))


def date_of(page: dict, name: str, fallback: str) -> str:
    value = prop(page, name).get("date")
    return (value or {}).get("start") or page.get(fallback, "")[:10]


def emoji(page: dict) -> str:
    icon = page.get("icon") or {}
    return icon.get("emoji", "") if icon.get("type") == "emoji" else ""


# --- Blocs Notion → HTML --------------------------------------------------------

def safe_url(href: str | None) -> str | None:
    if not href:
        return None
    if href.startswith("/"):
        href = "https://www.notion.so" + href
    return href if re.match(r"^(https?:|mailto:)", href, re.I) else None


def color_class(color: str) -> str:
    return re.sub(r"[^a-z]", "", color)


def rich_html(items: list[dict]) -> str:
    out = []
    for item in items:
        text = html.escape(item.get("plain_text", "")).replace("\n", "<br>")
        if not text:
            continue
        a = item.get("annotations") or {}
        if a.get("code"):
            text = f"<code>{text}</code>"
        if a.get("bold"):
            text = f"<strong>{text}</strong>"
        if a.get("italic"):
            text = f"<em>{text}</em>"
        if a.get("strikethrough"):
            text = f"<s>{text}</s>"
        if a.get("underline"):
            text = f"<u>{text}</u>"
        color = a.get("color", "default")
        if color.endswith("_background"):
            text = f'<mark class="hl-{color_class(color[:-11])}">{text}</mark>'
        elif color != "default":
            text = f'<span class="tc-{color_class(color)}">{text}</span>'
        url = safe_url(item.get("href"))
        if url:
            text = f'<a href="{html.escape(url)}" target="_blank" rel="noopener">{text}</a>'
        out.append(text)
    return "".join(out)


def plain(items: list[dict]) -> str:
    return "".join(i.get("plain_text", "") for i in items)


class Renderer:
    """Transforme le contenu d'une note en HTML, en gardant le texte brut et l'essentiel (gras, surligné)."""

    def __init__(self, notion: Notion, page_url: str):
        self.notion = notion
        self.page_url = page_url
        self.text: list[str] = []
        self.essentials: list[dict] = []

    def collect(self, items: list[dict]) -> None:
        if not items:
            return
        self.text.append(plain(items))
        run: list[str] = []
        highlighted = False

        def flush():
            nonlocal highlighted
            passage = " ".join("".join(run).split())
            if len(passage) >= 3:
                self.essentials.append({"t": passage, "h": highlighted})
            run.clear()
            highlighted = False

        for item in items:
            a = item.get("annotations") or {}
            marked = a.get("color", "").endswith("_background")
            if a.get("bold") or marked:
                run.append(item.get("plain_text", ""))
                highlighted = highlighted or marked
            elif run and not item.get("plain_text", "").strip():
                run.append(item.get("plain_text", ""))
            else:
                flush()
        flush()

    def page(self, page_id: str) -> str:
        return self.blocks(self.notion.children(page_id))

    def kids(self, block: dict) -> str:
        return self.blocks(self.notion.children(block["id"])) if block.get("has_children") else ""

    def blocks(self, blocks: list[dict]) -> str:
        out, i = [], 0
        lists = {"bulleted_list_item": "<ul>", "numbered_list_item": "<ol>", "to_do": '<ul class="todo">'}
        while i < len(blocks):
            kind = blocks[i]["type"]
            if kind in lists:
                items = []
                while i < len(blocks) and blocks[i]["type"] == kind:
                    items.append(self.list_item(blocks[i]))
                    i += 1
                close = "</ol>" if kind == "numbered_list_item" else "</ul>"
                out.append(lists[kind] + "".join(items) + close)
                continue
            out.append(self.block(blocks[i]))
            i += 1
        return "".join(out)

    def list_item(self, block: dict) -> str:
        data = block[block["type"]]
        self.collect(data.get("rich_text", []))
        content = rich_html(data.get("rich_text", [])) + self.kids(block)
        if block["type"] == "to_do":
            done = data.get("checked")
            return f'<li class="{"done" if done else ""}"><span class="check">{"✓" if done else ""}</span><span>{content}</span></li>'
        return f"<li>{content}</li>"

    def media(self, data: dict, label: str) -> str:
        source = data.get("external", {}).get("url") if data.get("type") == "external" else None
        caption = rich_html(data.get("caption", []))
        url = safe_url(source or data.get("url"))
        if label == "Image" and url:
            alt = html.escape(plain(data.get("caption", [])))
            figcaption = f"<figcaption>{caption}</figcaption>" if caption else ""
            return f'<figure><img src="{html.escape(url)}" alt="{alt}" loading="lazy">{figcaption}</figure>'
        if url:
            return f'<a class="bookmark" href="{html.escape(url)}" target="_blank" rel="noopener"><span>{label}</span>{caption or html.escape(url)}</a>'
        # Fichier hébergé par Notion : son lien expire au bout d'une heure, on renvoie vers la note.
        return f'<a class="bookmark" href="{html.escape(self.page_url)}" target="_blank" rel="noopener"><span>{label}</span>Voir dans Notion</a>'

    def block(self, block: dict) -> str:
        kind = block["type"]
        data = block.get(kind) or {}
        items = data.get("rich_text", [])
        if kind == "paragraph":
            self.collect(items)
            inner = rich_html(items)
            kids = self.kids(block)
            return (f"<p>{inner}</p>" if inner else "") + (f'<div class="indent">{kids}</div>' if kids else "")
        if kind in ("heading_1", "heading_2", "heading_3"):
            self.collect(items)
            level = {"heading_1": 2, "heading_2": 3, "heading_3": 4}[kind]
            heading = f"<h{level}>{rich_html(items)}</h{level}>"
            if data.get("is_toggleable"):
                return f"<details><summary>{heading}</summary>{self.kids(block)}</details>"
            return heading
        if kind == "quote":
            self.collect(items)
            return f"<blockquote>{rich_html(items)}{self.kids(block)}</blockquote>"
        if kind == "callout":
            self.collect(items)
            icon = (data.get("icon") or {}).get("emoji", "💡")
            return f'<div class="callout"><span class="callout-icon">{html.escape(icon)}</span><div>{rich_html(items)}{self.kids(block)}</div></div>'
        if kind == "toggle":
            self.collect(items)
            return f"<details><summary>{rich_html(items)}</summary>{self.kids(block)}</details>"
        if kind == "code":
            self.text.append(plain(items))
            return f"<pre><code>{html.escape(plain(items))}</code></pre>"
        if kind == "divider":
            return "<hr>"
        if kind == "equation":
            return f"<p><code>{html.escape(data.get('expression', ''))}</code></p>"
        if kind == "image":
            return self.media(data, "Image")
        if kind in ("video", "audio", "file", "pdf", "embed", "bookmark", "link_preview"):
            labels = {"video": "Vidéo", "audio": "Audio", "file": "Fichier", "pdf": "PDF",
                      "embed": "Lien", "bookmark": "Lien", "link_preview": "Lien"}
            return self.media(data, labels[kind])
        if kind == "child_page":
            return f'<p class="muted">📄 {html.escape(data.get("title", ""))}</p>'
        if kind == "table":
            rows = self.notion.children(block["id"])
            body = []
            for index, row in enumerate(rows):
                cells = row.get("table_row", {}).get("cells", [])
                tag = "th" if index == 0 and data.get("has_column_header") else "td"
                for cell in cells:
                    self.text.append(plain(cell))
                body.append("<tr>" + "".join(f"<{tag}>{rich_html(c)}</{tag}>" for c in cells) + "</tr>")
            return f'<div class="table"><table>{"".join(body)}</table></div>'
        if kind == "column_list":
            return f'<div class="columns">{self.kids(block)}</div>'
        if kind == "column":
            return f'<div class="column">{self.kids(block)}</div>'
        if kind == "synced_block":
            return self.kids(block)
        return ""


# --- Lecture du PARA ------------------------------------------------------------

def read_notion(token: str) -> dict:
    notion = Notion(token)
    ids = CONFIG["notion"]

    areas = [
        {"id": p["id"], "name": title_of(p), "status": select(p, "Status"), "emoji": emoji(p), "url": p["url"]}
        for p in notion.query_all(ids["areas"]) if title_of(p)
    ]
    topics = [
        {"id": p["id"], "name": title_of(p), "areaIds": relation(p, "Areas"),
         "resourceIds": relation(p, "Resources"), "emoji": emoji(p), "url": p["url"]}
        for p in notion.query_all(ids["topics"]) if title_of(p) and not checkbox(p, "Archive it")
    ]
    resources = [
        {"id": p["id"], "name": title_of(p), "status": select(p, "Status"), "url": p["url"]}
        for p in notion.query_all(ids["resources"]) if title_of(p)
    ]
    projects = [
        {"id": p["id"], "name": title_of(p), "status": select(p, "Status"), "areaIds": relation(p, "Areas"),
         "due": (prop(p, "Due date").get("date") or {}).get("start", ""), "url": p["url"]}
        for p in notion.query_all(ids["projects"]) if title_of(p)
    ]

    pages = [p for p in notion.query_all(ids["notes"]) if title_of(p) and not checkbox(p, "Archive it")]
    notes = []
    for index, page in enumerate(pages, 1):
        print(f"  note {index}/{len(pages)} : {title_of(page)[:60]}", flush=True)
        renderer = Renderer(notion, page["url"])
        body = renderer.page(page["id"])
        source = prop(page, "Détail source").get("rich_text", [])
        notes.append({
            "id": page["id"],
            "title": title_of(page),
            "url": page["url"],
            "topicIds": relation(page, "Topic"),
            "sourceType": select(page, "Source Type"),
            "category": select(page, "Category"),
            "favourite": checkbox(page, "Favourite"),
            "created": date_of(page, "Date created", "created_time"),
            "edited": page.get("last_edited_time", ""),
            "source": rich_html(source),
            "sourceText": plain(source),
            "html": body,
            "text": "\n".join(renderer.text)[:MAX_TEXT],
            "essentials": renderer.essentials[:12],
        })
    print(f"  {notion.calls} requêtes Notion", flush=True)
    return {"areas": areas, "topics": topics, "resources": resources, "projects": projects, "notes": notes}


# --- Readwise -------------------------------------------------------------------

def read_readwise(token: str) -> dict:
    books, highlights, cursor = [], [], None
    with httpx.Client(timeout=60, headers={"Authorization": f"Token {token}"}) as client:
        while True:
            for attempt in range(6):
                response = client.get(f"{READWISE_API}/export/", params={"pageCursor": cursor} if cursor else {})
                if response.status_code != 429:
                    break
                time.sleep(float(response.headers.get("Retry-After", 10 * (attempt + 1))))
            if response.status_code == 401:
                fail("token Readwise invalide (READWISE_TOKEN).")
            if response.status_code >= 400:
                fail(f"Readwise {response.status_code} : {response.text[:200]}")
            data = response.json()
            for book in data.get("results", []):
                kept = [
                    h for h in book.get("highlights", [])
                    if not h.get("is_deleted") and not h.get("is_discard") and (h.get("text") or "").strip()
                ]
                if not kept:
                    continue
                book_id = str(book["user_book_id"])
                books.append({
                    "id": book_id,
                    "title": book.get("readable_title") or book.get("title") or "Sans titre",
                    "author": book.get("author") or "",
                    "category": book.get("category") or "",
                    "cover": book.get("cover_image_url") or "",
                    "url": book.get("readwise_url") or "",
                    "sourceUrl": book.get("source_url") or "",
                })
                for h in kept:
                    highlights.append({
                        "id": str(h["id"]),
                        "bookId": book_id,
                        "text": h["text"].strip(),
                        "note": (h.get("note") or "").strip(),
                        "date": (h.get("highlighted_at") or h.get("created_at") or "")[:10],
                        "url": h.get("readwise_url") or "",
                        "tags": [t["name"] for t in h.get("tags", []) if t.get("name")],
                    })
            cursor = data.get("nextPageCursor")
            if not cursor:
                break
    return {"books": books, "highlights": highlights}


# --- Chiffrement ----------------------------------------------------------------

def encrypt(payload: bytes, password: str) -> bytes:
    """Format : « PDB1 » + itérations (4 octets) + sel (16) + IV (12) + données AES-256-GCM."""
    salt = bytes.fromhex(CONFIG["salt"])
    iterations = int(CONFIG["iterations"])
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations).derive(password.encode())
    iv = os.urandom(12)
    return b"PDB1" + struct.pack(">I", iterations) + salt + iv + AESGCM(key).encrypt(iv, payload, None)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--env-file", action="append", default=[], help="fichier .env à charger (répétable)")
    parser.add_argument("--out", default=str(ROOT / "site"), help="dossier du site")
    args = parser.parse_args()
    for path in args.env_file:
        load_env(path)

    notion_token = os.environ.get("NOTION_TOKEN", "").strip()
    readwise_token = os.environ.get("READWISE_TOKEN", "").strip()
    password = os.environ.get("DASHBOARD_PASSWORD", "")
    if not notion_token:
        fail("NOTION_TOKEN manquant.")
    if len(password) < 8:
        fail("DASHBOARD_PASSWORD manquant ou trop court (8 caractères minimum).")

    print("Lecture de Notion…", flush=True)
    data = read_notion(notion_token)
    if readwise_token:
        print("Lecture de Readwise…", flush=True)
        data["readwise"] = read_readwise(readwise_token)
    else:
        data["readwise"] = {"books": [], "highlights": []}
    data["generatedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    data["repo"] = os.environ.get("GITHUB_REPOSITORY", "")

    raw = gzip.compress(json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), 9)
    out = Path(args.out) / "data.bin"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(encrypt(raw, password))
    print(
        f"OK : {len(data['notes'])} notes, {len(data['topics'])} topics, "
        f"{len(data['readwise']['highlights'])} surlignages → {out} ({out.stat().st_size // 1024} Ko)",
        flush=True,
    )


if __name__ == "__main__":
    main()
