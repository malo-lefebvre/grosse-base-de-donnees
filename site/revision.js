// Révision façon Anki : 5 boîtes de Leitner, cartes tirées des notes et des surlignages Readwise.
// La progression vit dans le navigateur. Avec un jeton d'écriture, elle est aussi enregistrée chiffrée
// (avec ton mot de passe) sur la branche « progression » du dépôt, pour être la même sur tous tes appareils.
// Les résumés et les notes de connexion partent dans envois.bin, qu'une action GitHub applique dans Notion.

const BOX_DAYS = [0, 1, 3, 7, 14, 30]; // boîte → jours avant la prochaine révision
const TYPES = {
  recall: { label: "Titre → idée", emoji: "💭" },
  qa: { label: "Questions", emoji: "❓" },
  cloze: { label: "Texte à trous", emoji: "🧩" },
  memorize: { label: "Par cœur", emoji: "📜" },
};
const HIGHLIGHT = { label: "Surlignages Readwise", emoji: "📚" };
const MODES = [
  { id: "jour", emoji: "☀️", label: "Session du jour", desc: "Les cartes à revoir aujourd'hui, puis quelques nouvelles." },
  { id: "topic", emoji: "🎯", label: "Par Topic", desc: "Tout un Topic, par exemple avant de lancer un projet." },
  { id: "connexions", emoji: "🔗", label: "Connexions", desc: "Deux notes de Topics différents : quel lien vois-tu ?" },
  { id: "audio", emoji: "🎧", label: "Audio mains libres", desc: "Les cartes du jour lues à voix haute, pour marcher ou conduire." },
  { id: "resumer", emoji: "✨", label: "Résumer", desc: "Relis une note et envoie son résumé en tête, dans Notion." },
];
// v2 : les surlignages Readwise sont retirés des révisions (à la demande de Malo) ; un clic les remet.
const DEFAULTS = { types: Object.keys(TYPES), readwise: false, newPerDay: 15, pause: 6, voice: false, t: 0, v: 2 };
const PROGRESS_FILE = "etat.bin";
const OUTBOX_FILE = "envois.bin";

// ---------- Petits outils ----------
const pad = (n) => String(n).padStart(2, "0");
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDay(new Date());
const inDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return isoDay(d);
};
const dayLabel = (n) => (n <= 1 ? "demain" : `dans ${n} j`);
function hash(s) {
  let h = 0x811c9dc5;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193);
  return (h >>> 0).toString(36);
}
function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const CLOZE = /\{\{(.+?)\}\}/g;
const toB64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s) => Uint8Array.from(atob(s.replace(/\s/g, "")), (c) => c.charCodeAt(0));

function freshState() {
  return { v: 1, cards: {}, edits: {}, summarized: {}, daily: {}, settings: { ...DEFAULTS }, updatedAt: 0 };
}

export function createRevision(ctx) {
  const { S, $, esc, icon, toast, store, fmtDate, num, plural, clip, openNote } = ctx;
  const R = {
    cards: [],
    byId: new Map(),
    state: { ...freshState(), ...store.get("revision", {}) },
    route: [],
    session: null,
    pair: null,
    distill: null,
    remote: { sha: null, status: "local", at: 0, error: "", timer: null, busy: false },
    outbox: { sha: null, outbox: [], results: [] },
    crypto: null,
  };
  const storedVersion = R.state.settings?.v || 1;
  R.state.settings = upgradeSettings(R.state.settings);
  if (storedVersion < 2) store.set("revision", R.state);

  // Réglages enregistrés par une version précédente : on y applique les changements de défaut.
  function upgradeSettings(stored) {
    const s = { ...DEFAULTS, ...stored };
    if ((stored?.v || 1) >= 2) return s;
    return { ...s, readwise: false, v: 2, t: Date.now() };
  }

  // ---------- Cartes ----------
  function build() {
    const ai = S.data.review?.notes || {};
    const cards = [];
    for (const n of S.notes) {
      const rv = ai[n.id] || {};
      if ((n.text || "").trim().length >= 20) cards.push({ id: `n:${n.id}:r`, type: "recall", note: n });
      for (const x of rv.qa || []) cards.push({ id: `n:${n.id}:q:${hash(x.q)}`, type: "qa", note: n, q: x.q, a: x.a });
      for (const t of rv.cloze || []) cards.push({ id: `n:${n.id}:c:${hash(t)}`, type: "cloze", note: n, text: t });
      for (const m of rv.memorize || [])
        cards.push({ id: `n:${n.id}:m:${hash(m.ref + m.text)}`, type: "memorize", note: n, ref: m.ref, text: m.text });
    }
    for (const h of S.highlights) cards.push({ id: `h:${h.id}`, type: "highlight", hl: h, book: S.book.get(h.bookId) || {} });
    R.cards = cards.flatMap((c) => {
      const e = R.state.edits[c.id];
      if (!e) return [c];
      return e.deleted ? [] : [{ ...c, ...e.fields, edited: true }];
    });
    R.byId = new Map(R.cards.map((c) => [c.id, c]));
  }

  const settings = () => R.state.settings;
  const enabled = (c) => (c.type === "highlight" ? settings().readwise : settings().types.includes(c.type));
  const progress = (c) => R.state.cards[c.id];
  const isDue = (c) => progress(c) && progress(c).d <= today();
  const isNew = (c) => !progress(c);
  const newLeft = () => Math.max(0, settings().newPerDay - (R.state.daily[today()]?.n || 0));
  const summaryOf = (n) => S.data.review?.notes?.[n.id]?.summary || [];

  function dailyQueue() {
    const pool = R.cards.filter(enabled);
    const due = pool.filter(isDue).sort((a, b) => progress(a).b - progress(b).b || progress(a).d.localeCompare(progress(b).d));
    const fresh = pool.filter(isNew);
    // Les nouvelles notes passent en premier, puis les surlignages au hasard.
    const notes = fresh.filter((c) => c.note).sort((a, b) => (b.note.created || "").localeCompare(a.note.created || ""));
    const news = [...notes, ...shuffle(fresh.filter((c) => c.hl))].slice(0, newLeft());
    return [...due, ...shuffle(news)];
  }

  function topicQueue(topicId) {
    const pool = R.cards.filter((c) => c.note && c.type !== "highlight" && settings().types.includes(c.type) && c.note.topicIds.includes(topicId));
    const box = (c) => progress(c)?.b || 0;
    return [...shuffle(pool.filter(isDue)), ...shuffle(pool.filter((c) => !isDue(c) && !isNew(c))).sort((a, b) => box(a) - box(b)), ...shuffle(pool.filter(isNew))];
  }

  function nextBox(c, g) {
    const p = progress(c);
    if (!p) return g === 2 ? 2 : 1;
    return g === 0 ? 1 : Math.min(5, p.b + g);
  }

  function grade(c, g) {
    const p = progress(c);
    const box = nextBox(c, g);
    const day = (R.state.daily[today()] ||= { n: 0, r: 0 });
    if (!p) day.n++;
    day.r++;
    R.state.cards[c.id] = { b: box, d: inDays(BOX_DAYS[box]), t: Date.now(), n: (p?.n || 0) + 1, l: (p?.l || 0) + (g === 0 ? 1 : 0) };
    save();
  }

  function counts() {
    const pool = R.cards.filter(enabled);
    const boxes = [0, 0, 0, 0, 0, 0];
    let due = 0;
    for (const c of pool) {
      const p = progress(c);
      boxes[p ? p.b : 0]++;
      if (p && p.d <= today()) due++;
    }
    return { due, fresh: boxes[0], boxes, todayNew: Math.min(boxes[0], newLeft()), reviewed: R.state.daily[today()]?.r || 0 };
  }

  // ---------- Enregistrement local et synchronisé ----------
  function save() {
    R.state.updatedAt = Date.now();
    store.set("revision", R.state);
    if (writeCfg()) {
      clearTimeout(R.remote.timer);
      R.remote.timer = setTimeout(pushProgress, 4000);
    }
  }

  const writeCfg = () => (S.data.write?.token && S.data.repo && R.crypto ? { ...S.data.write, repo: S.data.repo } : null);

  async function seal(obj) {
    const gz = await new Response(new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, R.crypto.key, gz));
    const out = new Uint8Array(36 + ct.length);
    out.set([80, 68, 66, 49]);
    new DataView(out.buffer).setUint32(4, R.crypto.iterations);
    out.set(R.crypto.salt, 8);
    out.set(iv, 24);
    out.set(ct, 36);
    return out;
  }

  async function unseal(bytes) {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(24, 36) }, R.crypto.key, bytes.slice(36));
    return JSON.parse(await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).text());
  }

  async function gh(method, file, body) {
    const w = writeCfg();
    const url = `https://api.github.com/repos/${w.repo}/contents/${file}` + (method === "GET" ? `?ref=${encodeURIComponent(w.branch)}` : "");
    const response = await fetch(url, {
      method,
      cache: "no-store",
      headers: { Authorization: `Bearer ${w.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      body: body && JSON.stringify(body),
    });
    if (method === "GET" && response.status === 404) return null;
    if (response.status === 409 || response.status === 422) throw Object.assign(new Error("conflit"), { conflict: true });
    if (!response.ok) {
      const reasons = {
        401: "jeton refusé : invalide ou expiré",
        403: "jeton sans droit d'écriture : il lui faut Contents en Read and write",
        404: "jeton sans accès à ce dépôt : coche grosse-base-de-donnees dans Repository access",
      };
      throw new Error(reasons[response.status] || `GitHub ${response.status}`);
    }
    return response.json();
  }

  async function pull(file) {
    const found = await gh("GET", file);
    if (!found) return { sha: null, obj: null };
    return { sha: found.sha, obj: await unseal(fromB64(found.content)) };
  }

  async function put(file, obj, sha, message) {
    const w = writeCfg();
    const result = await gh("PUT", file, { message, content: toB64(await seal(obj)), branch: w.branch, ...(sha ? { sha } : {}) });
    return result.content.sha;
  }

  function merge(local, remote) {
    if (!remote) return local;
    const out = { ...freshState(), ...remote };
    out.cards = { ...remote.cards };
    for (const [id, p] of Object.entries(local.cards || {})) if (!out.cards[id] || (p.t || 0) > (out.cards[id].t || 0)) out.cards[id] = p;
    out.edits = { ...remote.edits };
    for (const [id, e] of Object.entries(local.edits || {})) if (!out.edits[id] || e.t > out.edits[id].t) out.edits[id] = e;
    out.summarized = { ...remote.summarized, ...local.summarized };
    out.daily = { ...remote.daily };
    for (const [d, x] of Object.entries(local.daily || {})) {
      const y = out.daily[d] || { n: 0, r: 0 };
      out.daily[d] = { n: Math.max(x.n, y.n), r: Math.max(x.r, y.r) };
    }
    const old = inDays(-60);
    for (const d of Object.keys(out.daily)) if (d < old) delete out.daily[d];
    out.settings = upgradeSettings((local.settings?.t || 0) >= (remote.settings?.t || 0) ? local.settings : remote.settings);
    out.updatedAt = Math.max(local.updatedAt || 0, remote.updatedAt || 0);
    return out;
  }

  async function pushProgress() {
    if (!writeCfg() || R.remote.busy) return;
    R.remote.busy = true;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          R.remote.sha = await put(PROGRESS_FILE, R.state, R.remote.sha, "Progression de révision");
          break;
        } catch (e) {
          if (!e.conflict || attempt === 2) throw e;
          const { sha, obj } = await pull(PROGRESS_FILE);
          R.state = merge(R.state, obj);
          R.remote.sha = sha;
          store.set("revision", R.state);
        }
      }
      Object.assign(R.remote, { status: "ok", at: Date.now(), error: "" });
    } catch (e) {
      Object.assign(R.remote, { status: "error", error: e.message });
    } finally {
      R.remote.busy = false;
      refreshSyncLine();
    }
  }

  async function syncNow() {
    if (!writeCfg()) return;
    try {
      const [progressFile, outbox] = await Promise.all([pull(PROGRESS_FILE), pull(OUTBOX_FILE)]);
      // On ne renvoie la progression que si cet appareil a du nouveau (révisions faites hors ligne, par exemple).
      const localIsNewer = !progressFile.obj || (R.state.updatedAt || 0) > (progressFile.obj.updatedAt || 0);
      R.state = merge(R.state, progressFile.obj);
      R.remote.sha = progressFile.sha;
      store.set("revision", R.state);
      R.outbox = { sha: outbox.sha, outbox: outbox.obj?.outbox || [], results: outbox.obj?.results || [] };
      Object.assign(R.remote, { status: "ok", at: Date.now(), error: "" });
      build();
      if (localIsNewer && R.state.updatedAt) await pushProgress();
    } catch (e) {
      Object.assign(R.remote, { status: "error", error: e.message });
    }
    if (S.view === "revision" && !R.route.length) paint();
    else refreshSyncLine();
  }

  async function send(action) {
    if (!writeCfg()) {
      toast("Envoi impossible : le jeton d'écriture n'est pas encore configuré.");
      return false;
    }
    const item = { id: crypto.randomUUID(), at: new Date().toISOString(), ...action };
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { sha, obj } = await pull(OUTBOX_FILE);
        const box = { outbox: [], results: [], ...(obj || {}) };
        box.outbox.push(item);
        try {
          const newSha = await put(OUTBOX_FILE, box, sha, "Envoi depuis la page Révision");
          R.outbox = { sha: newSha, outbox: box.outbox, results: box.results };
          toast("Envoyé : ça arrive dans Notion d'ici une à deux minutes.");
          return true;
        } catch (e) {
          if (!e.conflict) throw e;
        }
      }
      throw new Error("conflit répété");
    } catch (e) {
      toast(`Envoi impossible (${e.message}).`);
      return false;
    }
  }

  function syncLine() {
    if (!writeCfg()) return `<span class="rv-sync">Progression gardée sur cet appareil.</span>`;
    const pending = R.outbox.outbox.length ? ` · ${plural(R.outbox.outbox.length, "envoi en cours", "envois en cours")}` : "";
    if (R.remote.status === "error") return `<span class="rv-sync is-error">Synchro impossible (${esc(R.remote.error)}) · <button class="link-btn" data-action="rv-sync">Réessayer</button></span>`;
    if (R.remote.status === "ok") return `<span class="rv-sync is-ok">${icon("check")} Progression synchronisée${pending}</span>`;
    return `<span class="rv-sync">Synchronisation…</span>`;
  }
  function refreshSyncLine() {
    const el = $("#rv-sync-line");
    if (el) el.innerHTML = syncLine();
  }

  // ---------- Démarrage ----------
  function load(key, vault) {
    R.crypto = { key, salt: vault.salt, iterations: vault.iterations };
    build();
    syncNow();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && R.remote.timer) {
        clearTimeout(R.remote.timer);
        R.remote.timer = null;
        pushProgress();
      }
    });
  }

  function dueCount() {
    return R.cards.length ? counts().due : 0;
  }

  // ---------- Vues ----------
  function view(parts) {
    stopAudio();
    R.route = parts;
    const [mode, id] = parts;
    R.session = null;
    if (mode === "jour" || mode === "audio") R.session = newSession(mode, dailyQueue());
    if (mode === "topic" && id) R.session = newSession("topic", topicQueue(id), id);
    if (mode === "connexions") R.pair = pickPair();
    if (mode === "resumer") R.distill = { queue: distillQueue(), i: 0 };
    return html();
  }

  function paint() {
    document.activeElement?.blur();
    $("#view").innerHTML = html();
    mount();
  }

  function html() {
    const [mode, id] = R.route;
    if (mode === "jour" || (mode === "topic" && id)) return sessionHtml();
    if (mode === "topic") return topicPickerHtml();
    if (mode === "connexions") return connectionsHtml();
    if (mode === "audio") return audioHtml();
    if (mode === "resumer") return distillHtml();
    return homeHtml();
  }

  function mount() {
    const focus = $("[data-autofocus]");
    if (focus) focus.focus({ preventScroll: true });
  }

  const back = `<a class="btn btn-sm" href="#/revision">${icon("x")}<span>Terminer</span></a>`;

  function homeHtml() {
    const c = counts();
    const s = settings();
    const typeCount = (t) => R.cards.filter((x) => x.type === t).length;
    const chips = Object.entries(TYPES)
      .map(([t, v]) => `<button class="chip ${s.types.includes(t) ? "is-on" : ""}" data-action="rv-type" data-type="${t}">${v.emoji} ${v.label} <span class="count">${num(typeCount(t))}</span></button>`)
      .join("");
    const rwChip = S.highlights.length
      ? `<button class="chip ${s.readwise ? "is-on" : ""}" data-action="rv-readwise">${HIGHLIGHT.emoji} ${HIGHLIGHT.label} <span class="count">${num(S.highlights.length)}</span></button>`
      : "";
    const boxes = [1, 2, 3, 4, 5]
      .map((b) => `<div class="rv-box"><b>${num(c.boxes[b])}</b><span>Boîte ${b}</span><small>${b === 1 ? "chaque jour" : `tous les ${BOX_DAYS[b]} j`}</small></div>`)
      .join("");
    const modes = MODES.map((m) => {
      const meta = { jour: `${num(c.due)} à revoir · ${num(c.todayNew)} nouvelles`, audio: `${num(c.due + c.todayNew)} cartes`, resumer: `${num(distillQueue().length)} notes à résumer` }[m.id] || "";
      return `<a class="card clickable rv-mode" href="#/revision/${m.id}"><span class="rv-mode-emoji">${m.emoji}</span><b>${m.label}</b><p>${m.desc}</p>${meta ? `<span class="badge">${meta}</span>` : ""}</a>`;
    }).join("");
    const results = R.outbox.results.slice(0, 4)
      .map((r) => `<li class="${r.ok ? "" : "is-error"}">${r.ok ? "✓" : "✗"} ${esc(r.message)} <span class="muted">· ${fmtDate(r.at)}</span></li>`)
      .join("");
    return `
      <div class="page-head">
        <div><h1 class="page-title">Révision</h1>
        <p class="page-sub">${c.due ? `${plural(c.due, "carte à revoir", "cartes à revoir")} aujourd'hui` : "Rien à revoir aujourd'hui"} · ${plural(c.todayNew, "nouvelle carte", "nouvelles cartes")} disponibles${c.reviewed ? ` · ${plural(c.reviewed, "révisée", "révisées")} aujourd'hui` : ""}</p></div>
        <div class="page-actions"><a class="btn btn-primary" href="#/revision/jour">${icon("arrow")}<span>Commencer</span></a></div>
      </div>
      <div class="rv-boxes"><div class="rv-box is-new"><b>${num(c.fresh)}</b><span>Jamais vues</span><small>${num(s.newPerDay)} par jour</small></div>${boxes}</div>
      <section class="section"><div class="section-head"><h2 class="section-title">Modes</h2></div><div class="grid rv-modes">${modes}</div></section>
      <section class="section"><div class="section-head"><h2 class="section-title">Types de cartes</h2><span class="muted">Coche-en un ou plusieurs : les cartes se mélangent.</span></div>
        <div class="chips">${chips}${rwChip}</div></section>
      <section class="section"><div class="section-head"><h2 class="section-title">Réglages</h2></div>
        <div class="rv-settings">
          <label>Nouvelles cartes par jour <select class="select" data-rv="newPerDay">${[5, 10, 15, 20, 30, 50].map((n) => `<option ${n === s.newPerDay ? "selected" : ""}>${n}</option>`).join("")}</select></label>
          <label>Pause avant la réponse (audio) <select class="select" data-rv="pause">${[3, 6, 10, 15].map((n) => `<option value="${n}" ${n === s.pause ? "selected" : ""}>${n} s</option>`).join("")}</select></label>
        </div>
        <p class="rv-foot" id="rv-sync-line">${syncLine()}</p>
        ${results ? `<ul class="rv-results">${results}</ul>` : ""}
      </section>`;
  }

  function topicPickerHtml() {
    const rows = S.topics
      .map((t) => {
        const n = R.cards.filter((c) => c.note && c.type !== "highlight" && settings().types.includes(c.type) && c.note.topicIds.includes(t.id)).length;
        return n ? `<a class="list-row" href="#/revision/topic/${t.id}" style="--a:${t.color}"><div class="t">${esc(t.name)}</div><div class="s">${plural(n, "carte", "cartes")}</div></a>` : "";
      })
      .join("");
    return `<div class="page-head"><div><h1 class="page-title">Réviser un Topic</h1><p class="page-sub">Toutes les cartes du Topic, celles à revoir d'abord.</p></div><div class="page-actions">${back}</div></div>
      <div class="list">${rows || `<div class="empty"><b>Aucune carte</b>Active au moins un type de cartes.</div>`}</div>`;
  }

  // ---------- Session de cartes ----------
  function newSession(mode, queue, topicId) {
    return { mode, queue, topicId, i: 0, revealed: false, editing: false, summary: false, ok: 0, ko: 0, again: new Map() };
  }

  const current = () => R.session?.queue[R.session.i];

  function sessionHtml() {
    const s = R.session;
    const title = s.mode === "topic" ? `${S.topic.get(s.topicId)?.name || "Topic"}` : "Session du jour";
    if (!s.queue.length) {
      return `<div class="page-head"><div><h1 class="page-title">${esc(title)}</h1></div><div class="page-actions">${back}</div></div>
        <div class="empty"><b>Rien à réviser pour l'instant ✓</b>Reviens demain, ou essaie un autre mode.</div>`;
    }
    const c = current();
    if (!c) {
      return `<div class="page-head"><div><h1 class="page-title">${esc(title)}</h1></div><div class="page-actions">${back}</div></div>
        <div class="rv-done card"><div class="rv-done-emoji">🎉</div><h2>Session terminée</h2>
        <p>${plural(s.ok, "carte sue", "cartes sues")} · ${plural(s.ko, "à revoir", "à revoir")}</p>
        <div class="rv-row"><a class="btn" href="#/revision">Retour</a><a class="btn btn-primary" href="#/revision/connexions">Essayer Connexions</a></div></div>`;
    }
    const total = s.queue.length;
    return `<div class="rv-top"><span class="muted">${esc(title)} · ${s.i + 1} / ${total}</span><div class="rv-bar"><i style="width:${(s.i / total) * 100}%"></i></div>${back}</div>
      ${cardHtml(c)}
      ${s.revealed && !s.editing ? gradeButtons(c) : !s.editing ? `<div class="rv-actions"><button class="btn btn-primary rv-big" data-action="rv-reveal">Voir la réponse <kbd>Espace</kbd></button></div>` : ""}`;
  }

  function gradeButtons(c) {
    const label = (g) => dayLabel(BOX_DAYS[nextBox(c, g)]);
    return `<div class="rv-actions">
      <button class="btn rv-big rv-ko" data-action="rv-grade" data-g="0">Raté <small>${label(0)}</small><kbd>1</kbd></button>
      <button class="btn rv-big rv-ok" data-action="rv-grade" data-g="1">Bien <small>${label(1)}</small><kbd>2</kbd></button>
      <button class="btn rv-big" data-action="rv-grade" data-g="2">Facile <small>${label(2)}</small><kbd>3</kbd></button>
    </div>`;
  }

  function kicker(c) {
    const t = c.type === "highlight" ? HIGHLIGHT : TYPES[c.type];
    const box = progress(c)?.b;
    const where = c.note ? c.note.topics.slice(0, 2).map((t) => `<span class="topic-tag" style="--a:${t.color}">${esc(t.name)}</span>`).join("") : "";
    return `<div class="rv-kicker"><span class="badge">${t.emoji} ${t.label}</span>${where}<span class="badge">${box ? `Boîte ${box}` : "Nouvelle"}</span>
      <span class="spacer"></span>${toolbar(c)}</div>`;
  }

  function toolbar(c) {
    const ai = c.type === "qa" || c.type === "cloze" || c.type === "memorize";
    return [
      c.note ? `<button class="icon-btn" data-action="rv-open" title="Ouvrir la note" aria-label="Ouvrir la note">${icon("notes")}</button>` : "",
      c.hl && safeUrl(c.hl.url) ? `<a class="icon-btn" href="${esc(c.hl.url)}" target="_blank" rel="noopener" title="Ouvrir dans Readwise" aria-label="Ouvrir dans Readwise">${icon("external")}</a>` : "",
      ai ? `<button class="icon-btn" data-action="rv-edit" title="Modifier la carte" aria-label="Modifier la carte">${icon("edit")}</button>` : "",
      ai ? `<button class="icon-btn" data-action="rv-delete" title="Supprimer la carte" aria-label="Supprimer la carte">${icon("trash")}</button>` : "",
    ].join("");
  }

  const safeUrl = (u) => /^https?:\/\//i.test(u || "");

  function cardHtml(c) {
    const s = R.session;
    // L'animation d'entrée seulement quand une nouvelle carte arrive, pas quand on la retourne.
    const enter = R.lastCard !== c.id && !s.editing ? "rv-enter" : "";
    R.lastCard = c.id;
    if (s.editing) return `<article class="card rv-card" data-card="${esc(c.id)}">${kicker(c)}${editHtml(c)}</article>`;
    return `<article class="card rv-card ${enter}" data-card="${esc(c.id)}">${kicker(c)}<div class="rv-front">${frontHtml(c)}</div>
      ${s.revealed ? `<div class="rv-back">${backHtml(c)}</div>${c.note ? summaryBlock(c.note) : ""}` : ""}</article>`;
  }

  function frontHtml(c) {
    if (c.type === "recall") return `<h2 class="rv-title">${esc(c.note.title)}</h2><p class="rv-hint">Rappelle-toi l'idée de cette note, puis retourne la carte.</p>`;
    if (c.type === "qa") return `<h2 class="rv-q">${esc(c.q)}</h2>`;
    if (c.type === "cloze") return `<p class="rv-cloze">${esc(c.text).replace(/\{\{(.+?)\}\}/g, '<span class="rv-gap">[ … ]</span>')}</p><p class="rv-hint">Retrouve le mot qui manque.</p>`;
    if (c.type === "memorize") {
      const level = progress(c)?.b || 1;
      const hint = ["", "Lis-le à voix haute, deux fois.", "Récite-le en t'aidant des mots restants.", "Récite-le avec les premières lettres.", "Récite-le à partir du début.", "Récite-le en entier."][level];
      return `<div class="rv-ref">${esc(c.ref)}</div><p class="rv-verse">${maskVerse(c.text, level)}</p><p class="rv-hint">${hint}</p>`;
    }
    return `<blockquote class="rv-quote">${esc(c.hl.text)}</blockquote><p class="rv-hint">D'où vient ce passage ? Qu'est-ce qu'il t'inspire ?</p>`;
  }

  function backHtml(c) {
    const from = c.note ? `<p class="rv-from">Tiré de <button class="link-btn" data-action="rv-open">${esc(c.note.title)}</button></p>` : "";
    if (c.type === "recall") return `<div class="prose rv-prose">${c.note.html || esc(c.note.text)}</div>`;
    if (c.type === "qa") return `<p class="rv-a">${esc(c.a)}</p>${from}`;
    if (c.type === "cloze") return `<p class="rv-cloze">${esc(c.text).replace(/\{\{(.+?)\}\}/g, "<mark>$1</mark>")}</p>${from}`;
    if (c.type === "memorize") return `<p class="rv-verse is-full">${esc(c.text)}</p>${from}`;
    const b = c.book;
    return `<p class="rv-from"><b>${esc(b.title || "")}</b>${b.author ? ` · ${esc(b.author)}` : ""}${c.hl.date ? ` · ${fmtDate(c.hl.date)}` : ""}</p>${c.hl.note ? `<p class="hl-note">✍️ ${esc(c.hl.note)}</p>` : ""}`;
  }

  function maskVerse(text, level) {
    if (level <= 1) return esc(text);
    if (level >= 5) return `<span class="rv-gap">[ récite le passage ]</span>`;
    if (level === 4) return `${esc(text.split(/\s+/).slice(0, 4).join(" "))} …`;
    let index = 0;
    const words = text.split(/(\s+)/).map((part) => {
      if (!part.trim()) return part;
      const i = index++;
      const m = part.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}’'-]+)(.*)$/u);
      if (!m) return esc(part);
      const [, pre, word, post] = m;
      const hide = level === 3 || i % 2 === 1;
      if (!hide) return esc(part);
      const shown = level === 3 ? word[0] : "";
      return `${esc(pre)}<span class="rv-blank">${esc(shown)}${"_".repeat(Math.max(2, Math.min(8, word.length - shown.length)))}</span>${esc(post)}`;
    });
    return words.join("");
  }

  // ---------- Résumé (couche 4) ----------
  function summaryBlock(n) {
    const s = R.session;
    if (R.state.summarized[n.id]) return `<p class="rv-from muted">✓ Résumé déjà envoyé dans Notion.</p>`;
    if (!s.summary) return `<div class="rv-row"><button class="btn btn-sm" data-action="rv-summarize">✨ Résumer cette note</button></div>`;
    return summaryEditor(n);
  }

  function summaryEditor(n) {
    const bullets = summaryOf(n);
    return `<div class="rv-summary">
      <label class="rv-label">Résumé à mettre en tête de la note (une idée par ligne)</label>
      <textarea id="rv-summary" rows="${Math.max(3, bullets.length + 1)}" placeholder="Écris l'essentiel de la note en quelques lignes…">${esc(bullets.join("\n"))}</textarea>
      <div class="rv-row"><button class="btn btn-primary btn-sm" data-action="rv-send-summary" data-note-id="${n.id}">Envoyer en tête de la note dans Notion</button>
      ${R.route[0] === "resumer" ? "" : `<button class="btn btn-sm" data-action="rv-cancel-summary">Annuler</button>`}</div>
    </div>`;
  }

  async function sendSummary(noteId) {
    const note = S.note.get(noteId);
    const bullets = ($("#rv-summary")?.value || "").split("\n").map((l) => l.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);
    if (!bullets.length) return toast("Écris au moins une ligne.");
    if (!(await send({ type: "summary", noteId, noteTitle: note.title, bullets }))) return;
    R.state.summarized[noteId] = today();
    save();
    if (R.route[0] === "resumer") {
      R.distill.i++;
      paint();
    } else {
      R.session.summary = false;
      paint();
    }
  }

  function distillQueue() {
    return S.notes
      .filter((n) => summaryOf(n).length && !R.state.summarized[n.id])
      .sort((a, b) => (b.created || "").localeCompare(a.created || ""));
  }

  function distillHtml() {
    const d = R.distill;
    const n = d.queue[d.i];
    const head = `<div class="page-head"><div><h1 class="page-title">Résumer</h1><p class="page-sub">La couche 4 de Forte : l'essentiel en quelques lignes, en tête de la note.</p></div><div class="page-actions">${back}</div></div>`;
    if (!n) return head + `<div class="empty"><b>Plus rien à résumer ✓</b>Toutes les notes avec un résumé proposé sont passées.</div>`;
    return `${head}<div class="rv-top"><span class="muted">${d.i + 1} / ${d.queue.length}</span><div class="rv-bar"><i style="width:${(d.i / d.queue.length) * 100}%"></i></div></div>
      <div class="rv-distill">
        <article class="card rv-card"><div class="rv-kicker">${n.topics.slice(0, 2).map((t) => `<span class="topic-tag" style="--a:${t.color}">${esc(t.name)}</span>`).join("")}<span class="spacer"></span>
          <button class="icon-btn" data-action="rv-open-note" data-note-id="${n.id}" title="Ouvrir la note">${icon("notes")}</button></div>
          <h2 class="rv-title">${esc(n.title)}</h2><div class="prose rv-prose">${n.html || esc(n.text)}</div></article>
        <div class="card rv-card">${summaryEditor(n)}<div class="rv-row"><button class="btn btn-sm" data-action="rv-skip-note">Passer</button></div></div>
      </div>`;
  }

  // ---------- Modification des cartes ----------
  function editHtml(c) {
    const fields =
      c.type === "qa"
        ? `<label class="rv-label">Question</label><textarea id="rv-e1" rows="2">${esc(c.q)}</textarea><label class="rv-label">Réponse</label><textarea id="rv-e2" rows="3">${esc(c.a)}</textarea>`
        : c.type === "cloze"
          ? `<label class="rv-label">Phrase (mets le mot à cacher entre {{ et }})</label><textarea id="rv-e1" rows="3">${esc(c.text)}</textarea>`
          : `<label class="rv-label">Référence</label><input id="rv-e1" class="rv-input" value="${esc(c.ref)}"><label class="rv-label">Texte à apprendre</label><textarea id="rv-e2" rows="4">${esc(c.text)}</textarea>`;
    return `<div class="rv-edit">${fields}<div class="rv-row"><button class="btn btn-primary btn-sm" data-action="rv-save-edit">Enregistrer</button><button class="btn btn-sm" data-action="rv-cancel-edit">Annuler</button></div></div>`;
  }

  function saveEdit() {
    const c = current();
    const v1 = $("#rv-e1")?.value.trim() || "";
    const v2 = $("#rv-e2")?.value.trim() || "";
    let fields;
    if (c.type === "qa") fields = { q: v1, a: v2 };
    else if (c.type === "cloze") {
      if ((v1.match(CLOZE) || []).length !== 1) return toast("Mets exactement un passage entre {{ et }}.");
      fields = { text: v1 };
    } else fields = { ref: v1, text: v2 };
    if (Object.values(fields).some((v) => !v)) return toast("Un champ est vide.");
    R.state.edits[c.id] = { t: Date.now(), fields };
    save();
    R.session.queue[R.session.i] = { ...c, ...fields, edited: true };
    R.session.editing = false;
    build();
    paint();
    toast("Carte modifiée.");
  }

  function deleteCard() {
    const c = current();
    if (!confirm("Supprimer cette carte ? Elle ne reviendra plus.")) return;
    R.state.edits[c.id] = { t: Date.now(), deleted: true };
    save();
    R.session.queue.splice(R.session.i, 1);
    R.session.revealed = false;
    build();
    paint();
    toast("Carte supprimée.");
  }

  // ---------- Connexions ----------
  function pickPair() {
    const notes = S.notes.filter((n) => n.topics.length && (n.text || "").trim().length > 40);
    if (notes.length < 2) return null;
    const a = pick(notes);
    const areas = new Set(a.topics.flatMap((t) => t.areaIds));
    const others = notes.filter((n) => n !== a && !n.topicIds.some((t) => a.topicIds.includes(t)));
    const far = others.filter((n) => !n.topics.some((t) => t.areaIds.some((x) => areas.has(x))));
    return [a, pick(far.length ? far : others.length ? others : notes.filter((n) => n !== a))];
  }

  function connectionsHtml() {
    const head = `<div class="page-head"><div><h1 class="page-title">Connexions</h1><p class="page-sub">Le stade « Connecter » de Forte : deux idées éloignées, et le lien que toi seul peux voir.</p></div><div class="page-actions">${back}</div></div>`;
    if (!R.pair) return head + `<div class="empty"><b>Pas assez de notes</b>Il faut au moins deux notes rangées dans des Topics.</div>`;
    const side = (n) => `<article class="card rv-card rv-side" style="--a:${n.topics[0]?.color || "var(--accent)"}">
      <div class="rv-kicker">${n.topics.slice(0, 2).map((t) => `<span class="topic-tag" style="--a:${t.color}">${esc(t.name)}</span>`).join("")}<span class="spacer"></span>
      <button class="icon-btn" data-action="rv-open-note" data-note-id="${n.id}" title="Lire la note">${icon("notes")}</button></div>
      <h3>${esc(n.title)}</h3><p class="rv-excerpt">${esc(clip((n.essentials.map((e) => e.t).join(" ") || n.text).replace(/\s+/g, " "), 320))}</p></article>`;
    return `${head}<div class="rv-pair">${side(R.pair[0])}<div class="rv-link">${icon("plus")}</div>${side(R.pair[1])}</div>
      <div class="card rv-card rv-connect">
        <label class="rv-label">Quel lien vois-tu entre ces deux idées ?</label>
        <textarea id="rv-conn-text" rows="4" placeholder="Une question, un principe commun, une application…"></textarea>
        <input id="rv-conn-title" class="rv-input" placeholder="Titre de la nouvelle note (facultatif)">
        <div class="rv-row"><button class="btn" data-action="rv-pair">${icon("shuffle")}<span>Autre paire</span></button>
        <span class="spacer"></span>
        <button class="btn" data-action="rv-copy-conn">${icon("copy")}<span>Copier</span></button>
        <button class="btn btn-primary" data-action="rv-send-conn">Créer la note dans Notion</button></div>
      </div>`;
  }

  function connectionText() {
    const [a, b] = R.pair;
    const text = ($("#rv-conn-text")?.value || "").trim();
    const title = ($("#rv-conn-title")?.value || "").trim() || `${clip(a.title, 40)} × ${clip(b.title, 40)}`;
    return { text, title, a, b };
  }

  async function sendConnection() {
    const { text, title, a, b } = connectionText();
    if (!text) return toast("Écris d'abord le lien que tu vois.");
    if (await send({ type: "connection", noteA: a.id, noteB: b.id, title, text })) {
      R.pair = pickPair();
      paint();
    }
  }

  // ---------- Audio mains libres ----------
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const audioState = { token: 0, playing: false, resolve: null, recognizer: null };

  function audioHtml() {
    const s = R.session;
    const c = current();
    const head = `<div class="page-head"><div><h1 class="page-title">Audio mains libres</h1><p class="page-sub">La question, un silence de ${settings().pause} s, puis la réponse. Tu notes à la voix ou d'un geste.</p></div><div class="page-actions">${back}</div></div>`;
    if (!("speechSynthesis" in window)) return head + `<div class="empty"><b>Pas de synthèse vocale</b>Ce navigateur ne sait pas lire à voix haute.</div>`;
    if (!s.queue.length) return head + `<div class="empty"><b>Rien à écouter pour l'instant ✓</b>Reviens demain.</div>`;
    if (!c) return head + `<div class="rv-done card"><div class="rv-done-emoji">🎧</div><h2>Écoute terminée</h2><p>${plural(s.ok, "carte sue", "cartes sues")} · ${plural(s.ko, "à revoir", "à revoir")}</p><a class="btn" href="#/revision">Retour</a></div>`;
    const voice = Recognition
      ? `<label class="rv-check"><input type="checkbox" data-rv="voice" ${settings().voice ? "checked" : ""}> Commandes vocales (« bien », « raté », « facile », « répète »)</label>`
      : `<p class="muted">Les commandes vocales ne sont pas disponibles sur ce navigateur : note avec les boutons.</p>`;
    return `${head}<div class="rv-top"><span class="muted">${s.i + 1} / ${s.queue.length}</span><div class="rv-bar"><i style="width:${(s.i / s.queue.length) * 100}%"></i></div></div>
      ${cardHtml(c)}
      <div class="rv-actions">
        ${audioState.playing
          ? `<button class="btn rv-big" data-action="rv-audio-stop">⏸ Pause</button><button class="btn rv-big" data-action="rv-audio-repeat">↺ Répéter</button>`
          : `<button class="btn btn-primary rv-big" data-action="rv-audio-start" data-autofocus>▶ ${s.i ? "Reprendre" : "Commencer l'écoute"}</button>`}
      </div>
      ${s.revealed ? gradeButtons(c) : ""}
      ${voice}`;
  }

  function looksEnglish(text) {
    const words = text.toLowerCase().match(/[a-z']+/g) || [];
    const en = words.filter((w) => ["the", "and", "of", "to", "is", "that", "you", "god", "will", "be", "in", "your"].includes(w)).length;
    const fr = words.filter((w) => ["le", "la", "les", "et", "de", "des", "que", "est", "un", "une", "dieu", "pour"].includes(w)).length;
    return en > fr;
  }

  function speak(text) {
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = looksEnglish(text) ? "en-US" : "fr-FR";
      const voice = speechSynthesis.getVoices().find((v) => v.lang.replace("_", "-").startsWith(utterance.lang.slice(0, 2)));
      if (voice) utterance.voice = voice;
      utterance.onend = utterance.onerror = () => resolve();
      speechSynthesis.speak(utterance);
    });
  }

  function spoken(c) {
    if (c.type === "recall") return [`${c.note.title}. Qu'est-ce que tu te rappelles ?`, clip((c.note.text || "").replace(/\s+/g, " "), 700)];
    if (c.type === "qa") return [c.q, c.a];
    if (c.type === "cloze") return [c.text.replace(CLOZE, " blanc "), c.text.replace(CLOZE, "$1")];
    if (c.type === "memorize") return [`Récite : ${c.ref}`, c.text];
    return [c.hl.text, `Tiré de ${c.book.title || "Readwise"}${c.book.author ? ", de " + c.book.author : ""}.`];
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function listenForGrade() {
    return new Promise((resolve) => {
      audioState.resolve = resolve;
      if (!Recognition || !settings().voice) return;
      const rec = new Recognition();
      rec.lang = "fr-FR";
      rec.interimResults = false;
      rec.onresult = (e) => {
        const said = e.results[0][0].transcript.toLowerCase();
        if (/rat[ée]|encore|non|pas su/.test(said)) resolve(0);
        else if (/facile/.test(said)) resolve(2);
        else if (/r[ée]p[èe]te|encore une fois/.test(said)) resolve("repeat");
        else if (/bien|oui|ok|su|suivant/.test(said)) resolve(1);
      };
      rec.onend = () => {
        if (audioState.resolve === resolve && audioState.playing) setTimeout(() => audioState.resolve === resolve && rec.start(), 300);
      };
      audioState.recognizer = rec;
      try {
        rec.start();
      } catch {}
    });
  }

  async function runAudio() {
    const token = ++audioState.token;
    audioState.playing = true;
    const alive = () => token === audioState.token && audioState.playing;
    while (alive() && current()) {
      const c = current();
      const [front, answer] = spoken(c);
      R.session.revealed = false;
      paint();
      await speak(front);
      if (!alive()) return;
      await wait(settings().pause * 1000);
      if (!alive()) return;
      R.session.revealed = true;
      paint();
      await speak(answer);
      if (!alive()) return;
      const g = await listenForGrade();
      stopRecognizer();
      if (!alive()) return;
      if (g === "repeat") continue;
      applyGrade(g);
    }
    audioState.playing = false;
    if (R.route[0] === "audio") paint();
  }

  function stopRecognizer() {
    audioState.resolve = null;
    try {
      audioState.recognizer?.abort();
    } catch {}
    audioState.recognizer = null;
  }

  function stopAudio() {
    audioState.token++;
    audioState.playing = false;
    stopRecognizer();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }

  // ---------- Notation ----------
  function applyGrade(g) {
    const s = R.session;
    const c = current();
    grade(c, g);
    if (g === 0) {
      s.ko++;
      const seen = s.again.get(c.id) || 0;
      if (seen < 2) {
        s.again.set(c.id, seen + 1);
        s.queue.push(c);
      }
    } else s.ok++;
    s.i++;
    s.revealed = false;
    s.summary = false;
  }

  // ---------- Actions ----------
  function action(el) {
    const a = el.dataset.action;
    const s = R.session;
    if (a === "rv-type") {
      const types = new Set(settings().types);
      types.has(el.dataset.type) ? types.delete(el.dataset.type) : types.add(el.dataset.type);
      setSetting("types", Object.keys(TYPES).filter((t) => types.has(t)));
      paint();
    } else if (a === "rv-readwise") {
      setSetting("readwise", !settings().readwise);
      paint();
    } else if (a === "rv-reveal" && s) {
      s.revealed = true;
      paint();
    } else if (a === "rv-grade" && s && current()) {
      if (R.route[0] === "audio" && audioState.resolve) {
        audioState.resolve(Number(el.dataset.g));
        return;
      }
      applyGrade(Number(el.dataset.g));
      paint();
    } else if (a === "rv-open") {
      const c = current();
      if (c?.note) openNote(c.note.id);
    } else if (a === "rv-open-note") openNote(el.dataset.noteId);
    else if (a === "rv-edit" && s) {
      s.editing = true;
      paint();
    } else if (a === "rv-cancel-edit" && s) {
      s.editing = false;
      paint();
    } else if (a === "rv-save-edit") saveEdit();
    else if (a === "rv-delete") deleteCard();
    else if (a === "rv-summarize" && s) {
      s.summary = true;
      paint();
      $("#rv-summary")?.focus();
    } else if (a === "rv-cancel-summary" && s) {
      s.summary = false;
      paint();
    } else if (a === "rv-send-summary") sendSummary(el.dataset.noteId);
    else if (a === "rv-skip-note") {
      R.distill.i++;
      paint();
    } else if (a === "rv-pair") {
      R.pair = pickPair();
      paint();
    } else if (a === "rv-copy-conn") {
      const { text, title, a: x, b: y } = connectionText();
      ctx.copyText(`# ${title}\n\n${text}\n\nNotes reliées : ${x.title} · ${y.title}`).then((ok) => toast(ok ? "Copié !" : "Impossible de copier."));
    } else if (a === "rv-send-conn") sendConnection();
    else if (a === "rv-audio-start") {
      runAudio();
      paint();
    } else if (a === "rv-audio-stop") {
      stopAudio();
      paint();
    } else if (a === "rv-audio-repeat" && audioState.resolve) audioState.resolve("repeat");
    else if (a === "rv-sync") {
      R.remote.status = "local";
      refreshSyncLine();
      syncNow();
    }
  }

  function setSetting(key, value) {
    R.state.settings = { ...settings(), [key]: value, t: Date.now() };
    save();
  }

  function change(el) {
    const key = el.dataset.rv;
    if (key === "voice") setSetting("voice", el.checked);
    else setSetting(key, Number(el.value));
    if (key !== "voice" && !R.route.length) paint();
  }

  function keydown(e) {
    const s = R.session;
    if (!s || R.route[0] === "audio" || s.editing || s.summary) return false;
    if (e.key === "Escape") {
      location.hash = "#/revision";
      return true;
    }
    if (!current()) return false;
    if (!s.revealed && (e.key === " " || e.key === "Enter")) {
      e.preventDefault();
      s.revealed = true;
      paint();
      return true;
    }
    if (s.revealed && ["1", "2", "3"].includes(e.key)) {
      applyGrade(Number(e.key) - 1);
      paint();
      return true;
    }
    if (s.revealed && e.key === " ") {
      e.preventDefault();
      applyGrade(1);
      paint();
      return true;
    }
    return false;
  }

  return { load, view, mount, action, change, keydown, dueCount, stop: stopAudio };
}
