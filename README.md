# VetPulse — Exemple d'intégration ReqVet

VetPulse est un exemple d'intégration complet du SDK ReqVet dans un logiciel de gestion vétérinaire.
Il couvre l'ensemble du flux : enregistrement audio → génération du compte-rendu → affichage → reformulation → amendement.

Utilisez-le comme référence pour intégrer ReqVet dans votre propre application.

## Stack

- **Framework** : Next.js 15 (App Router, TypeScript strict)
- **Base de données** : Turso (LibSQL) — stockage des consultations, jobs et events webhook
- **SDK** : `@reqvet-sdk/sdk`

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  NAVIGATEUR (client)                                        │
│                                                             │
│  ConsultationView.tsx                                       │
│  ├─ Enregistrement audio (MediaRecorder API, Opus 32kbps)   │
│  ├─ Upload fichier audio                                    │
│  ├─ Sélection template                                      │
│  ├─ Champs éditables (Motif, Compte-rendu, Conclusion)      │
│  └─ Polling statut job                                      │
│                                                             │
│  POST /api/reqvet/generate                                  │
│  POST /api/reqvet/reformulate                               │
│  POST /api/reqvet/amend                                     │
│  GET  /api/reqvet/job?jobId=...                             │
│  GET  /api/reqvet/templates                                 │
│  PATCH /api/consultations/:id                               │
└─────────────┬───────────────────────────────────────────────┘
              │  (la clé API ne quitte JAMAIS le serveur)
              ▼
┌─────────────────────────────────────────────────────────────┐
│  SERVEUR Next.js (API Routes = proxy)                       │
│                                                             │
│  lib/reqvet.ts          → singleton ReqVet SDK              │
│  lib/db.ts              → client Turso (LibSQL)             │
│                                                             │
│  /api/reqvet/generate   → getSignedUploadUrl + createJob    │
│  /api/reqvet/webhook    → reçoit les events ReqVet          │
│  /api/reqvet/job        → statut depuis Turso               │
│  /api/reqvet/templates  → listTemplates                     │
│  /api/reqvet/reformulate→ reformulateReport                 │
│  /api/reqvet/amend      → getSignedUploadUrl + amendJob     │
│  /api/consultations/:id → PATCH motif/compte_rendu/conclusion│
└──────┬──────────────────────────┬───────────────────────────┘
       │                          │
       ▼                          ▼
┌──────────────┐    ┌────────────────────────────────────────┐
│  Turso DB    │    │  API ReqVet (api.reqvet.com)           │
│  (LibSQL)    │    │                                        │
│  consultations│   │  POST /api/v1/storage/signed-upload    │
│  jobs        │    │  POST /api/v1/jobs                     │
│  reformulat° │    │  GET  /api/v1/jobs/:id                 │
│  webhook_evts│    │  POST /api/v1/jobs/:id/reformulate     │
│              │    │  POST /api/v1/jobs/:id/amend           │
│              │    │  GET  /api/v1/templates                │
└──────────────┘    │                                        │
                    │  ──── webhook callback ────►           │
                    │  POST votre-app/api/reqvet/webhook      │
                    └────────────────────────────────────────┘
```

## Flux complet

1. **Frontend** : enregistre ou importe un audio → POST `/api/reqvet/generate`
2. **Proxy** : `reqvet.getSignedUploadUrl()` → PUT direct Supabase → `reqvet.createJob({ callbackUrl })`
3. **ReqVet** : traite en arrière-plan (transcription → génération)
4. **ReqVet** : POST le résultat sur `/api/reqvet/webhook` (signé HMAC)
5. **Webhook handler** : vérifie la signature, déduplique, sauvegarde en Turso
6. **Frontend** : poll `/api/reqvet/job` → récupère le HTML/fields/transcription et remplit les champs

## Fonctionnalités intégrées

| Fonctionnalité | Route proxy | Méthode SDK |
|---|---|---|
| Upload audio + génération | `/api/reqvet/generate` | `getSignedUploadUrl()` + `createJob()` |
| Réception webhook | `/api/reqvet/webhook` | `verifyWebhookSignature()` |
| Suivi de statut | `/api/reqvet/job` | `getJob()` |
| Templates | `/api/reqvet/templates` | `listTemplates()` |
| Reformulations | `/api/reqvet/reformulate` | `reformulateReport()` |
| Amendement audio | `/api/reqvet/amend` | `getSignedUploadUrl()` + `amendJob()` |
| Sauvegarde champs | `/api/consultations/:id` | — (Turso) |

## Setup

### Prérequis

- Node.js >= 18
- Compte [Turso](https://turso.tech) (gratuit)
- Clé API ReqVet (fournie par l'équipe ReqVet)
- Un tunnel public pour les webhooks en dev (ngrok, Cloudflare Tunnel...)

### 1. Installer les dépendances

```bash
npm install
```

### 2. Configurer les variables d'environnement

```bash
cp .env.local.example .env.local
# Éditez .env.local avec vos valeurs
```

Variables requises :

```env
REQVET_API_KEY=           # Clé API ReqVet
REQVET_WEBHOOK_SECRET=    # Secret HMAC pour vérifier les webhooks
NEXT_PUBLIC_APP_URL=      # URL publique de l'app (ex: https://xxxx.ngrok-free.app)
TURSO_DATABASE_URL=       # libsql://votre-base.turso.io
TURSO_AUTH_TOKEN=         # Token Turso
```

### 3. Créer et initialiser la base Turso

```bash
# Installer Turso CLI
curl -sSfL https://get.tur.so/install.sh | bash

# Créer la base
turso db create vetpulse
turso db show vetpulse --url       # → TURSO_DATABASE_URL
turso db tokens create vetpulse    # → TURSO_AUTH_TOKEN

# Créer les tables et insérer les données de démo
npm run db:setup
```

### 4. Exposer le webhook en dev

```bash
# Avec ngrok :
ngrok http 3000
# → Copiez l'URL https://xxxx.ngrok-free.app dans NEXT_PUBLIC_APP_URL
```

### 5. Lancer le serveur

```bash
npm run dev
```

Ouvrez http://localhost:3000, sélectionnez une consultation et enregistrez un audio.

## Point clé : upload audio sans limite de taille

`uploadAudio()` du SDK poste vers `/api/v1/upload` (Vercel Serverless Function, limitée à ~4.5 MB).
Pour des fichiers audio de consultation réels (5–30 MB), cela retourne `413 FUNCTION_PAYLOAD_TOO_LARGE`.

**Ce projet utilise `getSignedUploadUrl()`** pour contourner cette limite :

```
1. reqvet.getSignedUploadUrl(fileName, contentType)
   → { uploadUrl, path }              ← requête JSON légère, aucun fichier

2. PUT uploadUrl  ← audio directement vers Supabase
   → bypass Vercel, aucune limite de taille

3. reqvet.createJob({ audioFile: path, ... })
```

Voir l'implémentation dans `app/api/reqvet/generate/route.ts` et `app/api/reqvet/amend/route.ts`.

## Sécurité

- Clé API jamais exposée côté client (pattern proxy)
- Signature HMAC vérifiée sur chaque webhook entrant
- Anti-replay (fenêtre de 5 min)
- Idempotence : dédoublonnage des webhook events sur `(job_id, event)`
- Variables d'environnement uniquement (`.env.local`, jamais commitées)
