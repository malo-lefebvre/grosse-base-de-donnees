# Second cerveau

Le dashboard de Malo : ses notes Notion (rangées selon PARA) et ses surlignages Readwise, consultables depuis n'importe quel appareil.

## Comment ça marche

1. Toutes les heures, GitHub Actions lance `sync/sync.py`. Le script lit Notion (Areas, Topics, Notes, Projects) et Readwise.
2. Le script chiffre le tout avec ton mot de passe (AES-256-GCM, clé dérivée par PBKDF2 avec 600 000 itérations) et produit un seul fichier, `site/data.bin`.
3. GitHub Pages publie le dossier `site/`. Le navigateur télécharge `data.bin` et le déchiffre avec ton mot de passe.

Ni le code ni le site ne contiennent tes notes en clair. Sans le mot de passe, `data.bin` est illisible. Le dépôt peut donc rester public, ce qu'exige GitHub Pages gratuit.

## Utilisation

- **Ctrl K** (ou **/**) ouvre la recherche dans tes notes et tes lectures. Un mot français cherche aussi ses équivalents anglais (délivrance → deliverance, royaume → kingdom…).
- **← / →** passent à la note précédente ou suivante dans le lecteur, **Échap** le ferme.
- **Ma sélection** : ajoute des notes et des passages avec le bouton **+**, puis copie-les en Markdown pour écrire, préparer une prédication ou un épisode.
- Sur téléphone, « Ajouter à l'écran d'accueil » installe le dashboard comme une appli, consultable même hors ligne.
- Le cadenas en bas du menu fait oublier le mot de passe à l'appareil.

## Révision

Le menu **Révision** te fait revoir tes notes façon Anki, avec 5 boîtes de Leitner : une carte sue monte d'une boîte et revient plus tard (demain, puis 3, 7, 14 et 30 jours), une carte ratée retourne en boîte 1. Les nouvelles notes entrent toutes seules dans la pile.

- **Types de cartes**, à cocher seuls ou mélangés : *Titre → idée*, *Questions* et *Texte à trous* (préparées par Claude à chaque synchro, seulement pour les notes nouvelles ou modifiées), *Par cœur* (versets et déclarations, avec de plus en plus de mots cachés à mesure que tu progresses), et les *Surlignages Readwise*, que tu peux retirer d'un clic.
- **Modes** : *Session du jour*, *Par Topic*, *Connexions* (deux notes éloignées : le lien que tu vois devient une nouvelle note), *Audio mains libres* (lecture à voix haute, commandes vocales si le navigateur les connaît) et *Résumer* (le résumé en tête de note).
- Clavier : **Espace** retourne la carte, puis **1** Raté, **2** Bien, **3** Facile.
- Chaque carte de l'IA peut être corrigée ou supprimée (crayon et corbeille).

**Progression et envois vers Notion.** Sans réglage, la progression reste dans le navigateur de l'appareil. Avec le secret `DASHBOARD_WRITE_TOKEN`, la page enregistre ta progression, chiffrée avec ton mot de passe, dans `etat.bin` sur la branche `progression` : elle est alors la même sur tous tes appareils. Les résumés et les notes de connexion partent dans `envois.bin` sur la même branche, et l'action **Appliquer les envois de révision** (`sync/apply.py`) les écrit dans Notion en une à deux minutes.

Ce workflow est lu sur la branche `progression` (c'est elle qui reçoit les envois) : s'il change, mets aussi à jour `.github/workflows/appliquer.yml` sur cette branche.

## Mettre à jour tout de suite

La synchro tourne toutes les heures. Pour la lancer à la main : onglet **Actions** du dépôt → **Synchroniser le dashboard** → **Run workflow**. Le lien « Mettre à jour » en bas du menu y mène directement.

## Secrets GitHub

Ils se règlent dans **Settings → Secrets and variables → Actions** :

| Secret | Rôle |
|---|---|
| `NOTION_TOKEN` | Jeton de l'intégration Notion (la même que l'appli Capture PARA, ou une intégration en lecture seule). |
| `READWISE_TOKEN` | Jeton Readwise (readwise.io/access_token). Facultatif. |
| `DASHBOARD_PASSWORD` | Ton mot de passe pour ouvrir le dashboard (8 caractères minimum, une phrase longue est plus sûre). |
| `ANTHROPIC_API_KEY` | Clé Claude, pour préparer les cartes de révision. Facultatif. |
| `DASHBOARD_WRITE_TOKEN` | Jeton GitHub à grain fin, limité à ce dépôt avec la seule permission *Contents : Read and write*. Il est placé dans `data.bin` (donc lisible seulement avec ton mot de passe) et permet à la page Révision d'écrire sur la branche `progression`. Facultatif. |

Pour changer de mot de passe, modifie `DASHBOARD_PASSWORD` puis relance la synchro. Chaque appareil te le redemandera.

## Tester en local

```bash
uv run sync/sync.py --env-file ../PriseDeNotes/.env --env-file .env.local
python -m http.server 8765 --directory site
```

`.env.local` contient `DASHBOARD_PASSWORD=…`. Ce fichier et `site/data.bin` ne sont jamais envoyés sur GitHub (voir `.gitignore`).

## Fichiers

- `sync/sync.py` : lecture de Notion et de Readwise, conversion des notes en HTML, chiffrement.
- `sync/review.py` : cartes de révision préparées par Claude (reprises de la version publiée quand la note n'a pas changé).
- `sync/apply.py` : applique dans Notion les envois de la page Révision.
- `sync/vault.py` : chiffrement commun à la synchro, aux envois et au navigateur.
- `sync/config.json` : identifiants des bases Notion et sel du chiffrement (ni l'un ni l'autre n'est secret).
- `site/` : l'interface (HTML, CSS et JavaScript sans dépendance). `site/revision.js` : la révision.
- `.github/workflows/sync.yml` : synchro horaire et publication sur GitHub Pages.
- `.github/workflows/appliquer.yml` : envois de révision vers Notion (aussi présent sur la branche `progression`).

Les journaux des actions GitHub sont publics sur un dépôt public : les scripts n'y écrivent jamais le titre ni le contenu d'une note.
