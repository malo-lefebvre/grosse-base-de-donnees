"""Cartes de révision préparées par Claude : questions, textes à trous, passages à apprendre par cœur et résumé.

Seules les notes nouvelles ou modifiées passent par Claude. Les autres reprennent les cartes déjà publiées
(le data.bin en ligne, ou le cache local quand on lance la synchro sur son PC).
"""

import json
import os
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

import vault

VERSION = 1  # à incrémenter pour tout régénérer
MODEL = os.environ.get("REVIEW_MODEL", "claude-opus-5-5")
CACHE = Path(__file__).with_name(".cache") / "review.json"
CLOZE = re.compile(r"\{\{(.+?)\}\}")

SYSTEM = """Tu prépares des cartes de révision (façon Anki) pour Malo, à partir d'une note de son second cerveau \
(méthode Building a Second Brain de Tiago Forte). Écris en français, même si la note est en anglais, sauf pour les \
passages à apprendre par cœur qui restent dans leur langue.

- questions : 0 à 3 questions précises dont la réponse est dans la note, avec une réponse courte (une ou deux \
phrases). Vise l'idée importante, pas un détail de forme. Aucune question si la note est trop courte ou vide.
- clozes : 0 à 2 phrases clés de la note (reprises presque mot pour mot), avec le mot ou le groupe de mots \
essentiel entre {{ et }}. Un seul trou par phrase.
- memorize : 0 à 2 passages à savoir par cœur, seulement si la note contient un verset biblique (ref = la \
référence, text = le verset tel qu'il est écrit dans la note) ou une déclaration à prononcer. Sinon une liste vide.
- summary : 2 à 4 puces courtes qui donnent l'essentiel de la note (la couche 4 de la Progressive Summarization). \
Liste vide si la note fait moins de trois lignes ou commence déjà par un résumé.

Qualité plutôt que quantité : une liste vide vaut mieux qu'une carte faible. Si des cartes actuelles sont \
fournies et sont toujours justes, recopie-les mot pour mot (cela garde la progression de Malo)."""

SCHEMA = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"question": {"type": "string"}, "answer": {"type": "string"}},
                "required": ["question", "answer"],
                "additionalProperties": False,
            },
        },
        "clozes": {"type": "array", "items": {"type": "string"}},
        "memorize": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"ref": {"type": "string"}, "text": {"type": "string"}},
                "required": ["ref", "text"],
                "additionalProperties": False,
            },
        },
        "summary": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["questions", "clozes", "memorize", "summary"],
    "additionalProperties": False,
}


def _site_url() -> str:
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    if "/" in repo:
        owner, name = repo.split("/", 1)
        return f"https://{owner}.github.io/{name}/"
    return os.environ.get("SITE_URL", "")


def previous_cards(password: str, site_url: str = "") -> dict:
    """Cartes déjà préparées : cache local d'abord, puis le data.bin publié s'il s'ouvre avec ce mot de passe."""
    cards: dict = {}
    if CACHE.exists():
        cards.update(json.loads(CACHE.read_text("utf-8")))
    url = _site_url() or site_url
    if url:
        try:
            response = httpx.get(url.rstrip("/") + "/data.bin", timeout=60, follow_redirects=True)
            response.raise_for_status()
            published = vault.unseal(response.content, password)
            cards.update(published.get("review", {}).get("notes", {}))
        except Exception as e:  # première synchro, mot de passe de test, site injoignable…
            print(f"  cartes publiées indisponibles ({e.__class__.__name__}), on garde le cache local", flush=True)
    return {k: v for k, v in cards.items() if v.get("v") == VERSION}


def _ask(client, note: dict, topics: list[str], current: dict | None) -> dict:
    parts = [
        f"<titre>{note['title']}</titre>",
        f"<topics>{', '.join(topics) or 'aucun'}</topics>",
        f"<source>{note.get('sourceType', '')} {note.get('sourceText', '')}</source>",
        f"<note>\n{note['text'][:12000]}\n</note>",
    ]
    if current:
        kept = {k: current.get(k, []) for k in ("qa", "cloze", "memorize")}
        parts.append(f"<cartes_actuelles>{json.dumps(kept, ensure_ascii=False)}</cartes_actuelles>")
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=8000,
        system=SYSTEM,
        messages=[{"role": "user", "content": "\n".join(parts)}],
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        # Si les filtres de sécurité refusent la requête, l'API la relance sur un modèle de repli.
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    )
    if response.stop_reason in ("refusal", "max_tokens"):
        raise RuntimeError(f"réponse incomplète ({response.stop_reason})")
    result = json.loads(next(b.text for b in response.content if b.type == "text"))
    return {
        "qa": [{"q": x["question"].strip(), "a": x["answer"].strip()}
               for x in result["questions"][:3] if x["question"].strip() and x["answer"].strip()],
        "cloze": [c.strip() for c in result["clozes"][:2] if len(CLOZE.findall(c)) == 1],
        "memorize": [{"ref": m["ref"].strip(), "text": m["text"].strip()}
                     for m in result["memorize"][:2] if m["text"].strip()],
        "summary": [s.strip() for s in result["summary"][:4] if s.strip()],
    }


def build(notes: list[dict], topic_names: dict[str, str], password: str, site_url: str = "") -> dict:
    previous = previous_cards(password, site_url)
    out, todo = {}, []
    for note in notes:
        old = previous.get(note["id"])
        if old and old.get("edited") == note["edited"]:
            out[note["id"]] = old
        elif len(note["text"].strip()) >= 40:
            todo.append((note, old))

    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if todo and not api_key:
        print(f"  ANTHROPIC_API_KEY absent : {len(todo)} note(s) sans nouvelles cartes", flush=True)
        for note, old in todo:
            if old:
                out[note["id"]] = old
        todo = []

    if todo:
        import anthropic

        client = anthropic.Anthropic(api_key=api_key, max_retries=3)
        print(f"  préparation des cartes de {len(todo)} note(s) avec Claude…", flush=True)

        def work(item):
            note, old = item
            try:
                cards = _ask(client, note, [topic_names.get(t, "") for t in note["topicIds"]], old)
                return note["id"], {"v": VERSION, "edited": note["edited"], **cards}
            except Exception as e:
                # Pas de titre dans le journal : il est public sur un dépôt public.
                print(f"  cartes impossibles pour une note ({e.__class__.__name__})", flush=True)
                return note["id"], old

        with ThreadPoolExecutor(max_workers=4) as pool:
            for note_id, cards in pool.map(work, todo):
                if cards:
                    out[note_id] = cards

    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(out, ensure_ascii=False), "utf-8")
    total = sum(len(c.get("qa", [])) + len(c.get("cloze", [])) + len(c.get("memorize", [])) for c in out.values())
    print(f"  {total} cartes préparées par l'IA pour {len(out)} notes", flush=True)
    return out
