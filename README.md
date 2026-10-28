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

## Mettre à jour tout de suite

La synchro tourne toutes les heures. Pour la lancer à la main : onglet **Actions** du dépôt → **Synchroniser le dashboard** → **Run workflow**. Le lien « Mettre à jour » en bas du menu y mène directement.

## Secrets GitHub

Ils se règlent dans **Settings → Secrets and variables → Actions** :

| Secret | Rôle |
|---|---|
| `NOTION_TOKEN` | Jeton de l'intégration Notion (la même que l'appli Capture PARA, ou une intégration en lecture seule). |
| `READWISE_TOKEN` | Jeton Readwise (readwise.io/access_token). Facultatif. |
| `DASHBOARD_PASSWORD` | Ton mot de passe pour ouvrir le dashboard (8 caractères minimum, une phrase longue est plus sûre). |

Pour changer de mot de passe, modifie `DASHBOARD_PASSWORD` puis relance la synchro. Chaque appareil te le redemandera.

## Tester en local

```bash
uv run sync/sync.py --env-file ../PriseDeNotes/.env --env-file .env.local
python -m http.server 8765 --directory site
```

`.env.local` contient `DASHBOARD_PASSWORD=…`. Ce fichier et `site/data.bin` ne sont jamais envoyés sur GitHub (voir `.gitignore`).

## Fichiers

- `sync/sync.py` : lecture de Notion et de Readwise, conversion des notes en HTML, chiffrement.
- `sync/config.json` : identifiants des bases Notion et sel du chiffrement (ni l'un ni l'autre n'est secret).
- `site/` : l'interface (HTML, CSS et JavaScript sans dépendance).
- `.github/workflows/sync.yml` : synchro horaire et publication sur GitHub Pages.
