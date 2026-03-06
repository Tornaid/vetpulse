# VetPulse — Intégration ReqVet multi-cliniques

VetPulse est une intégration complète du SDK ReqVet dans un logiciel de gestion vétérinaire.
Il couvre l'ensemble du flux métier — enregistrement audio → génération du compte-rendu → reformulation → amendement — et inclut un **dashboard reseller** permettant à un partenaire (ex. DrVeto) de piloter plusieurs cliniques clientes depuis une interface unique.

## Stack

- **Framework** : Next.js 15 (App Router, TypeScript strict)
- **Base de données** : Turso (LibSQL)
- **SDK** : `@reqvet-sdk/sdk` v2.2.3+

---

## Modèle de déploiement : reseller + cliniques

VetPulse supporte deux modes de fonctionnement distincts selon les variables d'environnement présentes.

```
DrVeto (reseller)
  └── Vetpulse Admin  [REQVET_RESELLER_API_KEY]
        ├── Clinique du Parc       → Vetpulse Clinique A  [REQVET_API_KEY=rqv_live_clinic_AAA]
        ├── Cabinet Laval Animaux  → Vetpulse Clinique B  [REQVET_API_KEY=rqv_live_clinic_BBB]
        └── Clinique Saint-Exupéry → Vetpulse Clinique C  [REQVET_API_KEY=rqv_live_clinic_CCC]
```

| Mode | Variable présente | Accès |
|------|-------------------|-------|
| **Admin reseller** | `REQVET_RESELLER_API_KEY` | `/admin` — créer/gérer les cliniques |
| **Clinique** | `REQVET_API_KEY` | `/consultation` — flux vétérinaire complet |

Chaque clinique a son propre déploiement Vetpulse (ou instance séparée) avec sa propre clé API.
La clé clinique n'est jamais stockée en base — elle est remise une seule fois via le dashboard admin.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  NAVIGATEUR                                                      │
│                                                                  │
│  /consultation — ConsultationView.tsx                            │
│  ├─ Enregistrement audio (MediaRecorder, Opus 32kbps)            │
│  ├─ Sélection template, champs éditables                         │
│  └─ Polling statut job                                           │
│                                                                  │
│  /admin — ClinicDashboard.tsx                                    │
│  ├─ Liste des cliniques (statut, usage, quota)                   │
│  ├─ Création clinique → affichage credentials (une seule fois)   │
│  └─ Gestion quota / notes / désactivation par clinique           │
└──────────────────┬───────────────────────────────────────────────┘
                   │  (clés API jamais exposées au client)
                   ▼
┌──────────────────────────────────────────────────────────────────┐
│  SERVEUR Next.js — Routes API proxy                              │
│                                                                  │
│  lib/reqvet.ts        → client clinique (REQVET_API_KEY)         │
│  lib/reqvet-admin.ts  → client reseller (REQVET_RESELLER_API_KEY)│
│  lib/db.ts            → Turso (consultations, jobs, clinics...)  │
│                                                                  │
│  Flux clinique                                                   │
│  /api/reqvet/generate    getSignedUploadUrl + createJob          │
│  /api/reqvet/webhook     verifyWebhookSignature + updateJob      │
│  /api/reqvet/job         statut depuis Turso + fallback ReqVet   │
│  /api/reqvet/templates   listTemplates                           │
│  /api/reqvet/reformulate reformulateReport + sauvegarde Turso    │
│  /api/reqvet/amend       getSignedUploadUrl + amendJob           │
│  /api/consultations/:id  PATCH motif/compte_rendu/conclusion     │
│                                                                  │
│  Flux admin reseller                                             │
│  /api/admin/clinics      GET list + POST create (→ api_key x1)  │
│  /api/admin/clinics/:id  GET detail+usage / PATCH / DELETE       │
└──────┬────────────────────────────┬─────────────────────────────┘
       │                            │
       ▼                            ▼
┌──────────────┐    ┌───────────────────────────────────────────┐
│  Turso DB    │    │  API ReqVet (api.reqvet.com)              │
│              │    │                                           │
│  consultations    │  Endpoints clinique                       │
│  jobs        │    │  POST /api/v1/storage/signed-upload       │
│  reformulations   │  POST /api/v1/jobs                        │
│  webhook_events   │  GET  /api/v1/jobs/:id                    │
│  clinics ←new│    │  POST /api/v1/jobs/:id/reformulate        │
└──────────────┘    │  POST /api/v1/jobs/:id/amend              │
                    │  GET  /api/v1/templates                   │
                    │                                           │
                    │  Endpoints reseller                       │
                    │  GET  /api/v1/partner/orgs                │
                    │  POST /api/v1/partner/orgs                │
                    │  GET  /api/v1/partner/orgs/:id            │
                    │  PATCH /api/v1/partner/orgs/:id           │
                    │  DELETE /api/v1/partner/orgs/:id          │
                    │                                           │
                    │  ←── webhook callback ───                 │
                    │  POST votre-app/api/reqvet/webhook         │
                    └───────────────────────────────────────────┘
```

---

## Flux complet — génération d'un compte-rendu

1. **Frontend** enregistre l'audio → `POST /api/reqvet/generate`
2. **Proxy** : `reqvet.getSignedUploadUrl()` → `PUT` direct Supabase → `reqvet.createJob({ callbackUrl })`
3. **ReqVet** traite en arrière-plan (transcription → génération IA)
4. **ReqVet** poste le résultat sur `/api/reqvet/webhook` (signé HMAC)
5. **Webhook handler** : vérifie la signature, déduplique, sauvegarde HTML/transcription/fields en Turso
6. **Frontend** poll `/api/reqvet/job` → affiche le compte-rendu et remplit les champs éditables

---

## Fonctionnalités

### Flux clinique

| Fonctionnalité | Route | Méthode SDK |
|---|---|---|
| Upload audio + génération | `POST /api/reqvet/generate` | `getSignedUploadUrl()` + `createJob()` |
| Réception webhook | `POST /api/reqvet/webhook` | `verifyWebhookSignature()` |
| Suivi de statut | `GET /api/reqvet/job` | `getJob()` |
| Templates | `GET /api/reqvet/templates` | `listTemplates()` |
| Reformulations | `POST /api/reqvet/reformulate` | `reformulateReport()` |
| Amendement audio | `POST /api/reqvet/amend` | `getSignedUploadUrl()` + `amendJob()` |
| Sauvegarde champs | `PATCH /api/consultations/:id` | — (Turso) |

### Flux admin reseller

| Fonctionnalité | Route | Méthode SDK |
|---|---|---|
| Lister les cliniques + usage | `GET /api/admin/clinics` | `listOrganizations()` |
| Créer une clinique | `POST /api/admin/clinics` | `createOrganization()` |
| Détail + usage mensuel | `GET /api/admin/clinics/:id` | `getOrganization()` |
| Modifier quota / webhook | `PATCH /api/admin/clinics/:id` | `updateOrganization()` |
| Désactiver une clinique | `DELETE /api/admin/clinics/:id` | `deactivateOrganization()` |

---

## Mise en place

### Prérequis

- Node.js >= 18
- Compte [Turso](https://turso.tech) (gratuit)
- Clé API ReqVet fournie par l'équipe ReqVet lors de l'onboarding
- En dev : un tunnel public pour recevoir les webhooks (ngrok, Cloudflare Tunnel...)

---

### Partie 1 — Setup commun (admin et cliniques)

#### 1. Installer les dépendances

```bash
npm install
```

#### 2. Créer la base Turso

Installer le CLI Turso :

```bash
# Mac / Linux
curl -sSfL https://get.tur.so/install.sh | bash

# Windows (PowerShell)
winget install turso
```

Créer la base et récupérer les credentials :

```bash
turso db create vetpulse
turso db show vetpulse --url      # → TURSO_DATABASE_URL
turso db tokens create vetpulse   # → TURSO_AUTH_TOKEN
```

#### 3. Initialiser le schéma

```bash
npm run db:setup
```

Crée les tables : `consultations`, `jobs`, `reformulations`, `webhook_events`, `clinics`.
Idempotent — peut être relancé sans risque.

---

### Partie 2 — Vetpulse Admin (DrVeto)

C'est l'instance centrale depuis laquelle DrVeto crée et pilote toutes les cliniques.

#### `.env.local` (admin)

```env
# Cle reseller — fournie par ReqVet lors de l'onboarding partenaire
REQVET_RESELLER_API_KEY=rqv_live_reseller_...

REQVET_BASE_URL=https://api.reqvet.com

# Turso — base centrale DrVeto
TURSO_DATABASE_URL=libsql://vetpulse-drveto.turso.io
TURSO_AUTH_TOKEN=eyJ...

# URL publique (tunnel en dev, domaine en prod)
NEXT_PUBLIC_APP_URL=https://admin.drveto.fr
```

#### Lancer le serveur admin

```bash
npm run dev
# → http://localhost:3000/admin
```

#### Créer une clinique (workflow DrVeto)

1. Aller sur `/admin`
2. Cliquer **"Ajouter une clinique"**
3. Renseigner : nom, email de contact, quota mensuel, notes internes
4. Cliquer **"Créer la clinique"**
5. Une modal affiche la `REQVET_API_KEY` et le `REQVET_WEBHOOK_SECRET` de la clinique — **une seule fois**
6. Copier ces deux valeurs dans un gestionnaire de mots de passe (Bitwarden, 1Password...)
7. Transmettre les credentials à la clinique pour configurer son `.env.local`

> La clé n'est jamais re-affichable depuis l'interface. En cas de perte, utiliser la rotation de clé
> côté ReqVet (fonctionnalité à venir dans le dashboard partenaire ReqVet).

---

### Partie 3 — Vetpulse Clinique

Chaque clinique a sa propre instance Vetpulse (déploiement séparé ou branche distincte).
Les routes `/api/reqvet/*` et `/consultation` fonctionnent avec la clé clinique.

#### `.env.local` (clinique)

```env
# Cle API de la clinique — obtenue via le dashboard admin DrVeto
REQVET_API_KEY=rqv_live_clinic_...
REQVET_WEBHOOK_SECRET=whsec_...

REQVET_BASE_URL=https://api.reqvet.com

# Turso — base propre a cette clinique
TURSO_DATABASE_URL=libsql://vetpulse-clinique-du-parc.turso.io
TURSO_AUTH_TOKEN=eyJ...

# URL publique (tunnel en dev)
NEXT_PUBLIC_APP_URL=https://xxxx.ngrok-free.app
```

#### Exposer le webhook en développement

```bash
# Avec ngrok :
ngrok http 3000
# Copier l'URL https://xxxx.ngrok-free.app dans NEXT_PUBLIC_APP_URL
```

#### Initialiser la base de la clinique

```bash
npm run db:setup   # cree les tables sur la base Turso de la clinique
```

#### Lancer

```bash
npm run dev
# → http://localhost:3000/consultation
```

---

## Structure des fichiers

```
vetpulse/
├── app/
│   ├── admin/
│   │   ├── page.tsx              # Server component — vérifie REQVET_RESELLER_API_KEY
│   │   ├── ClinicDashboard.tsx   # Client component — UI admin complète
│   │   └── admin.module.css
│   ├── api/
│   │   ├── admin/clinics/
│   │   │   ├── route.ts          # GET list / POST create
│   │   │   └── [id]/route.ts     # GET / PATCH / DELETE
│   │   ├── consultations/
│   │   │   ├── route.ts
│   │   │   └── [id]/route.ts
│   │   └── reqvet/
│   │       ├── generate/route.ts
│   │       ├── webhook/route.ts
│   │       ├── job/route.ts
│   │       ├── templates/route.ts
│   │       ├── reformulate/route.ts
│   │       └── amend/route.ts
│   ├── consultation/page.tsx
│   ├── layout.tsx
│   └── globals.css
├── lib/
│   ├── reqvet.ts          # Client SDK clinique (REQVET_API_KEY)
│   ├── reqvet-admin.ts    # Client SDK reseller (REQVET_RESELLER_API_KEY)
│   ├── db.ts              # Client Turso + helpers + types
│   └── db-setup.mjs       # Script d'initialisation du schéma
├── .env.example
└── package.json
```

---

## Points techniques clés

### Upload audio sans limite de taille

`uploadAudio()` poste vers `/api/v1/upload` (Vercel Serverless Function, limitée à ~4.5 MB).
Les fichiers de consultation réels font 5–30 MB → `413 FUNCTION_PAYLOAD_TOO_LARGE`.

**VetPulse utilise `getSignedUploadUrl()`** pour contourner cette limite :

```
1. reqvet.getSignedUploadUrl(fileName, contentType)
   → { uploadUrl, path }   ← requête JSON légère, aucun fichier transféré

2. PUT uploadUrl            ← audio directement vers Supabase (bypass Vercel)
   → aucune limite de taille

3. reqvet.createJob({ audioFile: path, ... })
```

Voir `app/api/reqvet/generate/route.ts` et `app/api/reqvet/amend/route.ts`.

### Idempotence des organisations (reseller)

`createOrganization()` accepte un `externalId` (UUID local Turso).
Si une organisation avec ce même `externalId` existe déjà côté ReqVet, l'API retourne l'existante
sans créer de doublon — et sans renvoyer `api_key`/`webhook_secret`.
Cela protège contre les double-clics ou les erreurs réseau au moment de la création.

### Sécurité

- Clés API jamais exposées côté client (pattern proxy sur toutes les routes)
- Signature HMAC vérifiée sur chaque webhook entrant (`verifyWebhookSignature`)
- Anti-replay : fenêtre de 5 min sur le timestamp webhook
- Idempotence webhook : dédoublonnage sur `(job_id, event_type)` en base
- `REQVET_RESELLER_API_KEY` absente = routes `/api/admin/*` retournent `403`
- Variables d'environnement uniquement — jamais commitées (`.gitignore`)
