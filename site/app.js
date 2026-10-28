// Second cerveau : dashboard PARA (Notion + Readwise). Les données arrivent chiffrées et sont ouvertes dans le navigateur.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeHref = (url) => (/^https?:\/\//i.test(url || "") ? url : "");
// Les couvertures Amazon arrivent en 2000 px : on demande une miniature.
const coverUrl = (url, size) => safeHref(url).replace(/\._SL\d+_\./, `._SL${size}_.`);
const clip = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + "…" : s);

const store = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem("pd." + key);
      return value == null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("pd." + key, JSON.stringify(value));
    } catch {}
  },
  del(key) {
    try {
      localStorage.removeItem("pd." + key);
    } catch {}
  },
};

// ---------- Icônes ----------
const PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  notes: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
  star: '<path d="m12 3 2.7 5.6 6.3.9-4.5 4.4 1 6.1L12 17l-5.5 3 1-6.1L3 9.5l6.3-.9z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  auto: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  quote: '<path d="M7 7h4v4c0 3-2 5-4 6M15 7h4v4c0 3-2 5-4 6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${PATHS[name]}</svg>`;

// ---------- Réglages d'affichage ----------
const AREA_STYLE = {
  "vie spirituelle": { color: "#7c5cff", emoji: "🕊️" },
  entrepreneuriat: { color: "#16a34a", emoji: "🌱" },
  "reseaux sociaux": { color: "#e11d48", emoji: "🎙️" },
  sante: { color: "#0891b2", emoji: "🍃" },
};
const FALLBACK_COLORS = ["#f59e0b", "#2563eb", "#db2777", "#0d9488", "#9333ea", "#ea580c"];
const SOURCE_EMOJI = {
  Livre: "📖", "Vidéo YT": "▶️", Conversation: "💬", "Prédication": "🎤", Bible: "📜", Article: "📰",
  "Idée": "💡", "Révélation de Saint-Esprit": "🕊️", Podcast: "🎧", Rapport: "📊",
};
const RW_CATEGORIES = { books: "Livres", articles: "Articles", podcasts: "Podcasts", tweets: "Tweets", supplementals: "Compléments" };
const SORTS = { recent: "Plus récentes", old: "Plus anciennes", edited: "Modifiées récemment", alpha: "A → Z" };
const PAGE = 40;

// ---------- Dates et nombres ----------
const DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const DATE_LONG = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });
function fmtDate(iso, long = false) {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  return isNaN(d) ? "" : (long ? DATE_LONG : DATE).format(d);
}
function ago(iso) {
  const minutes = (Date.now() - new Date(iso)) / 60000;
  if (minutes < 2) return "à l'instant";
  if (minutes < 60) return `il y a ${Math.round(minutes)} min`;
  if (minutes < 60 * 24) return `il y a ${Math.round(minutes / 60)} h`;
  return `il y a ${Math.round(minutes / 1440)} j`;
}
const num = (n) => n.toLocaleString("fr-FR");
const plural = (n, one, many) => `${num(n)} ${n > 1 ? many : one}`;

// ---------- Recherche ----------
// norm() garde la même longueur que le texte d'origine, pour surligner au bon endroit.
const MARKS = /[̀-ͯ]/g;
const charCache = new Map();
function norm(input) {
  const s = String(input || "");
  if (!/[^\x00-\x7f]/.test(s)) return s.toLowerCase();
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c.charCodeAt(0) < 128) {
      out += c.toLowerCase();
      continue;
    }
    let n = charCache.get(c);
    if (n === undefined) {
      n = c.normalize("NFD").replace(MARKS, "").toLowerCase();
      n = n.length === 1 ? n : n.length === 0 ? " " : n[0];
      charCache.set(c, n);
    }
    out += n;
  }
  return out;
}
const STOP = new Set(
  "le la les l de des du d un une et ou a au aux en dans pour par sur que qui quoi est ce ces se sa son ses mon ma mes ton ta tes il elle on ne pas the of and to in is it".split(" ")
);
function tokens(q) {
  const all = norm(q).split(/[^a-z0-9œæ]+/).filter(Boolean);
  const kept = all.filter((t) => !STOP.has(t));
  return kept.length ? kept : all;
}
const wordStart = (s, i) => i === 0 || !/[a-z0-9]/.test(s[i - 1]);

// La plupart des surlignages Readwise sont en anglais : un mot français cherche aussi ses équivalents.
// Clés et valeurs sont des débuts de mots, sans accents.
const SYNONYMS = {
  delivr: ["deliver"], demon: ["demon", "devil"], diable: ["devil"], ennemi: ["enemy"], combat: ["warfare", "battle", "fight"],
  guerre: ["war"], victoir: ["victor"], autorit: ["authorit"], puissanc: ["power"], pouvoir: ["power"],
  priere: ["pray"], prier: ["pray"], jeun: ["fast"], louang: ["praise"], adorat: ["worship"],
  esprit: ["spirit"], saint: ["holy"], onction: ["anoint"], foi: ["faith"], croire: ["believ"], croyanc: ["belief"],
  parole: ["word"], mots: ["word"], langue: ["tongue"], bouche: ["mouth"], pensee: ["thought", "mind"],
  identit: ["identit"], heritag: ["inherit"], croiss: ["growth", "grow"], matur: ["matur"],
  evangel: ["evangel", "gospel"], ame: ["soul"], salut: ["salvation", "saved"], temoign: ["witness", "testimon"],
  argent: ["money"], richess: ["wealth", "riches"], royaum: ["kingdom"], dime: ["tithe"], offrand: ["offering"],
  semenc: ["seed"], recolt: ["harvest"], prosper: ["prosper"], pauvret: ["poverty"], dette: ["debt"],
  entrepr: ["business"], commerc: ["market", "sell"], vente: ["sell", "sale"], contenu: ["content"],
  guerison: ["heal"], guerir: ["heal"], malad: ["sick", "disease"], sante: ["health"], nourritur: ["food"],
  dieu: ["god"], seigneur: ["lord"], pere: ["father"], christ: ["christ"], croix: ["cross"], sang: ["blood"],
  eglise: ["church"], amour: ["love"], paix: ["peace"], joie: ["joy"], peur: ["fear"], crainte: ["fear"],
  pardon: ["forgiv"], peche: ["sin"], malediction: ["curse"], benedict: ["bless"], benir: ["bless"], coeur: ["heart"],
  verite: ["truth"], liberte: ["freedom", "liberty"], ange: ["angel"], ciel: ["heaven"], enfer: ["hell"],
  prophe: ["prophe"], reve: ["dream"], sagess: ["wisdom"], connaiss: ["knowledge"], orgueil: ["pride"],
  humilit: ["humble", "humilit"], obeiss: ["obedien"], repos: ["rest"], patienc: ["patien"],
  agricult: ["agricultur", "farm"], ferme: ["farm"], jardin: ["garden"], plante: ["plant"],
};

function expand(t) {
  const alts = [];
  for (const [key, values] of Object.entries(SYNONYMS)) {
    if (t === key || (key.length >= 4 && t.startsWith(key)) || (t.length >= 4 && key.startsWith(t))) alts.push(...values);
  }
  if (t.length >= 7) alts.push(t.slice(0, 6)); // racine : « spirituelle » trouve aussi « spiritual »
  return [...new Set(alts)].filter((a) => a !== t);
}

function search(docs, q) {
  const terms = tokens(q).map((t) => [t, ...expand(t)]);
  const toks = terms.flat();
  if (!terms.length) return { items: [], toks };
  const termScore = (d, variants) => {
    for (const [i, t] of variants.entries()) {
      let s = 0;
      const ti = d.nTitle.indexOf(t);
      if (ti >= 0) s += 10 + (wordStart(d.nTitle, ti) ? 6 : 0);
      if (d.nMeta.includes(t)) s += 4;
      const bi = d.nBody.indexOf(t);
      if (bi >= 0) s += 3 + (wordStart(d.nBody, bi) ? 2 : 0);
      if (s) return i === 0 ? s : s * 0.7;
    }
    return 0;
  };
  const score = (d, all) => {
    let total = 0;
    let hits = 0;
    for (const variants of terms) {
      const s = termScore(d, variants);
      if (s) {
        hits++;
        total += s;
      } else if (all) return 0;
    }
    return all ? total : (total * hits) / terms.length;
  };
  let scored = docs.map((d) => [d, score(d, true)]).filter((r) => r[1] > 0);
  if (!scored.length && terms.length > 1) scored = docs.map((d) => [d, score(d, false)]).filter((r) => r[1] > 0);
  scored.sort((a, b) => b[1] - a[1]);
  return { items: scored.map((r) => r[0]), toks };
}

function mark(text, toks) {
  if (!toks.length) return esc(text);
  const n = norm(text);
  const ranges = [];
  for (const t of toks) {
    for (let i = n.indexOf(t); i >= 0; i = n.indexOf(t, i + t.length)) ranges.push([i, i + t.length]);
  }
  if (!ranges.length) return esc(text);
  ranges.sort((a, b) => a[0] - b[0]);
  let out = "";
  let last = 0;
  for (const [a, b] of ranges) {
    if (a < last) continue;
    out += esc(text.slice(last, a)) + "<mark>" + esc(text.slice(a, b)) + "</mark>";
    last = b;
  }
  return out + esc(text.slice(last));
}

function snippet(text, toks, len = 170) {
  const flat = text.replace(/\s/g, " ");
  const n = norm(flat);
  let pos = -1;
  for (const t of toks) {
    const i = n.indexOf(t);
    if (i >= 0 && (pos < 0 || i < pos)) pos = i;
  }
  let start = pos < 0 ? 0 : Math.max(0, pos - 50);
  if (start > 0) {
    const space = flat.indexOf(" ", start);
    if (space > 0 && space < pos) start = space + 1;
  }
  const end = Math.min(flat.length, start + len);
  return (start > 0 ? "…" : "") + mark(flat.slice(start, end), toks) + (end < flat.length ? "…" : "");
}

// ---------- État ----------
const S = {
  data: null,
  areas: [],
  topics: [],
  notes: [],
  books: [],
  highlights: [],
  projects: [],
  area: new Map(),
  topic: new Map(),
  note: new Map(),
  book: new Map(),
  hl: new Map(),
  notesByTopic: new Map(),
  topicsByArea: new Map(),
  hlByBook: new Map(),
  inbox: [],
  noteDocs: [],
  hlDocs: [],
  selection: store.get("selection", []),
  list: [],
  filters: {},
  readerOpen: false,
  pushedReader: false,
  lastKey: null,
  view: null,
};

function index(data) {
  S.data = data;
  const archived = (status) => /inactive|archive/i.test(status || "");
  S.areas = data.areas.filter((a) => !archived(a.status));
  S.areas.forEach((a, i) => {
    const style = AREA_STYLE[norm(a.name)] || {};
    a.color = style.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length];
    a.emoji = a.emoji || style.emoji || a.name.slice(0, 1);
  });
  S.area = new Map(S.areas.map((a) => [a.id, a]));

  S.topics = data.topics;
  S.topic = new Map(S.topics.map((t) => [t.id, t]));
  S.notes = data.notes;
  S.note = new Map(S.notes.map((n) => [n.id, n]));

  S.notesByTopic = new Map(S.topics.map((t) => [t.id, []]));
  S.inbox = [];
  for (const n of S.notes) {
    n.topics = n.topicIds.map((id) => S.topic.get(id)).filter(Boolean);
    n.topics.forEach((t) => S.notesByTopic.get(t.id).push(n));
    if (!n.topics.length) S.inbox.push(n);
  }

  S.topicsByArea = new Map(S.areas.map((a) => [a.id, []]));
  for (const t of S.topics) {
    t.areas = t.areaIds.map((id) => S.area.get(id)).filter(Boolean);
    t.color = t.areas[0]?.color || "#8a8a8a";
    t.count = S.notesByTopic.get(t.id).length;
    t.areas.forEach((a) => S.topicsByArea.get(a.id).push(t));
  }
  for (const a of S.areas) {
    const topics = S.topicsByArea.get(a.id).sort((x, y) => y.count - x.count || x.name.localeCompare(y.name, "fr"));
    a.notes = [...new Set(topics.flatMap((t) => S.notesByTopic.get(t.id)))];
  }
  S.areas.sort((x, y) => y.notes.length - x.notes.length);
  S.topics.sort((x, y) => y.count - x.count || x.name.localeCompare(y.name, "fr"));
  S.projects = data.projects || [];

  S.books = data.readwise?.books || [];
  S.highlights = data.readwise?.highlights || [];
  S.book = new Map(S.books.map((b) => [b.id, b]));
  S.hl = new Map(S.highlights.map((h) => [h.id, h]));
  S.hlByBook = new Map(S.books.map((b) => [b.id, []]));
  for (const h of S.highlights) S.hlByBook.get(h.bookId)?.push(h);
  for (const b of S.books) {
    b.count = S.hlByBook.get(b.id).length;
    b.last = S.hlByBook.get(b.id).reduce((m, h) => (h.date > m ? h.date : m), "");
  }

  S.noteDocs = S.notes.map((n) => ({
    kind: "note",
    item: n,
    nTitle: norm(n.title),
    nMeta: norm([...n.topics.map((t) => t.name), n.sourceType, n.sourceText, n.category].join(" ")),
    nBody: norm(n.essentials.map((e) => e.t).join(" ") + " " + n.text),
  }));
  S.hlDocs = S.highlights.map((h) => {
    const b = S.book.get(h.bookId) || {};
    return {
      kind: "hl",
      item: h,
      nTitle: norm(`${b.title || ""} ${b.author || ""}`),
      nMeta: norm(h.tags.join(" ")),
      nBody: norm(h.note ? `${h.text} ${h.note}` : h.text),
    };
  });
  S.selection = S.selection.filter((s) => (s.k === "note" ? S.note.has(s.id) : S.hl.has(s.id)));
}

const noteColor = (n) => n.topics[0]?.color || "var(--accent)";

// ---------- Fragments HTML ----------
function topicTags(n, max = 2) {
  return n.topics
    .slice(0, max)
    .map((t) => `<a class="topic-tag" style="--a:${t.color}" href="#/topic/${t.id}">${esc(t.name)}</a>`)
    .join("");
}
function sourceBadge(n) {
  return n.sourceType ? `<span class="badge">${SOURCE_EMOJI[n.sourceType] || "•"} ${esc(n.sourceType)}</span>` : "";
}
function excerptOf(n, len) {
  return n.text ? clip(n.text.replace(/\s+/g, " ").trim(), len) : "";
}
const isSelected = (k, id) => S.selection.some((s) => s.k === k && s.id === id);
function selectButton(k, id, compact) {
  const on = isSelected(k, id);
  const title = on ? "Retirer de ma sélection" : "Ajouter à ma sélection";
  if (compact) {
    return `<button class="icon-btn pin ${on ? "is-on" : ""}" data-action="select" data-kind="${k}" data-id="${id}" title="${title}" aria-label="${title}">${icon(on ? "check" : "plus")}</button>`;
  }
  return `<button class="btn btn-sm ${on ? "is-on" : ""}" data-action="select" data-kind="${k}" data-id="${id}" title="${title}">${icon(on ? "check" : "plus")}<span>${on ? "Sélectionnée" : "Sélection"}</span></button>`;
}

function noteCard(n) {
  // L'essentiel (gras, surligné) remplace l'extrait seulement s'il dit vraiment quelque chose.
  const essentials = n.essentials.slice(0, 2);
  const excerpt = excerptOf(n, 240);
  const body = essentials.reduce((len, e) => len + e.t.length, 0) >= 60
    ? essentials.map((e) => `<p class="ess ${e.h ? "is-hl" : ""}"><span>${esc(clip(e.t, 150))}</span></p>`).join("")
    : `<p class="excerpt">${excerpt ? esc(excerpt) : "<em>Note vide</em>"}</p>`;
  return `<article class="card clickable note-card" data-note="${n.id}" tabindex="0" style="--a:${noteColor(n)}">
    ${selectButton("note", n.id, true)}
    <h3>${esc(n.title)}</h3>
    ${body}
    <footer>${topicTags(n)}${sourceBadge(n)}<span class="badge">${fmtDate(n.created)}</span></footer>
  </article>`;
}

function noteRow(n) {
  return `<div class="list-row" data-note="${n.id}" tabindex="0" style="--a:${noteColor(n)}">
    <div class="t">${esc(n.title)}</div>
    <div class="s">${esc(excerptOf(n, 160)) || "<em>Note vide</em>"}</div>
    <div class="r">${topicTags(n, 1)}${sourceBadge(n)}<span class="badge">${fmtDate(n.created)}</span></div>
  </div>`;
}

function hlCard(h, toks = [], showBook = true) {
  const b = S.book.get(h.bookId) || {};
  const url = safeHref(h.url);
  return `<article class="card hl-card" id="hl-${h.id}">
    <blockquote class="${h.text.length > 600 ? "long" : ""}" ${h.text.length > 600 ? 'title="Toucher pour tout lire"' : ""}>${mark(h.text, toks)}</blockquote>
    ${h.note ? `<p class="hl-note">✍️ ${mark(h.note, toks)}</p>` : ""}
    <footer>
      ${showBook ? `<a class="grow" href="#/readwise/${b.id}">${esc(b.title)}${b.author ? " · " + esc(b.author) : ""}</a>` : `<span class="grow"></span>`}
      ${h.date ? `<span>${fmtDate(h.date)}</span>` : ""}
      ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener" title="Ouvrir dans Readwise" aria-label="Ouvrir dans Readwise">${icon("external")}</a>` : ""}
      ${selectButton("hl", h.id, false)}
    </footer>
  </article>`;
}

function areaIcon(a) {
  return `<span class="area-ico" style="--a:${a.color}">${esc(a.emoji)}</span>`;
}

function emptyState(title, text) {
  return `<div class="empty"><b>${esc(title)}</b>${esc(text)}</div>`;
}

// ---------- Barre latérale ----------
function renderSidebar() {
  const current = "#/" + parseHash().parts.join("/");
  const item = (href, label, ico, count) =>
    `<a class="nav-item ${current === href ? "is-active" : ""}" href="${href}">${ico}<span class="grow">${esc(label)}</span>${
      count != null ? `<span class="count">${num(count)}</span>` : ""
    }</a>`;
  const favourites = S.notes.filter((n) => n.favourite).length;
  const theme = store.get("theme", "auto");
  const themeLabel = { auto: "automatique", light: "clair", dark: "sombre" }[theme];
  const repo = S.data.repo;
  const syncLink = repo ? ` · <a href="https://github.com/${esc(repo)}/actions/workflows/sync.yml" target="_blank" rel="noopener">Mettre à jour</a>` : "";

  $("#sidebar").innerHTML = `
    <a class="brand" href="#/"><img src="icon.svg" alt="" width="28" height="28">Second cerveau</a>
    <button class="search-trigger" data-action="search">${icon("search")}<span>Rechercher</span><kbd>Ctrl K</kbd></button>
    <nav class="nav-group">
      ${item("#/", "Accueil", icon("home"))}
      ${item("#/notes", "Toutes les notes", icon("notes"), S.notes.length)}
      ${favourites ? item("#/favoris", "Favoris", icon("star"), favourites) : ""}
      ${S.inbox.length ? item("#/inbox", "À classer", icon("inbox"), S.inbox.length) : ""}
      ${S.highlights.length ? item("#/readwise", "Readwise", icon("book"), S.highlights.length) : ""}
      ${item("#/selection", "Ma sélection", icon("layers"), S.selection.length || null)}
    </nav>
    <div class="nav-label">Areas</div>
    <nav class="nav-group">
      ${S.areas
        .map(
          (a) =>
            item(`#/area/${a.id}`, a.name, areaIcon(a), a.notes.length) +
            S.topicsByArea
              .get(a.id)
              .map(
                (t) =>
                  `<a class="nav-item sub ${current === "#/topic/" + t.id ? "is-active" : ""}" style="--a:${a.color}" href="#/topic/${t.id}"><span class="grow">${esc(t.name)}</span><span class="count">${t.count}</span></a>`
              )
              .join("")
        )
        .join("")}
    </nav>
    <div class="sidebar-foot">
      <div class="sync-info" title="${esc(fmtDate(S.data.generatedAt, true))}">Synchro ${ago(S.data.generatedAt)}${syncLink}</div>
      <button class="icon-btn" data-action="theme" title="Thème : ${themeLabel}" aria-label="Thème : ${themeLabel}">${icon(theme === "auto" ? "auto" : theme === "light" ? "sun" : "moon")}</button>
      <button class="icon-btn" data-action="lock" title="Verrouiller cet appareil" aria-label="Verrouiller cet appareil">${icon("lock")}</button>
    </div>`;
}

// ---------- Navigation ----------
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  return {
    parts: path.split("/").filter(Boolean).map((p) => decodeURIComponent(p)),
    params: new URLSearchParams(query),
  };
}
function buildHash(parts, params) {
  const qs = params.toString();
  return "#/" + parts.map(encodeURIComponent).join("/") + (qs ? "?" + qs : "");
}
const routeKey = (parts, params) => parts.join("/") + "|" + (params.get("q") || "");

function onRoute() {
  const { parts, params } = parseHash();
  const key = routeKey(parts, params);
  if (key !== S.lastKey) {
    S.lastKey = key;
    renderView(parts, params);
  }
  const noteId = params.get("n");
  if (noteId && S.note.has(noteId)) renderReader(noteId);
  else {
    S.pushedReader = false;
    hideReader();
  }
  const hlId = params.get("h");
  if (hlId) flashHighlight(hlId);
}

function renderView(parts, params) {
  const [view, id] = parts;
  S.page = PAGE;
  S.view = view || "home";
  const views = {
    home: viewHome,
    notes: () => viewNoteList("notes", "Toutes les notes", "Tout ce que tu as capturé, au même endroit.", S.notes),
    favoris: () => viewNoteList("favoris", "Favoris", "Les notes marquées comme favorites dans Notion.", S.notes.filter((n) => n.favourite)),
    inbox: () => viewNoteList("inbox", "À classer", "Ces notes n'ont pas encore de Topic actif.", S.inbox),
    area: () => viewArea(id),
    topic: () => viewTopic(id),
    readwise: () => (id ? viewBook(id, params) : viewReadwise(params)),
    selection: viewSelection,
  };
  const el = $("#view");
  el.innerHTML = (views[S.view] || viewHome)();
  mountView();
  el.classList.remove("enter");
  void el.offsetWidth;
  el.classList.add("enter");
  window.scrollTo(0, 0);
  $("#app").classList.remove("menu-open");
  renderSidebar();
  document.title = S.view === "home" ? "Second cerveau" : `${el.querySelector("h1")?.textContent.trim()} · Second cerveau`;
}

// Parties de vue qui se remplissent après coup (listes filtrables, résultats).
let mountView = () => {};

// ---------- Vues ----------
function viewHome() {
  const hour = new Date().getHours();
  const hello = hour < 5 ? "Bonne nuit" : hour < 18 ? "Bonjour" : "Bonsoir";
  const recent = [...S.notes].sort((a, b) => (b.edited || "").localeCompare(a.edited || "")).slice(0, 6);
  mountView = () => {};
  return `
    <section class="hero">
      <h1>${hello} Malo</h1>
      <p>Sur quel sujet tu travailles aujourd'hui ?</p>
      <button class="hero-search" data-action="search">${icon("search")}<span>Chercher dans tes notes et tes lectures…</span><kbd>Ctrl K</kbd></button>
      <div class="quick">
        ${S.topics
          .filter((t) => t.count)
          .map((t) => `<a class="chip" href="#/topic/${t.id}"><span class="dot" style="--a:${t.color}"></span>${esc(t.name)} <span class="count">${t.count}</span></a>`)
          .join("")}
      </div>
      <div class="stats">
        <span><b>${num(S.notes.length)}</b> notes</span>
        <span><b>${num(S.topics.length)}</b> topics</span>
        ${S.highlights.length ? `<span><b>${num(S.highlights.length)}</b> surlignages Readwise</span>` : ""}
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2 class="section-title">Tes domaines</h2></div>
      <div class="grid grid-areas">${S.areas.map(areaCard).join("")}</div>
    </section>

    <section class="section">
      <div class="section-head"><h2 class="section-title">Modifiées récemment</h2><a href="#/notes">Toutes les notes →</a></div>
      <div class="grid">${recent.map(noteCard).join("")}</div>
    </section>

    ${
      S.highlights.length
        ? `<section class="section">
            <div class="card resurface" id="resurface">${resurfaceInner()}</div>
          </section>`
        : ""
    }`;
}

function areaCard(a) {
  const topics = S.topicsByArea.get(a.id);
  const max = Math.max(1, ...topics.map((t) => t.count));
  const projects = S.projects.filter((p) => p.areaIds.includes(a.id) && p.status !== "Done").length;
  return `<article class="card area-card" style="--a:${a.color}">
    <a class="area-card-head" href="#/area/${a.id}">
      ${areaIcon(a)}
      <div><h3>${esc(a.name)}</h3><div class="meta">${plural(a.notes.length, "note", "notes")} · ${plural(topics.length, "topic", "topics")}${
        projects ? ` · ${plural(projects, "projet en cours", "projets en cours")}` : ""
      }</div></div>
    </a>
    <div class="topic-list">
      ${
        topics
          .map(
            (t) =>
              `<a class="topic-row" href="#/topic/${t.id}" style="--a:${a.color}"><span class="grow">${esc(t.name)}</span><span class="bar"><i style="width:${Math.round((t.count / max) * 100)}%"></i></span><span class="count">${t.count}</span></a>`
          )
          .join("") || `<span class="meta">Aucun topic pour l'instant.</span>`
      }
    </div>
  </article>`;
}

function resurfaceInner() {
  const h = S.highlights[Math.floor(Math.random() * S.highlights.length)];
  const b = S.book.get(h.bookId) || {};
  return `<div class="label"><span>À redécouvrir</span><button class="btn btn-sm" data-action="shuffle">${icon("shuffle")}Un autre</button></div>
    <div class="hl-card" style="padding:0">
      <blockquote>${esc(h.text)}</blockquote>
      ${h.note ? `<p class="hl-note">✍️ ${esc(h.note)}</p>` : ""}
      <footer>
        <a class="grow" href="#/readwise/${b.id}?h=${h.id}">${esc(b.title)}${b.author ? " · " + esc(b.author) : ""}</a>
        ${selectButton("hl", h.id, false)}
      </footer>
    </div>`;
}

function notesBlock(key, notes) {
  const f = (S.filters[key] ||= { q: "", type: "", sort: "recent" });
  const types = new Map();
  notes.forEach((n) => n.sourceType && types.set(n.sourceType, (types.get(n.sourceType) || 0) + 1));
  const layout = store.get("layout", "grid");
  mountView = () => fillNotes(key, notes);
  return `
    <div class="toolbar">
      <div class="input-wrap">${icon("search")}<input class="input" data-filter="${key}" type="search" placeholder="Filtrer ces notes…" value="${esc(f.q)}"></div>
      ${
        types.size > 1
          ? `<div class="chips">${[...types.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([t, c]) => `<button class="chip ${f.type === t ? "is-on" : ""}" data-action="type" data-key="${key}" data-type="${esc(t)}">${SOURCE_EMOJI[t] || ""} ${esc(t)} <span class="count">${c}</span></button>`)
              .join("")}</div>`
          : ""
      }
      <span class="spacer"></span>
      <select class="select" data-sort="${key}" aria-label="Trier">${Object.entries(SORTS)
        .map(([v, l]) => `<option value="${v}" ${f.sort === v ? "selected" : ""}>${l}</option>`)
        .join("")}</select>
      <div class="seg" role="group" aria-label="Affichage">
        <button class="${layout === "grid" ? "is-on" : ""}" data-action="layout" data-layout="grid" title="Cartes" aria-label="Cartes">${icon("grid")}</button>
        <button class="${layout === "list" ? "is-on" : ""}" data-action="layout" data-layout="list" title="Liste" aria-label="Liste">${icon("list")}</button>
      </div>
    </div>
    <div id="notes-list"></div>`;
}

function fillNotes(key, notes) {
  const f = S.filters[key];
  let items = notes.filter((n) => !f.type || n.sourceType === f.type);
  if (f.q.trim()) {
    const ids = new Set(items.map((n) => n.id));
    items = search(S.noteDocs.filter((d) => ids.has(d.item.id)), f.q).items.map((d) => d.item);
  } else {
    const by = {
      recent: (a, b) => (b.created || "").localeCompare(a.created || ""),
      old: (a, b) => (a.created || "").localeCompare(b.created || ""),
      edited: (a, b) => (b.edited || "").localeCompare(a.edited || ""),
      alpha: (a, b) => a.title.localeCompare(b.title, "fr"),
    };
    items = [...items].sort(by[f.sort]);
  }
  S.list = items.map((n) => n.id);
  const layout = store.get("layout", "grid");
  const el = $("#notes-list");
  if (!el) return;
  el.innerHTML = !items.length
    ? emptyState("Aucune note", f.q || f.type ? "Essaie un autre filtre." : "Rien ici pour l'instant.")
    : layout === "list"
      ? `<div class="list">${items.map(noteRow).join("")}</div>`
      : `<div class="grid">${items.map(noteCard).join("")}</div>`;
}

function viewNoteList(key, title, sub, notes) {
  const html = `
    <header class="page-head">
      <h1 class="page-title">${esc(title)}</h1>
      <p class="page-sub">${esc(sub)} ${plural(notes.length, "note", "notes")}.</p>
    </header>
    ${notesBlock(key, notes)}`;
  return html;
}

function viewArea(id) {
  const a = S.area.get(id);
  if (!a) return notFound();
  const topics = S.topicsByArea.get(id);
  const projects = S.projects.filter((p) => p.areaIds.includes(id) && p.status !== "Done");
  const block = notesBlock("area:" + id, a.notes);
  return `
    <header class="page-head" style="--a:${a.color}">
      <div class="crumbs"><a href="#/">Accueil</a> › Area</div>
      <h1 class="page-title">${areaIcon(a)}${esc(a.name)}</h1>
      <p class="page-sub">${plural(a.notes.length, "note", "notes")} dans ${plural(topics.length, "topic", "topics")}.</p>
      <div class="page-actions">
        <a class="btn" href="${esc(safeHref(a.url))}" target="_blank" rel="noopener">${icon("external")}Ouvrir dans Notion</a>
      </div>
    </header>

    <section class="section" style="margin-top:0">
      <div class="section-head"><h2 class="section-title">Topics</h2></div>
      <div class="grid">
        ${
          topics
            .map((t) => {
              const latest = [...S.notesByTopic.get(t.id)].sort((x, y) => (y.created || "").localeCompare(x.created || ""))[0];
              return `<a class="card clickable topic-card" href="#/topic/${t.id}" style="--a:${t.color}">
                <h3>${esc(t.name)}</h3>
                <span class="meta">${plural(t.count, "note", "notes")}</span>
                ${latest ? `<span class="latest">Dernière : ${esc(latest.title)}</span>` : `<span class="latest">Pas encore de note</span>`}
              </a>`;
            })
            .join("") || emptyState("Aucun topic", "Crée un Topic dans Notion et relie-le à cette Area.")
        }
      </div>
    </section>

    ${
      projects.length
        ? `<section class="section">
            <div class="section-head"><h2 class="section-title">Projets en cours</h2></div>
            <div class="list">${projects
              .map(
                (p) => `<a class="list-row" href="${esc(safeHref(p.url))}" target="_blank" rel="noopener">
                  <div class="t">${esc(p.name)}</div>
                  <div class="s">${esc(p.status)}${p.due ? " · échéance " + fmtDate(p.due) : ""}</div>
                  <div class="r">${icon("external")}</div>
                </a>`
              )
              .join("")}</div>
          </section>`
        : ""
    }

    <section class="section">
      <div class="section-head"><h2 class="section-title">Toutes les notes de l'Area</h2></div>
      ${block}
    </section>`;
}

function viewTopic(id) {
  const t = S.topic.get(id);
  if (!t) return notFound();
  const notes = S.notesByTopic.get(id);
  const block = notesBlock("topic:" + id, notes);
  return `
    <header class="page-head" style="--a:${t.color}">
      <div class="crumbs"><a href="#/">Accueil</a> › ${
        t.areas.map((a) => `<a href="#/area/${a.id}">${esc(a.name)}</a>`).join(" · ") || "Sans Area"
      }</div>
      <h1 class="page-title"><span class="dot dot-lg" style="--a:${t.color}"></span>${esc(t.name)}</h1>
      <p class="page-sub">${plural(notes.length, "note", "notes")}.</p>
      <div class="page-actions">
        ${notes.length ? `<button class="btn" data-action="select-all">${icon("layers")}Tout mettre dans ma sélection</button>` : ""}
        ${S.highlights.length ? `<a class="btn" href="#/readwise?q=${encodeURIComponent(t.name)}">${icon("book")}Chercher dans Readwise</a>` : ""}
        <a class="btn" href="${esc(safeHref(t.url))}" target="_blank" rel="noopener">${icon("external")}Ouvrir dans Notion</a>
      </div>
    </header>
    ${notes.length ? block : emptyState("Pas encore de note", "Capture une idée avec Ctrl+Maj+Espace, elle arrivera ici.")}`;
}

function viewReadwise(params) {
  const q = params.get("q") || "";
  const f = (S.filters.readwise ||= { cat: "", sort: "count" });
  const cats = new Map();
  S.books.forEach((b) => cats.set(b.category, (cats.get(b.category) || 0) + 1));
  mountView = () => fillReadwise();
  return `
    <header class="page-head">
      <h1 class="page-title">Readwise</h1>
      <p class="page-sub">${plural(S.highlights.length, "surlignage", "surlignages")} dans ${plural(S.books.length, "source", "sources")}. Pas encore triés dans ton PARA.</p>
    </header>
    <div class="toolbar">
      <div class="input-wrap" style="max-width:480px">${icon("search")}<input class="input" id="rw-q" type="search" placeholder="Chercher un passage…" value="${esc(q)}"></div>
      <span class="spacer"></span>
      <div class="chips" id="rw-cats">
        <button class="chip ${!f.cat ? "is-on" : ""}" data-action="rw-cat" data-cat="">Toutes</button>
        ${[...cats.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([c, n]) => `<button class="chip ${f.cat === c ? "is-on" : ""}" data-action="rw-cat" data-cat="${esc(c)}">${esc(RW_CATEGORIES[c] || c)} <span class="count">${n}</span></button>`)
          .join("")}
      </div>
      <select class="select" id="rw-sort" aria-label="Trier">
        <option value="count" ${f.sort === "count" ? "selected" : ""}>Plus de passages</option>
        <option value="recent" ${f.sort === "recent" ? "selected" : ""}>Lus récemment</option>
        <option value="alpha" ${f.sort === "alpha" ? "selected" : ""}>A → Z</option>
      </select>
    </div>
    <div id="rw-results"></div>`;
}

function fillReadwise() {
  const q = ($("#rw-q")?.value || "").trim();
  const f = S.filters.readwise;
  const el = $("#rw-results");
  if (!el) return;
  $("#rw-cats").hidden = !!q;
  $("#rw-sort").hidden = !!q;
  if (q) {
    const { items, toks } = search(S.hlDocs, q);
    const shown = items.slice(0, S.page);
    el.innerHTML = items.length
      ? `<p class="page-sub" style="margin:0 0 14px">${plural(items.length, "passage trouvé", "passages trouvés")}</p>
         <div class="hl-stack">${shown.map((d) => hlCard(d.item, toks)).join("")}</div>
         ${items.length > shown.length ? `<div style="text-align:center;margin-top:18px"><button class="btn" data-action="more">Afficher plus</button></div>` : ""}`
      : emptyState("Aucun passage", "Essaie un autre mot, ou une racine plus courte (ex. « délivr »).");
    return;
  }
  const by = {
    count: (a, b) => b.count - a.count,
    recent: (a, b) => b.last.localeCompare(a.last),
    alpha: (a, b) => a.title.localeCompare(b.title, "fr"),
  };
  const books = S.books.filter((b) => !f.cat || b.category === f.cat).sort(by[f.sort]);
  el.innerHTML = `<div class="grid">${books
    .map(
      (b) => `<a class="card clickable book-card" href="#/readwise/${b.id}">
        ${coverUrl(b.cover) ? `<img class="cover" src="${esc(coverUrl(b.cover, 160))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="cover"></span>`}
        <div><h3>${esc(b.title)}</h3><p>${esc(b.author)}</p><p>${plural(b.count, "passage", "passages")}</p></div>
      </a>`
    )
    .join("")}</div>`;
}

function viewBook(id, params) {
  const b = S.book.get(id);
  if (!b) return notFound();
  const hlId = params.get("h");
  const all = S.hlByBook.get(id);
  if (hlId) {
    const pos = all.findIndex((h) => h.id === hlId);
    if (pos >= S.page) S.page = pos + 1;
  }
  mountView = () => fillBook(id);
  return `
    <header class="page-head">
      <div class="crumbs"><a href="#/readwise">Readwise</a> › ${esc(RW_CATEGORIES[b.category] || b.category)}</div>
      <div class="book-head">
        ${coverUrl(b.cover) ? `<img class="cover" src="${esc(coverUrl(b.cover, 300))}" alt="" referrerpolicy="no-referrer">` : ""}
        <div>
          <h1 class="page-title">${esc(b.title)}</h1>
          <p class="page-sub">${b.author ? esc(b.author) + " · " : ""}${plural(b.count, "passage", "passages")}</p>
          <div class="page-actions">
            ${safeHref(b.url) ? `<a class="btn" href="${esc(b.url)}" target="_blank" rel="noopener">${icon("external")}Readwise</a>` : ""}
            ${safeHref(b.sourceUrl) ? `<a class="btn" href="${esc(b.sourceUrl)}" target="_blank" rel="noopener">${icon("external")}Source</a>` : ""}
          </div>
        </div>
      </div>
    </header>
    <div class="toolbar"><div class="input-wrap">${icon("search")}<input class="input" id="book-q" type="search" placeholder="Filtrer les passages de ce livre…"></div></div>
    <div id="book-results"></div>`;
}

function fillBook(id) {
  const q = ($("#book-q")?.value || "").trim();
  const all = S.hlByBook.get(id);
  let items = all;
  let toks = [];
  if (q) {
    const found = search(S.hlDocs.filter((d) => d.item.bookId === id), q);
    items = found.items.map((d) => d.item);
    toks = found.toks;
  }
  const shown = items.slice(0, S.page);
  $("#book-results").innerHTML = items.length
    ? `<div class="hl-stack">${shown.map((h) => hlCard(h, toks, false)).join("")}</div>
       ${items.length > shown.length ? `<div style="text-align:center;margin-top:18px"><button class="btn" data-action="more">Afficher plus (${items.length - shown.length})</button></div>` : ""}`
    : emptyState("Aucun passage", "Essaie un autre mot.");
}

function viewSelection() {
  mountView = () => {};
  const items = S.selection;
  const rows = items
    .map((s, i) => {
      const controls = `<div class="sel-controls">
          <button class="icon-btn" data-action="sel-move" data-index="${i}" data-dir="-1" title="Monter" aria-label="Monter" ${i === 0 ? "disabled" : ""}>${icon("up")}</button>
          <button class="icon-btn" data-action="sel-move" data-index="${i}" data-dir="1" title="Descendre" aria-label="Descendre" ${i === items.length - 1 ? "disabled" : ""}>${icon("down")}</button>
          <button class="icon-btn" data-action="sel-remove" data-index="${i}" title="Retirer" aria-label="Retirer">${icon("x")}</button>
        </div>`;
      if (s.k === "note") {
        const n = S.note.get(s.id);
        return `<div class="sel-item card">
          <div class="sel-main clickable" data-note="${n.id}" style="--a:${noteColor(n)}">
            <div class="sel-kind">${icon("notes")} Note</div>
            <h3>${esc(n.title)}</h3>
            <p class="excerpt">${esc(excerptOf(n, 220))}</p>
            <div class="sel-meta">${topicTags(n)}${sourceBadge(n)}</div>
          </div>${controls}</div>`;
      }
      const h = S.hl.get(s.id);
      const b = S.book.get(h.bookId) || {};
      return `<div class="sel-item card">
        <div class="sel-main">
          <div class="sel-kind">${icon("quote")} Passage · <a href="#/readwise/${b.id}?h=${h.id}">${esc(b.title)}</a></div>
          <blockquote class="${h.text.length > 600 ? "long" : ""}">${esc(h.text)}</blockquote>
          ${h.note ? `<p class="hl-note">✍️ ${esc(h.note)}</p>` : ""}
        </div>${controls}</div>`;
    })
    .join("");
  S.list = items.filter((s) => s.k === "note").map((s) => s.id);
  return `
    <header class="page-head">
      <h1 class="page-title">Ma sélection</h1>
      <p class="page-sub">Rassemble ici les notes et passages utiles pour un projet, puis copie-les d'un coup pour écrire, préparer une prédication ou un épisode.</p>
      ${
        items.length
          ? `<div class="page-actions">
              <button class="btn btn-primary" data-action="sel-copy">${icon("copy")}Copier en Markdown</button>
              <button class="btn" data-action="sel-clear">${icon("trash")}Vider</button>
            </div>`
          : ""
      }
    </header>
    ${items.length ? `<div class="hl-stack">${rows}</div>` : emptyState("Ta sélection est vide", "Ajoute des notes avec le bouton + sur chaque carte, ou des passages Readwise avec « Sélection ».")}`;
}

function notFound() {
  mountView = () => {};
  return `<header class="page-head"><h1 class="page-title">Introuvable</h1><p class="page-sub">Cette page n'existe plus (archivée ou renommée dans Notion). <a class="link" href="#/">Retour à l'accueil</a></p></header>`;
}

// ---------- Lecteur de note ----------
function openNote(id) {
  const { parts, params } = parseHash();
  params.set("n", id);
  params.delete("h");
  const hash = buildHash(parts, params);
  if (S.readerOpen) {
    history.replaceState(null, "", hash);
    onRoute();
  } else {
    S.pushedReader = true;
    location.hash = hash;
  }
}

function closeReader() {
  if (S.pushedReader) {
    S.pushedReader = false;
    history.back();
    return;
  }
  const { parts, params } = parseHash();
  params.delete("n");
  history.replaceState(null, "", buildHash(parts, params));
  onRoute();
}

function stepReader(dir) {
  const { params } = parseHash();
  const pos = S.list.indexOf(params.get("n"));
  if (pos < 0) return;
  const next = S.list[pos + dir];
  if (next) openNote(next);
}

function renderReader(id) {
  const n = S.note.get(id);
  const pos = S.list.indexOf(id);
  const siblings = [...new Set(n.topics.flatMap((t) => S.notesByTopic.get(t.id)))]
    .filter((x) => x.id !== id)
    .sort((a, b) => (b.created || "").localeCompare(a.created || ""))
    .slice(0, 6);
  const reader = $("#reader");
  reader.style.setProperty("--a", noteColor(n));
  reader.innerHTML = `
    <div class="reader-bar">
      <button class="icon-btn" data-action="close-reader" title="Fermer (Échap)" aria-label="Fermer">${icon("x")}</button>
      <span class="grow"></span>
      ${
        pos >= 0 && S.list.length > 1
          ? `<span class="pos">${pos + 1} / ${S.list.length}</span>
             <button class="icon-btn" data-action="prev" title="Note précédente (←)" aria-label="Note précédente" ${pos === 0 ? "disabled" : ""}>${icon("up")}</button>
             <button class="icon-btn" data-action="next" title="Note suivante (→)" aria-label="Note suivante" ${pos === S.list.length - 1 ? "disabled" : ""}>${icon("down")}</button>`
          : ""
      }
      ${selectButton("note", id, false)}
      <a class="btn btn-sm" href="${esc(safeHref(n.url))}" target="_blank" rel="noopener">${icon("external")}<span>Notion</span></a>
    </div>
    <div class="reader-scroll">
      <article class="doc">
        <div class="tags">${topicTags(n, 9)}</div>
        <h1>${esc(n.title)}</h1>
        <div class="meta">${sourceBadge(n)}${n.created ? `<span class="badge">${fmtDate(n.created, true)}</span>` : ""}${n.category ? `<span class="badge">${esc(n.category)}</span>` : ""}</div>
        ${n.source ? `<div class="source">${n.source}</div>` : ""}
        ${
          n.essentials.length
            ? `<section class="essentials"><h2>L'essentiel</h2><ul>${n.essentials.map((e) => `<li class="${e.h ? "is-hl" : ""}"><span>${esc(e.t)}</span></li>`).join("")}</ul></section>`
            : ""
        }
        <div class="prose">${n.html || '<p class="muted">Cette note est vide.</p>'}</div>
        ${
          siblings.length
            ? `<section class="related"><h2>Dans le même topic</h2>${siblings
                .map((x) => `<button class="rel" data-note="${x.id}">${esc(x.title)}<span>${fmtDate(x.created)}</span></button>`)
                .join("")}</section>`
            : ""
        }
      </article>
    </div>`;
  $("#app").classList.add("reading");
  reader.setAttribute("aria-hidden", "false");
  reader.querySelector(".reader-scroll").scrollTop = 0;
  S.readerOpen = true;
  const recent = store.get("recent", []).filter((x) => x !== id);
  store.set("recent", [id, ...recent].slice(0, 8));
  if (!reader.contains(document.activeElement)) reader.querySelector(".reader-bar .icon-btn").focus({ preventScroll: true });
}

function hideReader() {
  if (!S.readerOpen) return;
  S.readerOpen = false;
  $("#app").classList.remove("reading");
  $("#reader").setAttribute("aria-hidden", "true");
}

function flashHighlight(id) {
  requestAnimationFrame(() => {
    const el = document.getElementById("hl-" + id);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  });
}

// ---------- Recherche globale (palette) ----------
const P = { items: [], active: 0 };

function openPalette(q = "") {
  $("#palette").hidden = false;
  const input = $("#palette-q");
  input.value = q;
  renderPalette();
  input.focus();
  input.select();
}
function closePalette() {
  $("#palette").hidden = true;
}

function renderPalette() {
  const q = $("#palette-q").value.trim();
  const groups = [];
  P.items = [];
  const add = (html, run) => {
    P.items.push(run);
    return html.replace("<div class=\"result", `<div data-i="${P.items.length - 1}" class="result`);
  };
  const noteResult = (n, toks, list) =>
    add(
      `<div class="result"><span class="ico">${SOURCE_EMOJI[n.sourceType] || icon("notes")}</span><div class="body">
        <div class="t">${mark(n.title, toks)}</div>
        ${toks.length ? `<div class="s">${snippet(n.text, toks)}</div>` : ""}
        <div class="m">${esc(n.topics.map((t) => t.name).join(" · ") || "À classer")}${n.created ? " · " + fmtDate(n.created) : ""}</div>
      </div></div>`,
      () => {
        S.list = list;
        openNote(n.id);
      }
    );
  const topicResult = (t, toks) =>
    add(
      `<div class="result"><span class="ico"><span class="dot" style="--a:${t.color}"></span></span><div class="body">
        <div class="t">${mark(t.name, toks)}</div>
        <div class="m">Topic · ${plural(t.count, "note", "notes")}${t.areas.length ? " · " + esc(t.areas.map((a) => a.name).join(", ")) : ""}</div>
      </div></div>`,
      () => go(`#/topic/${t.id}`)
    );

  if (!q) {
    const recent = store.get("recent", []).filter((id) => S.note.has(id)).slice(0, 5);
    if (recent.length) groups.push(`<div class="palette-group">Ouvertes récemment</div>` + recent.map((id) => noteResult(S.note.get(id), [], recent)).join(""));
    groups.push(`<div class="palette-group">Topics</div>` + S.topics.map((t) => topicResult(t, [])).join(""));
  } else {
    const words = tokens(q);
    const { items: noteHits, toks } = search(S.noteDocs, q);
    const places = [
      ...S.areas
        .filter((a) => words.every((t) => norm(a.name).includes(t)))
        .map((a) =>
          add(
            `<div class="result"><span class="ico">${esc(a.emoji)}</span><div class="body"><div class="t">${mark(a.name, toks)}</div><div class="m">Area · ${plural(a.notes.length, "note", "notes")}</div></div></div>`,
            () => go(`#/area/${a.id}`)
          )
        ),
      ...S.topics.filter((t) => words.every((w) => norm(t.name).includes(w))).map((t) => topicResult(t, toks)),
    ];
    if (places.length) groups.push(`<div class="palette-group">Domaines</div>` + places.join(""));
    const notes = noteHits.map((d) => d.item);
    const noteIds = notes.map((n) => n.id);
    if (notes.length) groups.push(`<div class="palette-group">Notes · ${notes.length}</div>` + notes.slice(0, 8).map((n) => noteResult(n, toks, noteIds)).join(""));
    const hls = search(S.hlDocs, q).items;
    if (hls.length) {
      groups.push(
        `<div class="palette-group">Readwise · ${num(hls.length)}</div>` +
          hls
            .slice(0, 6)
            .map((d) => {
              const h = d.item;
              const b = S.book.get(h.bookId) || {};
              return add(
                `<div class="result"><span class="ico">${icon("quote")}</span><div class="body"><div class="s">${snippet(h.text, toks, 200)}</div><div class="m">${esc(b.title)}${b.author ? " · " + esc(b.author) : ""}</div></div></div>`,
                () => go(`#/readwise/${h.bookId}?h=${h.id}`)
              );
            })
            .join("") +
          (hls.length > 6
            ? add(`<div class="result more"><span class="ico">${icon("arrow")}</span><div class="body"><div class="t">Voir les ${num(hls.length)} passages Readwise</div></div></div>`, () =>
                go(`#/readwise?q=${encodeURIComponent(q)}`)
              )
            : "")
      );
    }
    if (!groups.length) groups.push(`<div class="palette-empty">Rien trouvé pour « ${esc(q)} ».<br>Essaie un mot plus court ou une racine (ex. « évang »).</div>`);
  }
  $("#palette-results").innerHTML = groups.join("");
  P.active = 0;
  highlightActive();
}

function highlightActive() {
  $$("#palette-results .result").forEach((el) => el.classList.toggle("is-active", Number(el.dataset.i) === P.active));
  $(`#palette-results .result[data-i="${P.active}"]`)?.scrollIntoView({ block: "nearest" });
}

function runPalette(i) {
  const run = P.items[i];
  if (!run) return;
  closePalette();
  run();
}

function go(hash) {
  if (location.hash === hash) onRoute();
  else location.hash = hash;
}

// ---------- Sélection ----------
function toggleSelection(k, id) {
  const on = isSelected(k, id);
  S.selection = on ? S.selection.filter((s) => !(s.k === k && s.id === id)) : [...S.selection, { k, id }];
  store.set("selection", S.selection);
  refreshSelectButtons(k, id);
  renderSidebar();
  toast(on ? "Retiré de ta sélection" : `Ajouté à ta sélection (${S.selection.length})`);
}

function refreshSelectButtons(k, id) {
  $$(`[data-action="select"][data-kind="${k}"][data-id="${id}"]`).forEach((btn) => {
    btn.outerHTML = selectButton(k, id, btn.classList.contains("pin"));
  });
}

function selectionMarkdown() {
  const parts = ["# Ma sélection", ""];
  for (const s of S.selection) {
    if (s.k === "note") {
      const n = S.note.get(s.id);
      const meta = [n.topics.map((t) => t.name).join(", "), n.sourceType, n.sourceText, fmtDate(n.created)].filter(Boolean).join(" · ");
      parts.push(`## ${n.title}`, meta ? `*${meta}*` : "", "", n.text.trim(), "", `[Ouvrir dans Notion](${n.url})`, "");
    } else {
      const h = S.hl.get(s.id);
      const b = S.book.get(h.bookId) || {};
      parts.push(...h.text.trim().split("\n").map((l) => "> " + l), `> — ${b.title}${b.author ? ", " + b.author : ""}`);
      if (h.note) parts.push("", `Ma note : ${h.note}`);
      parts.push("");
    }
  }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n");
}

// ---------- Divers ----------
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Repli pour les navigateurs qui refusent l'accès au presse-papier.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;opacity:0;top:0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

let toastTimer;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

function setTheme(theme) {
  store.set("theme", theme);
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  renderSidebar();
}

const typing = (el) => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);

function bindEvents() {
  window.addEventListener("hashchange", onRoute);

  document.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]");
    if (action) {
      handleAction(action);
      return;
    }
    if (e.target.closest("a")) return;
    const long = e.target.closest("blockquote.long");
    if (long) {
      long.classList.toggle("open");
      return;
    }
    const noteEl = e.target.closest("[data-note]");
    if (noteEl) {
      // La navigation précédente/suivante du lecteur suit la liste d'où vient le clic.
      const container = !noteEl.closest("#reader") && noteEl.closest(".grid, .list, .hl-stack");
      if (container) S.list = [...new Set($$("[data-note]", container).map((el) => el.dataset.note))];
      openNote(noteEl.dataset.note);
    }
  });

  $("#scrim").addEventListener("click", () => $("#app").classList.remove("menu-open"));
  $("#reader-scrim").addEventListener("click", closeReader);
  $("#palette").addEventListener("mousedown", (e) => {
    if (e.target.id === "palette") closePalette();
  });

  document.addEventListener("input", (e) => {
    const el = e.target;
    if (el.dataset.filter) {
      S.filters[el.dataset.filter].q = el.value;
      fillNotes(el.dataset.filter, currentNotes());
    } else if (el.id === "rw-q") {
      S.page = PAGE;
      const { parts, params } = parseHash();
      el.value.trim() ? params.set("q", el.value.trim()) : params.delete("q");
      history.replaceState(null, "", buildHash(parts, params));
      S.lastKey = routeKey(parts, params);
      fillReadwise();
    } else if (el.id === "book-q") {
      S.page = PAGE;
      fillBook(parseHash().parts[1]);
    } else if (el.id === "palette-q") {
      renderPalette();
    }
  });

  document.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.sort) {
      S.filters[el.dataset.sort].sort = el.value;
      fillNotes(el.dataset.sort, currentNotes());
    } else if (el.id === "rw-sort") {
      S.filters.readwise.sort = el.value;
      fillReadwise();
    }
  });

  $("#palette-q").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = P.items.length;
      if (!n) return;
      P.active = (P.active + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
      highlightActive();
    } else if (e.key === "Enter") {
      e.preventDefault();
      runPalette(P.active);
    }
  });
  $("#palette-results").addEventListener("mousemove", (e) => {
    const el = e.target.closest(".result");
    if (el && Number(el.dataset.i) !== P.active) {
      P.active = Number(el.dataset.i);
      highlightActive();
    }
  });
  $("#palette-results").addEventListener("click", (e) => {
    const el = e.target.closest(".result");
    if (el) runPalette(Number(el.dataset.i));
  });

  document.addEventListener("keydown", (e) => {
    const paletteOpen = !$("#palette").hidden;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      paletteOpen ? closePalette() : openPalette();
      return;
    }
    if (e.key === "Escape") {
      if (paletteOpen) closePalette();
      else if (S.readerOpen) closeReader();
      else $("#app").classList.remove("menu-open");
      return;
    }
    if (paletteOpen || typing(document.activeElement)) return;
    if (e.key === "/") {
      e.preventDefault();
      openPalette();
    } else if (S.readerOpen && (e.key === "ArrowRight" || e.key === "j")) {
      stepReader(1);
    } else if (S.readerOpen && (e.key === "ArrowLeft" || e.key === "k")) {
      stepReader(-1);
    } else if (e.key === "Enter" && document.activeElement?.dataset.note) {
      document.activeElement.click();
    }
  });

  document.addEventListener("error", (e) => e.target.tagName === "IMG" && e.target.classList.add("broken"), true);
}

function currentNotes() {
  const [view, id] = parseHash().parts;
  if (view === "area") return S.area.get(id)?.notes || [];
  if (view === "topic") return S.notesByTopic.get(id) || [];
  if (view === "favoris") return S.notes.filter((n) => n.favourite);
  if (view === "inbox") return S.inbox;
  return S.notes;
}

function handleAction(el) {
  const a = el.dataset.action;
  if (a === "menu") $("#app").classList.toggle("menu-open");
  else if (a === "search") openPalette(el.dataset.q || "");
  else if (a === "theme") setTheme({ auto: "light", light: "dark", dark: "auto" }[store.get("theme", "auto")]);
  else if (a === "lock") {
    store.del("key");
    location.reload();
  } else if (a === "select") toggleSelection(el.dataset.kind, el.dataset.id);
  else if (a === "select-all") {
    const missing = S.list.filter((id) => !isSelected("note", id));
    S.selection = [...S.selection, ...missing.map((id) => ({ k: "note", id }))];
    store.set("selection", S.selection);
    missing.forEach((id) => refreshSelectButtons("note", id));
    renderSidebar();
    toast(missing.length ? `${plural(missing.length, "note ajoutée", "notes ajoutées")} à ta sélection` : "Tout est déjà dans ta sélection");
  } else if (a === "close-reader") closeReader();
  else if (a === "prev") stepReader(-1);
  else if (a === "next") stepReader(1);
  else if (a === "shuffle") $("#resurface").innerHTML = resurfaceInner();
  else if (a === "type") {
    const f = S.filters[el.dataset.key];
    f.type = f.type === el.dataset.type ? "" : el.dataset.type;
    $$(`[data-action="type"][data-key="${el.dataset.key}"]`).forEach((b) => b.classList.toggle("is-on", b.dataset.type === f.type));
    fillNotes(el.dataset.key, currentNotes());
  } else if (a === "layout") {
    store.set("layout", el.dataset.layout);
    $$('[data-action="layout"]').forEach((b) => b.classList.toggle("is-on", b === el));
    const key = $("[data-filter]")?.dataset.filter;
    if (key) fillNotes(key, currentNotes());
  } else if (a === "rw-cat") {
    S.filters.readwise.cat = el.dataset.cat;
    $$('[data-action="rw-cat"]').forEach((b) => b.classList.toggle("is-on", b === el));
    fillReadwise();
  } else if (a === "more") {
    S.page += PAGE * 2;
    const [view, id] = parseHash().parts;
    view === "readwise" && id ? fillBook(id) : fillReadwise();
  } else if (a === "sel-move" || a === "sel-remove") {
    const i = Number(el.dataset.index);
    if (a === "sel-remove") S.selection.splice(i, 1);
    else {
      const j = i + Number(el.dataset.dir);
      [S.selection[i], S.selection[j]] = [S.selection[j], S.selection[i]];
    }
    store.set("selection", S.selection);
    $("#view").innerHTML = viewSelection();
    renderSidebar();
  } else if (a === "sel-copy") {
    copyText(selectionMarkdown()).then((ok) => toast(ok ? "Copié ! Colle-le où tu veux." : "Impossible de copier sur cet appareil."));
  } else if (a === "sel-clear") {
    if (!confirm("Vider ta sélection ?")) return;
    S.selection = [];
    store.set("selection", S.selection);
    $("#view").innerHTML = viewSelection();
    renderSidebar();
  }
}

// ---------- Déchiffrement et démarrage ----------
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function loadVault() {
  const response = await fetch("data.bin", { cache: "no-cache" });
  if (!response.ok) throw new Error("absent");
  const buf = new Uint8Array(await response.arrayBuffer());
  if (String.fromCharCode(...buf.slice(0, 4)) !== "PDB1") throw new Error("format");
  return {
    iterations: new DataView(buf.buffer).getUint32(4),
    salt: buf.slice(8, 24),
    iv: buf.slice(24, 36),
    data: buf.slice(36),
  };
}

async function deriveKey(password, vault) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: vault.salt, iterations: vault.iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    true,
    ["decrypt"]
  );
}

async function openVault(vault, key) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: vault.iv }, key, vault.data);
  const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}

function start(data) {
  index(data);
  $("#lock").hidden = true;
  $("#app").hidden = false;
  bindEvents();
  onRoute();
}

async function boot() {
  const lock = $("#lock");
  const form = $("#lock-form");
  let vault;
  try {
    vault = await loadVault();
  } catch {
    lock.hidden = false;
    $("#lock-sub").textContent = "Aucune donnée pour l'instant : la première synchronisation n'a pas encore tourné.";
    form.querySelectorAll("input, button").forEach((el) => (el.disabled = true));
    return;
  }

  const saved = store.get("key");
  if (saved && saved.salt === b64(vault.salt) && saved.iter === vault.iterations) {
    try {
      const key = await crypto.subtle.importKey("raw", unb64(saved.k), "AES-GCM", false, ["decrypt"]);
      return start(await openVault(vault, key));
    } catch {
      store.del("key");
    }
  }

  lock.hidden = false;
  const input = $("#lock-password");
  const button = $("#lock-submit");
  input.focus();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    button.disabled = true;
    button.textContent = "Ouverture…";
    $("#lock-error").textContent = "";
    try {
      const key = await deriveKey(input.value, vault);
      const data = await openVault(vault, key);
      if ($("#lock-remember").checked) {
        const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
        store.set("key", { salt: b64(vault.salt), iter: vault.iterations, k: b64(raw) });
      }
      start(data);
    } catch {
      $("#lock-error").textContent = "Mot de passe incorrect.";
      form.classList.remove("shake");
      void form.offsetWidth;
      form.classList.add("shake");
      input.select();
      button.disabled = false;
      button.textContent = "Ouvrir";
    }
  });
}

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
boot();
