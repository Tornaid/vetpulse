"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import styles from "./DocumentationPage.module.css";

// ═══════════════════════════════════════════════════════════════
// Types & TOC
// ═══════════════════════════════════════════════════════════════

type HttpVerb = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const TOC: Array<{ id: string; label: string }> = [
  { id: "overview", label: "Vue d'ensemble" },
  { id: "model", label: "Modèle 1 admin + N cliniques" },
  { id: "architecture", label: "Architecture" },
  { id: "flow-vet", label: "Flux clinique end-to-end" },
  { id: "flow-admin", label: "Flux admin reseller" },
  { id: "routes", label: "Routes proxy ↔ SDK" },
  { id: "structure", label: "Structure des fichiers" },
  { id: "setup", label: "Setup" },
  { id: "tech", label: "Points techniques clés" },
  { id: "further", label: "Aller plus loin" },
];

// ═══════════════════════════════════════════════════════════════
// Data — Snippets
// ═══════════════════════════════════════════════════════════════

const SNIPPETS: Record<string, string> = {
  reqvetClient: `// lib/reqvet.ts — Singleton côté serveur (jamais importé d'un composant client)
// Pattern proxy : la clé API reste ici, jamais exposée au navigateur
import ReqVet from "@reqvet-sdk/sdk";

if (!process.env.REQVET_API_KEY) {
  throw new Error("REQVET_API_KEY manquante dans .env.local");
}

export const reqvet = new ReqVet(process.env.REQVET_API_KEY, {
  baseUrl: process.env.REQVET_BASE_URL ?? "https://api.reqvet.com",
  pollInterval: 5000,
  timeout: 5 * 60 * 1000,
});`,

  reqvetAdmin: `// lib/reqvet-admin.ts — Client SDK avec clé reseller
// Utilisé uniquement dans les routes /api/admin/*
import ReqVet from "@reqvet-sdk/sdk";

let _client: ReqVet | null = null;

export function getResellerClient(): ReqVet {
  if (!process.env.REQVET_RESELLER_API_KEY) {
    throw new Error("REQVET_RESELLER_API_KEY manquante — pas configuré en mode admin.");
  }
  if (!_client) {
    _client = new ReqVet(process.env.REQVET_RESELLER_API_KEY, {
      baseUrl: process.env.REQVET_BASE_URL ?? "https://api.reqvet.com",
    });
  }
  return _client;
}`,

  generateRoute: `// app/api/reqvet/generate/route.ts — le proxy le plus important
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const audio = form.get("audio") as File;
  const animalName = form.get("animalName") as string;
  const animalBreed = form.get("animalBreed") as string | undefined;
  const animalAge   = form.get("animalAge")   as string | undefined;
  const templateId = form.get("templateId") as string;
  const consultationId = form.get("consultationId") as string;

  // 1a. URL signée Supabase (requête JSON légère)
  const { uploadUrl, path: audioPath } = await reqvet.getSignedUploadUrl(
    audio.name || "consultation.webm",
    audio.type || "audio/webm",
  );

  // 1b. PUT direct vers Supabase (bypass Vercel 4,5 Mo)
  await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": audio.type || "audio/webm" },
    body: Buffer.from(await audio.arrayBuffer()),
  });

  // 2. Créer le job avec callbackUrl vers notre webhook
  const callbackUrl = \`\${process.env.NEXT_PUBLIC_APP_URL}/api/reqvet/webhook\`;
  const job = await reqvet.createJob({
    audioFile: audioPath,
    animalName, animalBreed, animalAge,
    templateId, callbackUrl,
    metadata: { consultationId, source: "vetpulse" },
  });

  // 3. Persister le mapping local ↔ ReqVet en base Turso
  const localJobId = randomUUID();
  await createJob({
    id: localJobId,
    consultationId,
    reqvetJobId: job.job_id,
    templateId,
    status: job.status,
    metadata: { consultationId },
  });

  return NextResponse.json({ job_id: job.job_id, local_job_id: localJobId }, { status: 201 });
}`,

  webhookRoute: `// app/api/reqvet/webhook/route.ts — reçoit les résultats ReqVet
import { verifyWebhookSignature } from "@reqvet-sdk/sdk/webhooks";

export async function POST(req: NextRequest) {
  // 1. Raw body AVANT JSON.parse (obligatoire pour HMAC)
  const rawBody = await req.text();

  // 2. Vérifier signature HMAC + anti-replay 5 min
  const result = verifyWebhookSignature({
    secret: process.env.REQVET_WEBHOOK_SECRET,
    rawBody,
    signature: req.headers.get("x-reqvet-signature") ?? "",
    timestamp: req.headers.get("x-reqvet-timestamp") ?? "",
    maxSkewMs: 5 * 60 * 1000,
  });
  if (!result.ok) return new NextResponse("Unauthorized", { status: 401 });

  const event = JSON.parse(rawBody);

  // 3. Idempotence — dedup sur (job_id, event_type)
  const existing = await db.execute({
    sql: "SELECT id FROM webhook_events WHERE job_id = ? AND event_type = ?",
    args: [event.job_id, event.event],
  });
  if (existing.rows.length > 0) return NextResponse.json({ ok: true, deduplicated: true });

  await db.execute({
    sql: "INSERT INTO webhook_events (id, job_id, event_type) VALUES (?, ?, ?)",
    args: [\`\${event.job_id}:\${event.event}\`, event.job_id, event.event],
  });

  // 4. Router selon l'event
  switch (event.event) {
    case "job.completed":
    case "job.amended":
    case "job.regenerated":
      await updateJobFromWebhook({
        reqvetJobId: event.job_id,
        status: "completed",
        html: event.html,
        transcription: event.transcription,
        fields: event.fields,
        amendmentNumber: event.amendment_number,
      });
      break;
    case "job.failed":
    case "job.amend_failed":
      await updateJobFromWebhook({
        reqvetJobId: event.job_id,
        status: event.event === "job.failed" ? "failed" : "completed",
        error: event.error,
      });
      break;
  }
  return NextResponse.json({ ok: true });
}`,

  jobRoute: `// app/api/reqvet/job/route.ts — polling côté frontend
// Deux sources : (1) Turso (mise à jour par le webhook), (2) API ReqVet (fallback)
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId")!;

  // 1. D'abord la base (webhook déjà passé ?)
  const localJob = await getJob(jobId);
  if (localJob?.status === "completed") {
    return NextResponse.json({
      status: "completed",
      html: localJob.html,
      transcription: localJob.transcription,
      fields: localJob.fields ? JSON.parse(localJob.fields) : null,
    });
  }
  if (localJob?.status === "failed") {
    return NextResponse.json({ status: "failed", error: localJob.error });
  }

  // 2. Fallback API ReqVet (webhook en retard)
  const remoteJob = await reqvet.getJob(jobId);
  return NextResponse.json({
    status: remoteJob.status,
    html: remoteJob.result?.html ?? null,
    transcription: remoteJob.transcription ?? null,
    fields: remoteJob.result?.fields ?? null,
  });
}`,

  createClinic: `// app/api/admin/clinics/route.ts — provisionner une clinique
export async function POST(req: NextRequest) {
  const { name, contactEmail, monthlyQuota, notes } = await req.json();
  const reqvetAdmin = getResellerClient();

  // UUID local généré en avance → sert d'externalId pour l'idempotence
  const localId = randomUUID();

  const result = await reqvetAdmin.createOrganization({
    name: name.trim(),
    contactEmail,
    monthlyQuota: monthlyQuota ? Number(monthlyQuota) : undefined,
    externalId: localId,   // ← clé d'idempotence : re-appel = pas de doublon
  });

  // L'org existait déjà (idempotence) — pas de credentials retournés
  if (result.message) {
    const existing = await getClinicByReqvetOrgId(result.organization.id);
    return NextResponse.json({
      organization: result.organization,
      already_existed: true,
      local_id: existing?.id ?? null,
    });
  }

  // Nouvelle org — sauvegarder en local SANS la clé (elle reste chez la clinique)
  await createClinicRecord({
    id: localId,
    reqvetOrgId: result.organization.id,
    name: result.organization.name,
    notes: notes?.trim() || null,
  });

  // Retourner api_key + webhook_secret UNE SEULE FOIS
  return NextResponse.json({
    organization: result.organization,
    local_id: localId,
    api_key: result.api_key,
    webhook_secret: result.webhook_secret,
  }, { status: 201 });
}`,

  envAdmin: `# .env.local — Instance ADMIN (DrVeto)
REQVET_RESELLER_API_KEY=rqv_live_reseller_...   # clé reseller fournie par ReqVet
REQVET_BASE_URL=https://api.reqvet.com

# Turso — base centrale DrVeto (liste des cliniques)
TURSO_DATABASE_URL=libsql://vetpulse-drveto.turso.io
TURSO_AUTH_TOKEN=eyJ...

NEXT_PUBLIC_APP_URL=https://admin.drveto.fr`,

  envClinic: `# .env.local — Instance CLINIQUE
REQVET_API_KEY=rqv_live_clinic_...          # clé clinique (obtenue via /admin DrVeto)
REQVET_WEBHOOK_SECRET=whsec_...              # secret webhook (obtenu en même temps)
REQVET_BASE_URL=https://api.reqvet.com

# Turso — base propre à cette clinique
TURSO_DATABASE_URL=libsql://vetpulse-clinique-du-parc.turso.io
TURSO_AUTH_TOKEN=eyJ...

# URL publique (tunnel ngrok en dev, domaine en prod)
NEXT_PUBLIC_APP_URL=https://xxxx.ngrok-free.app`,

  fileTree: `vetpulse/
├── app/
│   ├── admin/                       # UI reseller (mode DrVeto)
│   │   ├── page.tsx                 # server component : garde REQVET_RESELLER_API_KEY
│   │   ├── ClinicDashboard.tsx      # client component : liste + création
│   │   ├── clinics/, costs/, overview/, templates/
│   │   └── AdminSidebar.tsx
│   ├── api/
│   │   ├── admin/clinics/           # GET list · POST create · [id] PATCH/DELETE
│   │   ├── consultations/           # PATCH motif/CR/conclusion en Turso
│   │   └── reqvet/                  # ← Le cœur du proxy backend
│   │       ├── generate/route.ts    # getSignedUploadUrl + createJob
│   │       ├── webhook/route.ts     # verifyWebhookSignature + updateJob
│   │       ├── job/route.ts         # getJob (poll)
│   │       ├── templates/route.ts   # listTemplates
│   │       ├── reformulate/route.ts # reformulateReport
│   │       └── amend/route.ts       # getSignedUploadUrl + amendJob
│   ├── consultation/page.tsx        # UI vétérinaire
│   ├── layout.tsx
│   └── globals.css
├── components/
│   └── ConsultationView.tsx         # MediaRecorder + polling + éditeur riche
├── lib/
│   ├── reqvet.ts                    # SDK clinique (REQVET_API_KEY)
│   ├── reqvet-admin.ts              # SDK reseller (REQVET_RESELLER_API_KEY)
│   ├── db.ts                        # Turso client + helpers + types
│   └── db-setup.mjs                 # script d'initialisation du schéma
├── .env.example
└── package.json`,
};

// ═══════════════════════════════════════════════════════════════
// Data — Routes proxy ↔ SDK
// ═══════════════════════════════════════════════════════════════

type Route = { verb: HttpVerb; path: string; sdk: string; role: "clinic" | "admin" };

const ROUTES_CLINIC: Route[] = [
  { verb: "POST", path: "/api/reqvet/generate", sdk: "getSignedUploadUrl() + createJob()", role: "clinic" },
  { verb: "POST", path: "/api/reqvet/webhook", sdk: "verifyWebhookSignature()", role: "clinic" },
  { verb: "GET", path: "/api/reqvet/job", sdk: "getJob() (fallback si Turso pas à jour)", role: "clinic" },
  { verb: "GET", path: "/api/reqvet/templates", sdk: "listTemplates()", role: "clinic" },
  { verb: "POST", path: "/api/reqvet/reformulate", sdk: "reformulateReport() + sauvegarde Turso", role: "clinic" },
  { verb: "POST", path: "/api/reqvet/amend", sdk: "getSignedUploadUrl() + amendJob()", role: "clinic" },
  { verb: "PATCH", path: "/api/consultations/[id]", sdk: "— (Turso only)", role: "clinic" },
];

const ROUTES_ADMIN: Route[] = [
  { verb: "GET", path: "/api/admin/clinics", sdk: "listOrganizations() + enrichit avec notes Turso", role: "admin" },
  { verb: "POST", path: "/api/admin/clinics", sdk: "createOrganization() + createClinicRecord (Turso)", role: "admin" },
  { verb: "GET", path: "/api/admin/clinics/[id]", sdk: "getOrganization() + usage mensuel", role: "admin" },
  { verb: "PATCH", path: "/api/admin/clinics/[id]", sdk: "updateOrganization()", role: "admin" },
  { verb: "DELETE", path: "/api/admin/clinics/[id]", sdk: "deactivateOrganization() (soft delete)", role: "admin" },
];

// ═══════════════════════════════════════════════════════════════
// Components
// ═══════════════════════════════════════════════════════════════

function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [code]);

  return (
    <div className={styles.codeBlock}>
      {label && <span className={styles.codeLabel}>{label}</span>}
      <button className={styles.copyBtn} onClick={onCopy} aria-label="Copier le code">
        {copied ? "Copié ✓" : "Copier"}
      </button>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Callout({ tone = "info", title, children }: { tone?: "info" | "warn" | "ok"; title?: string; children: React.ReactNode }) {
  const classes = [
    styles.callout,
    tone === "warn" ? styles.calloutWarn : "",
    tone === "ok" ? styles.calloutOk : "",
  ].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      {title && <strong>{title}</strong>}
      <div>{children}</div>
    </div>
  );
}

function MethodBadge({ verb }: { verb: HttpVerb }) {
  const classMap: Record<HttpVerb, string> = {
    GET: styles.methodGET,
    POST: styles.methodPOST,
    PUT: styles.methodPUT,
    PATCH: styles.methodPATCH,
    DELETE: styles.methodDELETE,
  };
  return <span className={`${styles.methodBadge} ${classMap[verb]}`}>{verb}</span>;
}

function TocSidebar({ active }: { active: string | null }) {
  return (
    <nav className={styles.toc} aria-label="Sommaire de la documentation">
      <span className={styles.tocTitle}>Sommaire</span>
      <ul className={styles.tocList}>
        {TOC.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={active === item.id ? styles.tocLinkActive : styles.tocLink}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ═══════════════════════════════════════════════════════════════
// Page
// ═══════════════════════════════════════════════════════════════

export default function VetPulseDocPage() {
  const [activeSection, setActiveSection] = useState<string | null>("overview");
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const sections = document.querySelectorAll<HTMLElement>("section[data-toc]");
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          const first = visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
          setActiveSection(first.target.id);
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 }
    );
    sections.forEach((s) => observerRef.current?.observe(s));
    return () => observerRef.current?.disconnect();
  }, []);

  return (
    <main className={styles.page}>
      {/* ─── Hero ─────────────────────────────────────────── */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <span className={styles.badge}>Démo &amp; guide d&apos;intégration</span>
          <h1 className={styles.heroTitle}>VetPulse</h1>
          <p className={styles.heroTagline}>
            Logiciel de gestion vétérinaire <strong>fictif</strong> · démo d&apos;intégration du SDK et de reqvet-engine
          </p>
          <p className={styles.heroSubtitle}>
            VetPulse n&apos;est pas un vrai produit commercialisé — c&apos;est une <strong>reference
            implementation</strong> conçue pour montrer, code à l&apos;appui, comment intégrer le SDK{" "}
            <code>@reqvet-sdk/sdk</code> et le moteur reqvet-engine dans votre propre logiciel de gestion
            vétérinaire (ERP). Stack : Next.js 15 · TypeScript strict · Turso (LibSQL) · SDK v2.3.0.
          </p>
          <div className={styles.heroCtas}>
            <a href="#architecture" className={styles.btnPrimary}>Architecture →</a>
            <a href="#routes" className={styles.btnGhost}>Routes proxy</a>
          </div>
        </div>
      </section>

      {/* ─── Layout ───────────────────────────────────────── */}
      <div className={styles.layout}>
        <TocSidebar active={activeSection} />

        <div className={styles.content}>

          {/* ══ 1 · Vue d'ensemble ═════════════════════════════ */}
          <section id="overview" data-toc className={styles.section}>
            <span className={styles.kicker}>1</span>
            <h2 className={styles.sectionTitle}>Vue d&apos;ensemble</h2>

            <Callout tone="warn" title="⚠ Logiciel fictif à visée de démonstration">
              VetPulse <strong>n&apos;est pas un logiciel commercialisé</strong> ni un produit maintenu par
              une équipe métier. C&apos;est un <strong>projet fictif</strong> — une démo autoportée créée
              pour <strong>aider les éditeurs de logiciels vétérinaires à intégrer le SDK
              <code> @reqvet-sdk/sdk</code> et le moteur reqvet-engine</strong> dans leur propre ERP. Aucun
              vétérinaire réel n&apos;utilise VetPulse. Chaque route, chaque snippet, chaque pattern présenté
              ici est fait pour être <strong>copié et adapté</strong> dans votre stack.
            </Callout>

            <p className={styles.lead}>
              VetPulse illustre un flux métier vétérinaire complet — enregistrement audio d&apos;une
              consultation → génération de compte-rendu → reformulation → amendement audio — avec en plus
              un <strong>dashboard reseller</strong> qui permet à un partenaire (fictif, ex. « DrVeto ») de
              créer et piloter ses cliniques clientes depuis une interface centrale.
            </p>

            <div className={styles.factGrid}>
              <div className={styles.factCard}><span>Statut</span><strong>Démo · projet fictif</strong></div>
              <div className={styles.factCard}><span>Objectif</span><strong>Aide à l&apos;intégration SDK / engine</strong></div>
              <div className={styles.factCard}><span>Framework</span><strong>Next.js 15 (App Router)</strong></div>
              <div className={styles.factCard}><span>Langage</span><strong>TypeScript strict</strong></div>
              <div className={styles.factCard}><span>Base de données</span><strong>Turso (LibSQL)</strong></div>
              <div className={styles.factCard}><span>SDK ReqVet</span><strong>@reqvet-sdk/sdk v2.3.0</strong></div>
              <div className={styles.factCard}><span>Auth ReqVet</span><strong>Pattern proxy backend</strong></div>
              <div className={styles.factCard}><span>Modèle</span><strong>1 admin reseller + N cliniques</strong></div>
            </div>

            <Callout tone="ok" title="Ce que vous devez en retenir pour votre intégration">
              VetPulse illustre le pattern proxy backend recommandé dans la doc ReqVet — la clé API vit
              exclusivement côté serveur, dans un singleton (<code>lib/reqvet.ts</code>). Chaque route Next.js
              (<code>app/api/reqvet/*</code>) est un thin wrapper qui délègue à une méthode du SDK. Vous
              pouvez <strong>reproduire cette structure dans votre ERP</strong> (Next.js, Express, NestJS,
              autre) — seule la couche route change, le SDK et le moteur restent identiques.
            </Callout>
          </section>

          {/* ══ 2 · Modèle 1 admin + N cliniques ═════════════════ */}
          <section id="model" data-toc className={styles.section}>
            <span className={styles.kicker}>2</span>
            <h2 className={styles.sectionTitle}>Modèle de déploiement — 1 admin + N cliniques</h2>
            <p className={styles.lead}>
              VetPulse a <strong>deux modes de fonctionnement</strong> distincts, différenciés uniquement par
              les variables d&apos;environnement. Le même code source sert les deux — c&apos;est la variable
              présente à l&apos;exécution qui détermine si l&apos;instance est un admin ou une clinique.
            </p>

            <CodeBlock code={`DrVeto (reseller ReqVet)
  └── VetPulse Admin   [REQVET_RESELLER_API_KEY]  →  /admin
        ├── Clinique du Parc       →  VetPulse Clinique A  [REQVET_API_KEY=rqv_live_AAA]
        ├── Cabinet Laval Animaux  →  VetPulse Clinique B  [REQVET_API_KEY=rqv_live_BBB]
        └── Clinique Saint-Ex...   →  VetPulse Clinique C  [REQVET_API_KEY=rqv_live_CCC]`} />

            <table className={styles.table}>
              <thead><tr><th>Mode</th><th>Variable présente</th><th>Accès</th><th>Rôle</th></tr></thead>
              <tbody>
                <tr>
                  <td><strong>Admin reseller</strong></td>
                  <td><code>REQVET_RESELLER_API_KEY</code></td>
                  <td><code>/admin</code></td>
                  <td>Créer et gérer les cliniques du réseau</td>
                </tr>
                <tr>
                  <td><strong>Clinique</strong></td>
                  <td><code>REQVET_API_KEY</code></td>
                  <td><code>/consultation</code></td>
                  <td>Flux vétérinaire complet (enregistrer, générer, éditer)</td>
                </tr>
              </tbody>
            </table>

            <p className={styles.para}>
              Chaque clinique a son propre déploiement VetPulse avec sa propre base Turso — les données
              patients ne se mélangent jamais. La clé API clinique est remise <strong>une seule fois</strong>
              via le dashboard admin (jamais stockée en base), puis configurée dans le <code>.env.local</code>
              de l&apos;instance clinique.
            </p>
          </section>

          {/* ══ 3 · Architecture ═════════════════════════════════ */}
          <section id="architecture" data-toc className={styles.section}>
            <span className={styles.kicker}>3</span>
            <h2 className={styles.sectionTitle}>Architecture — 3 couches</h2>
            <p className={styles.lead}>
              Le pattern proxy backend en action : le navigateur ne parle qu&apos;à VetPulse, VetPulse parle
              à ReqVet (via le SDK) et à Turso. La clé API ReqVet ne quitte jamais le serveur.
            </p>

            <div className={styles.archDiagram}>
              <div className={styles.archLayer}>
                <span className={styles.archLabel}>Couche 1 — Navigateur</span>
                <div className={styles.archBox}>
                  <strong>ConsultationView.tsx · ClinicDashboard.tsx</strong>
                  <span>
                    MediaRecorder (Opus 32 kbps), sélection template, éditeur riche, polling du statut,
                    UI admin (liste cliniques, modal credentials). Aucune clé ReqVet ici.
                  </span>
                </div>
              </div>
              <div className={styles.archArrow}>↓ fetch(&quot;/api/reqvet/*&quot;)</div>
              <div className={styles.archLayer}>
                <span className={styles.archLabel}>Couche 2 — Serveur Next.js (routes proxy)</span>
                <div className={styles.archBox}>
                  <strong>app/api/reqvet/* + app/api/admin/*</strong>
                  <span>
                    Singletons SDK (<code>lib/reqvet.ts</code>, <code>lib/reqvet-admin.ts</code>) · délégation
                    aux méthodes SDK · mapping local ↔ ReqVet dans Turso · vérification HMAC des webhooks
                    entrants · idempotence via <code>webhook_events</code>.
                  </span>
                </div>
              </div>
              <div className={styles.archArrow}>↓ HTTPS + Bearer rqv_live_… (SDK)</div>
              <div className={styles.archLayer}>
                <span className={styles.archLabel}>Couche 3 — Services externes</span>
                <div className={styles.archBox}>
                  <strong>ReqVet API (api.reqvet.com) · Turso DB</strong>
                  <span>
                    ReqVet : transcription + génération LLM + webhook de retour vers{" "}
                    <code>/api/reqvet/webhook</code>. Turso : consultations, jobs, reformulations,
                    webhook_events, clinics (admin).
                  </span>
                </div>
              </div>
            </div>

            <h3 className={styles.h3}>Le singleton SDK</h3>
            <CodeBlock code={SNIPPETS.reqvetClient} label="lib/reqvet.ts" />
            <p className={styles.para}>
              Deux règles : (1) importé <strong>uniquement</strong> depuis des routes serveur, jamais depuis
              un composant client ; (2) instanciation dès le chargement du module — le check{" "}
              <code>REQVET_API_KEY</code> jette au boot si la variable manque, plutôt que de laisser une route
              planter à la première requête.
            </p>

            <h3 className={styles.h3}>Le singleton admin (lazy)</h3>
            <CodeBlock code={SNIPPETS.reqvetAdmin} label="lib/reqvet-admin.ts" />
            <p className={styles.para}>
              Différence avec <code>lib/reqvet.ts</code> : ici l&apos;initialisation est <strong>lazy</strong>
              (dans <code>getResellerClient()</code>) car les instances clinique n&apos;ont pas de{" "}
              <code>REQVET_RESELLER_API_KEY</code> et ne doivent pas planter au boot. L&apos;erreur ne se
              produit que si une route <code>/api/admin/*</code> tente d&apos;appeler le client.
            </p>
          </section>

          {/* ══ 4 · Flux clinique end-to-end ══════════════════════ */}
          <section id="flow-vet" data-toc className={styles.section}>
            <span className={styles.kicker}>4</span>
            <h2 className={styles.sectionTitle}>Flux clinique — de l&apos;audio au CR</h2>
            <p className={styles.lead}>
              De l&apos;enregistrement audio à l&apos;affichage du compte-rendu dans l&apos;éditeur, en
              six étapes. Le vétérinaire n&apos;attend jamais activement — le polling se fait en arrière-plan,
              le webhook alimente Turso, la UI se met à jour dès que le CR est prêt.
            </p>

            <ol className={styles.flowList}>
              <li><strong>Frontend enregistre</strong> — MediaRecorder Opus 32 kbps dans <code>ConsultationView.tsx</code>. Le blob est envoyé en multipart à <code>POST /api/reqvet/generate</code> avec <code>animalName</code>, <code>animalBreed</code>, <code>animalAge</code> (issus du profil patient <code>consultations</code>).</li>
              <li><strong>Proxy demande une URL signée</strong> — <code>reqvet.getSignedUploadUrl()</code> retourne <code>{"{ uploadUrl, path }"}</code>. Requête JSON légère, aucun fichier transféré à ce stade.</li>
              <li><strong>Upload PUT direct</strong> — le proxy fait un <code>PUT</code> du blob vers l&apos;<code>uploadUrl</code> Supabase. Contourne la limite Vercel de 4,5 Mo.</li>
              <li><strong>createJob avec callbackUrl</strong> — <code>reqvet.createJob({"{ audioFile, ..., callbackUrl }"})</code> où <code>callbackUrl = ${"{NEXT_PUBLIC_APP_URL}"}/api/reqvet/webhook</code>. Retour immédiat 201 avec <code>job_id</code>. Un enregistrement est créé dans Turso (<code>jobs</code>) pour mapper <code>local_job_id</code> ↔ <code>reqvetJobId</code> ↔ <code>consultationId</code>.</li>
              <li><strong>Webhook ReqVet → VetPulse</strong> — quand la transcription + génération sont prêtes, ReqVet POSTe sur <code>/api/reqvet/webhook</code> avec HMAC. Le handler vérifie la signature, déduplique via <code>webhook_events</code>, met à jour <code>jobs</code> avec <code>html</code>, <code>transcription</code>, <code>fields</code>.</li>
              <li><strong>Frontend poll</strong> — <code>GET /api/reqvet/job?jobId=…</code> toutes les 3-5 s. Dès que <code>status = &quot;completed&quot;</code>, la UI affiche le CR et pré-remplit les champs éditables (motif, conclusion). Le vétérinaire édite, sauvegarde avec <code>PATCH /api/consultations/[id]</code>.</li>
            </ol>

            <h3 className={styles.h3}>Le proxy <code>/generate</code> — le plus important</h3>
            <CodeBlock code={SNIPPETS.generateRoute} label="app/api/reqvet/generate/route.ts (extrait)" />

            <h3 className={styles.h3}>Le handler webhook</h3>
            <CodeBlock code={SNIPPETS.webhookRoute} label="app/api/reqvet/webhook/route.ts (extrait)" />

            <h3 className={styles.h3}>Le polling — Turso d&apos;abord, ReqVet en fallback</h3>
            <CodeBlock code={SNIPPETS.jobRoute} label="app/api/reqvet/job/route.ts (extrait)" />
            <p className={styles.para}>
              Deux sources de vérité gérées gracieusement : la base Turso est <strong>la</strong> source
              principale (alimentée par le webhook), mais si le webhook tarde ou échoue, on interroge
              directement l&apos;API ReqVet en fallback. Si l&apos;API indique <code>completed</code> avant
              le webhook, on met à jour Turso au passage.
            </p>
          </section>

          {/* ══ 5 · Flux admin reseller ═════════════════════════════ */}
          <section id="flow-admin" data-toc className={styles.section}>
            <span className={styles.kicker}>5</span>
            <h2 className={styles.sectionTitle}>Flux admin reseller</h2>
            <p className={styles.lead}>
              Le dashboard <code>/admin</code> est réservé aux instances configurées avec{" "}
              <code>REQVET_RESELLER_API_KEY</code>. Il permet à DrVeto de provisionner ses cliniques, gérer
              leurs quotas et récupérer leurs credentials <strong>une seule fois</strong> à la création.
            </p>

            <ol className={styles.flowList}>
              <li><strong>DrVeto ouvre <code>/admin</code></strong> — le server component vérifie <code>REQVET_RESELLER_API_KEY</code>. Absent → 403.</li>
              <li><strong>Liste enrichie</strong> — <code>GET /api/admin/clinics</code> appelle <code>reqvetAdmin.listOrganizations()</code> et croise avec les notes locales stockées en Turso (<code>clinics.notes</code>).</li>
              <li><strong>Créer une clinique</strong> — modal avec nom, email, quota, notes. Génération d&apos;un UUID local qui servira d&apos;<code>externalId</code> pour l&apos;idempotence côté ReqVet.</li>
              <li><strong>createOrganization()</strong> — le proxy appelle le SDK. Réponse : <code>{"{ organization, api_key, webhook_secret, warning }"}</code>.</li>
              <li><strong>Modal credentials one-time</strong> — l&apos;<code>api_key</code> et le <code>webhook_secret</code> sont affichés une seule fois. DrVeto les copie dans un gestionnaire de mots de passe et les transmet à la clinique.</li>
              <li><strong>Turso — mapping local</strong> — VetPulse stocke <code>{"{ id (=externalId), reqvet_org_id, name, notes }"}</code> mais <strong>jamais</strong> l&apos;<code>api_key</code>.</li>
            </ol>

            <h3 className={styles.h3}>Le proxy <code>/admin/clinics</code> — création + idempotence</h3>
            <CodeBlock code={SNIPPETS.createClinic} label="app/api/admin/clinics/route.ts (extrait)" />

            <Callout tone="warn" title="La clé n'est jamais re-affichable">
              Une fois la modal fermée, l&apos;<code>api_key</code> est perdue côté DrVeto — ReqVet ne stocke
              que son hash SHA-256. En cas de perte, il faudra passer par la rotation de clé côté ReqVet
              (fonctionnalité admin, hors périmètre VetPulse actuel).
            </Callout>
          </section>

          {/* ══ 6 · Routes proxy ↔ SDK ═════════════════════════════ */}
          <section id="routes" data-toc className={styles.section}>
            <span className={styles.kicker}>6</span>
            <h2 className={styles.sectionTitle}>Routes proxy ↔ méthode SDK</h2>
            <p className={styles.lead}>
              Le mapping exhaustif entre les routes VetPulse et les méthodes SDK qu&apos;elles appellent
              sous le capot. Toutes les routes vérifient l&apos;auth utilisateur avant de déléguer au SDK.
            </p>

            <h3 className={styles.h3}>Routes cliniques (nécessitent <code>REQVET_API_KEY</code>)</h3>
            <table className={styles.table}>
              <thead><tr><th>Méthode</th><th>Route VetPulse</th><th>Appel SDK sous-jacent</th></tr></thead>
              <tbody>
                {ROUTES_CLINIC.map((r) => (
                  <tr key={`${r.verb}-${r.path}`}>
                    <td><MethodBadge verb={r.verb} /></td>
                    <td><code>{r.path}</code></td>
                    <td>{r.sdk}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 className={styles.h3}>Routes admin (nécessitent <code>REQVET_RESELLER_API_KEY</code>)</h3>
            <table className={styles.table}>
              <thead><tr><th>Méthode</th><th>Route VetPulse</th><th>Appel SDK sous-jacent</th></tr></thead>
              <tbody>
                {ROUTES_ADMIN.map((r) => (
                  <tr key={`${r.verb}-${r.path}`}>
                    <td><MethodBadge verb={r.verb} /></td>
                    <td><code>{r.path}</code></td>
                    <td>{r.sdk}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className={styles.para}>
              Chaque route côté VetPulse est un thin wrapper : ~40-100 lignes de TypeScript qui parsent
              l&apos;entrée, appellent une méthode SDK, persistent le mapping local en Turso, et retournent
              la réponse au frontend. La complexité est mutualisée dans le SDK et le moteur ReqVet.
            </p>
          </section>

          {/* ══ 7 · Structure des fichiers ═════════════════════════ */}
          <section id="structure" data-toc className={styles.section}>
            <span className={styles.kicker}>7</span>
            <h2 className={styles.sectionTitle}>Structure des fichiers</h2>
            <p className={styles.lead}>
              Arborescence commentée avec le rôle de chaque module. Le cœur est dans{" "}
              <code>app/api/reqvet/*</code> (proxy clinique), <code>app/api/admin/*</code> (proxy admin) et{" "}
              <code>lib/reqvet*.ts</code> (singletons SDK).
            </p>
            <CodeBlock code={SNIPPETS.fileTree} />
          </section>

          {/* ══ 8 · Setup ══════════════════════════════════════════ */}
          <section id="setup" data-toc className={styles.section}>
            <span className={styles.kicker}>8</span>
            <h2 className={styles.sectionTitle}>Setup</h2>
            <p className={styles.lead}>
              Trois étapes : mise en place commune (base Turso), puis config spécifique selon le mode
              (admin ou clinique). Prérequis : Node ≥ 18, compte{" "}
              <a href="https://turso.tech" target="_blank" rel="noreferrer">Turso</a> (gratuit), clé API
              ReqVet, tunnel HTTPS public pour recevoir les webhooks en dev (ngrok).
            </p>

            <h3 className={styles.h3}>1. Setup commun</h3>
            <CodeBlock code={`# Installer les dépendances
npm install

# Créer la base Turso
turso db create vetpulse
turso db show vetpulse --url      # → TURSO_DATABASE_URL
turso db tokens create vetpulse   # → TURSO_AUTH_TOKEN

# Initialiser le schéma (idempotent)
npm run db:setup
# → crée consultations, jobs, reformulations, webhook_events, clinics`} />

            <h3 className={styles.h3}>2. Instance admin (DrVeto)</h3>
            <CodeBlock code={SNIPPETS.envAdmin} label=".env.local — mode admin" />
            <CodeBlock code={`npm run dev
# → http://localhost:3000/admin
# → cliquer "Ajouter une clinique" → remplir → modal credentials one-time`} />

            <h3 className={styles.h3}>3. Instance clinique</h3>
            <CodeBlock code={SNIPPETS.envClinic} label=".env.local — mode clinique" />
            <CodeBlock code={`# Exposer le webhook en dev (ngrok)
ngrok http 3000
# → copier l'URL https://xxxx.ngrok-free.app dans NEXT_PUBLIC_APP_URL

# Initialiser la base Turso propre à cette clinique
npm run db:setup

# Lancer
npm run dev
# → http://localhost:3000/consultation`} />

            <Callout tone="warn" title="Base Turso par instance">
              Chaque clinique doit avoir sa <strong>propre base Turso</strong> — les données patients ne se
              mélangent jamais. L&apos;instance admin DrVeto a également sa propre base pour stocker le
              mapping des cliniques (id + reqvet_org_id + notes internes, mais <strong>jamais</strong> les
              clés API).
            </Callout>
          </section>

          {/* ══ 9 · Points techniques clés ═════════════════════════ */}
          <section id="tech" data-toc className={styles.section}>
            <span className={styles.kicker}>9</span>
            <h2 className={styles.sectionTitle}>Points techniques clés</h2>
            <p className={styles.lead}>
              Les 5 choix d&apos;implémentation qui font marcher VetPulse en production — le pattern proxy,
              l&apos;upload sans limite, le contexte patient injecté, l&apos;idempotence des créations
              d&apos;orgs, la sécurité des webhooks.
            </p>

            <h3 className={styles.h3}>Signed upload — contourner la limite Vercel 4,5 Mo</h3>
            <p className={styles.para}>
              Les audios de consultation font 5-30 Mo — largement au-dessus de la limite <code>~4,5 Mo</code>{" "}
              des Vercel Serverless Functions. <code>reqvet.uploadAudio()</code> tomberait en{" "}
              <code>413 FUNCTION_PAYLOAD_TOO_LARGE</code>. VetPulse utilise systématiquement{" "}
              <code>getSignedUploadUrl()</code> + <code>PUT</code> direct vers Supabase :
            </p>
            <CodeBlock code={`// 1. Requête JSON légère → URL signée
const { uploadUrl, path } = await reqvet.getSignedUploadUrl(fileName, contentType);

// 2. PUT direct vers Supabase — aucune limite de taille
await fetch(uploadUrl, { method: "PUT", body: audioBuffer });

// 3. path (identifiant canonique côté Supabase) passé à createJob
await reqvet.createJob({ audioFile: path, ... });`} />

            <h3 className={styles.h3}>Contexte patient — race + âge injectés dans le prompt</h3>
            <p className={styles.para}>
              La table <code>consultations</code> contient déjà <code>patient_breed</code> et{" "}
              <code>patient_age</code>. VetPulse les transmet automatiquement à ReqVet sur chaque{" "}
              <code>createJob</code> — sans config supplémentaire. Côté ReqVet, ces données sont injectées
              dans le <strong>signalement patient</strong> du prompt LLM et améliorent significativement les
              hypothèses en mode <code>diagnostic_hypothesis</code> (prédispositions raciales, pathologies
              liées à l&apos;âge).
            </p>
            <CodeBlock code={`ConsultationRow.patient_breed  →  form "animalBreed"  →  reqvet.createJob({ animalBreed })
ConsultationRow.patient_age    →  form "animalAge"    →  reqvet.createJob({ animalAge })

// Côté ReqVet, injecté dans le prompt LLM :
SIGNALEMENT DU PATIENT :
- Nom : Rex
- Race : Labrador Retriever
- Âge : 5 ans`} />

            <h3 className={styles.h3}>Idempotence des créations d&apos;org — externalId</h3>
            <p className={styles.para}>
              <code>createOrganization()</code> accepte un <code>externalId</code> (UUID local Turso). Si une
              org avec ce même <code>externalId</code> existe déjà côté ReqVet, l&apos;API retourne
              l&apos;existante <strong>sans créer de doublon</strong> et sans renvoyer{" "}
              <code>api_key</code>/<code>webhook_secret</code>. Cela protège contre les double-clics
              utilisateur et les erreurs réseau au moment du provisionnement.
            </p>
            <CodeBlock code={`const localId = randomUUID();   // généré AVANT l'appel API
const result = await reqvetAdmin.createOrganization({
  name, contactEmail, monthlyQuota,
  externalId: localId,          // ← clé d'idempotence
});

if (result.message) {
  // L'org existait déjà — pas de nouvelles credentials, on remonte l'existante
  return { organization: result.organization, already_existed: true };
}
// Nouvelle org — result.api_key + result.webhook_secret retournés une seule fois`} />

            <h3 className={styles.h3}>Sécurité webhook — HMAC + anti-replay + idempotence</h3>
            <p className={styles.para}>
              Trois défenses empilées sur le handler webhook :
            </p>
            <ul className={styles.plainList}>
              <li><strong>Signature HMAC</strong> vérifiée via <code>verifyWebhookSignature</code> du SDK, sur le <em>raw body</em> (avant <code>JSON.parse</code>).</li>
              <li><strong>Anti-replay</strong> : <code>maxSkewMs = 5 min</code> sur le timestamp — rejette tout webhook trop vieux ou daté dans le futur.</li>
              <li><strong>Idempotence</strong> : dédoublonnage sur <code>(job_id, event_type)</code> via la table Turso <code>webhook_events</code>. Un webhook rejoué (retry ReqVet) est reconnu et ignoré silencieusement.</li>
            </ul>

            <h3 className={styles.h3}>Isolation reseller ↔ clinique — variables d&apos;env</h3>
            <p className={styles.para}>
              Le même code source sert les deux modes. C&apos;est la <strong>présence</strong> de la variable
              qui active le mode :
            </p>
            <ul className={styles.plainList}>
              <li><code>REQVET_RESELLER_API_KEY</code> présente → routes <code>/api/admin/*</code> activées</li>
              <li><code>REQVET_RESELLER_API_KEY</code> absente → routes <code>/api/admin/*</code> retournent <code>403</code></li>
              <li><code>REQVET_API_KEY</code> présente → routes <code>/api/reqvet/*</code> et <code>/consultation</code> fonctionnent</li>
              <li>Un déploiement peut avoir les deux (pour dev local), un déploiement de production a une seule des deux</li>
            </ul>
          </section>

          {/* ══ 10 · Aller plus loin ═══════════════════════════════ */}
          <section id="further" data-toc className={styles.section}>
            <span className={styles.kicker}>10</span>
            <h2 className={styles.sectionTitle}>Aller plus loin</h2>
            <p className={styles.lead}>
              Cette page couvre la vision architecturale. Le README VetPulse et le code source restent la
              référence pour les détails d&apos;implémentation.
            </p>

            <ul className={styles.plainList}>
              <li><strong>README complet</strong> — <code>vetpulse/README.md</code> : commandes shell exactes, tables Turso, variables d&apos;environnement détaillées, workflow DrVeto pas à pas.</li>
              <li><strong>Code source des proxies</strong> — <code>app/api/reqvet/*</code> et <code>app/api/admin/*</code> : chaque route est intentionnellement courte (~40-100 lignes) pour être lisible.</li>
              <li><strong>Types SDK</strong> — <code>node_modules/@reqvet-sdk/sdk/src/index.d.ts</code> : signatures typées des 22 méthodes du SDK.</li>
              <li><strong>Documentation ReqVet Engine</strong> — la vue complète du moteur (architecture, RGPD, sécurité, providers) est sur le site ReqVet.</li>
            </ul>

            <Callout tone="ok" title="Reproduire ce pattern dans votre ERP">
              L&apos;approche de VetPulse — singleton SDK côté serveur + thin proxy routes + mapping local en
              base — est directement transposable à <strong>n&apos;importe quel ERP vétérinaire réel</strong>{" "}
              (le vôtre, indépendamment du framework : Next.js, Express, NestJS, Rails, Laravel…). Le SDK et
              le moteur reqvet-engine sont le socle commun ; les routes proxy sont du code à écrire dans
              votre stack, mais copier la structure présentée ici fait gagner ~1-2 sprints d&apos;intégration.
            </Callout>
          </section>

        </div>
      </div>
    </main>
  );
}
