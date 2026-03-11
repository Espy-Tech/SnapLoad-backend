# SnapLoad — Guide de mise en production

## Vue d'ensemble

```
snapload/
├── backend/
│   ├── server.js          ← Serveur Express (Node.js)
│   ├── package.json
│   └── .env.example       ← Copier en .env et remplir
└── frontend/
    └── index.html         ← Page web (1 seul fichier)
```

---

## ÉTAPE 1 — Choisir votre méthode de téléchargement

Vous avez **2 options** :

| | yt-dlp (recommandé) | RapidAPI |
|---|---|---|
| **Coût** | Gratuit | Gratuit (limité) ou payant |
| **Hébergement** | Serveur requis (VPS, Railway…) | Serverless possible |
| **Fiabilité** | Excellente | Dépend du fournisseur |
| **Mise à jour** | `pip install -U yt-dlp` | Automatique |

---

## ÉTAPE 2A — Méthode yt-dlp (locale, recommandée)

### 2A.1 Installer les prérequis

```bash
# Node.js (v18+) — https://nodejs.org
node --version

# Python + yt-dlp
pip install yt-dlp

# Vérifier l'installation
yt-dlp --version
```

### 2A.2 Installer et lancer le backend

```bash
cd backend
cp .env.example .env          # Créer le fichier de config
npm install                   # Installer les dépendances
npm start                     # Lancer le serveur
```

Votre backend tourne sur `http://localhost:3001`

### 2A.3 Configurer le frontend

Ouvrez `frontend/index.html` et trouvez la ligne :

```javascript
const API_URL = ''; // ← METTEZ L'URL DE VOTRE BACKEND ICI
```

Remplacez par :

```javascript
const API_URL = 'http://localhost:3001'; // en local
// ou
const API_URL = 'https://votre-backend.railway.app'; // en prod
```

---

## ÉTAPE 2B — Méthode RapidAPI (cloud)

### 2B.1 Obtenir une clé RapidAPI

1. Allez sur [rapidapi.com](https://rapidapi.com)
2. Créez un compte gratuit
3. Cherchez **"Social Media Video Downloader"**
   - URL : `https://rapidapi.com/search/social+media+video+downloader`
4. Cliquez sur **"Subscribe to Test"** (plan gratuit disponible)
5. Copiez votre clé `X-RapidAPI-Key`

### 2B.2 Configurer le backend

Éditez `backend/.env` :

```env
DOWNLOAD_METHOD=rapidapi
RAPIDAPI_KEY=votre_clé_copiée_ici
```

### 2B.3 Lancer le backend

```bash
cd backend
npm install
npm start
```

---

## ÉTAPE 3 — Hébergement en production

### Option A : Railway (le plus simple, gratuit)

1. Créez un compte sur [railway.app](https://railway.app)
2. Cliquez sur **"New Project"** → **"Deploy from GitHub"**
3. Connectez votre repo GitHub (uploadez le dossier `backend/`)
4. Dans les variables d'environnement Railway, ajoutez :
   ```
   DOWNLOAD_METHOD = ytdlp
   PORT = 3001
   FRONTEND_URL = https://votre-site.netlify.app
   ```
5. Pour yt-dlp sur Railway, ajoutez dans `package.json` :
   ```json
   "scripts": {
     "build": "pip install yt-dlp",
     "start": "node server.js"
   }
   ```
6. Railway vous donne une URL comme `https://snapload-backend.up.railway.app`

### Option B : VPS (DigitalOcean, OVH, etc.)

```bash
# Sur votre serveur
git clone votre-repo
cd backend
npm install
pip install yt-dlp

# Lancer en arrière-plan avec PM2
npm install -g pm2
pm2 start server.js --name snapload
pm2 startup    # Démarrage automatique au reboot
pm2 save
```

### Option C : Render.com (gratuit)

1. [render.com](https://render.com) → New → Web Service
2. Connectez votre GitHub
3. Build Command : `npm install && pip install yt-dlp`
4. Start Command : `node server.js`
5. Ajoutez vos variables d'environnement

---

## ÉTAPE 4 — Héberger le frontend

Le frontend est **un seul fichier HTML** — très facile à déployer.

### Netlify (le plus simple)

1. Allez sur [netlify.com](https://netlify.com)
2. Glissez-déposez le fichier `frontend/index.html` dans l'interface
3. C'est en ligne instantanément ! ✓

### Vercel

```bash
npm install -g vercel
cd frontend
vercel
```

### GitHub Pages (gratuit)

1. Créez un repo GitHub
2. Uploadez `index.html`
3. Settings → Pages → Deploy from branch `main`
4. Votre site est sur `https://votrecompte.github.io/snapload`

---

## ÉTAPE 5 — Connecter frontend ↔ backend

Une fois votre backend déployé, copiez son URL et mettez-la dans `frontend/index.html` :

```javascript
// Avant (mode démo) :
const API_URL = '';

// Après (production) :
const API_URL = 'https://snapload-backend.up.railway.app';
```

Puis re-déployez votre frontend.

---

## Mise à jour de yt-dlp

Les plateformes changent souvent. Mettez à jour régulièrement :

```bash
pip install -U yt-dlp
# ou sur le serveur :
pm2 restart snapload
```

---

## Résolution de problèmes courants

| Problème | Solution |
|---|---|
| `yt-dlp not found` | `pip install yt-dlp` ou `pip3 install yt-dlp` |
| Erreur CORS | Vérifiez `FRONTEND_URL` dans `.env` |
| Vidéo privée | Normal — les vidéos privées ne sont pas téléchargeables |
| Rate limit RapidAPI | Passez au plan payant ou utilisez yt-dlp |
| Timeout | Augmentez le timeout dans `server.js` (ligne `timeout: 120000`) |

---

## Sécurité

- Ne committez **jamais** votre fichier `.env` sur GitHub
- Ajoutez `.env` dans votre `.gitignore`
- Le rate limiting est déjà configuré (20 req / 10 min par IP)
- Seules les URLs des plateformes connues sont acceptées

---

## Architecture complète

```
Utilisateur
    │
    │ colle un lien
    ▼
[Frontend HTML]  ──── /api/info?url=... ────►  [Backend Express]
(Netlify/Vercel)                                (Railway/VPS)
                                                      │
                 ◄─── {title, qualities} ────         │ yt-dlp ou RapidAPI
                                                      │
[Utilisateur clique]                                  ▼
    │                                          [Vidéo récupérée]
    │ /api/download (POST)                            │
    ▼                                                 │
[Fichier téléchargé] ◄─── stream ──────────────────────
```
