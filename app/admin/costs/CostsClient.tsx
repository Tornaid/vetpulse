"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../adminShell.module.css";
import controls from "./costs.module.css";

// ─── Types ────────────────────────────────────────────────

interface StatsPayload {
  timestamp: string;
  organizations: { total: number; active_this_month_approx: number };
  jobs: {
    total_ever: number;
    this_month: number;
    last_24h: number;
    failed_this_month: number;
    success_rate_month: string;
  };
  costs_this_month_usd: {
    transcription: number;
    generation: number;
    regeneration: number;
    reformulation?: number;
    total: number;
  };
}

interface OrgLite {
  id: string;
  name: string;
  is_active: boolean;
  monthly_quota: number | null;
  usage?: {
    jobs_this_month?: number;
    quota_remaining?: number | "unlimited";
  };
}

interface ClinicUsageRow {
  id: string;
  name: string;
  is_active: boolean;
  monthly_quota: number | null;
  jobs: number;
  transcriptionCost: number;
  generationCost: number;
  regenerationCost: number;
  reformulationCost: number;
  totalCost: number;
}

type PricingModel = "per_cr" | "subscription";

// ─── Constantes ───────────────────────────────────────────

const USD_TO_EUR = 0.92;

// ─── Formatage ────────────────────────────────────────────

const fmtEur = (n: number, d = 2): string => `${n.toFixed(d)} €`;
const fmtEurFine = (n: number): string => `${n.toFixed(4)} €`;
const fmtUsd = (n: number, d = 2): string => `$${n.toFixed(d)}`;
const fmtNumber = (n: number): string => n.toLocaleString("fr-FR");
const costUsdToEur = (usd: number): number => usd * USD_TO_EUR;

// ─── LocalStorage helper (simulateur) ─────────────────────

const STORAGE_KEY = "vetpulse.admin.pricing";

interface Pricing {
  model: PricingModel;
  perCrPrice: number;
  subscriptionPrice: number;
  includedCrs: number;
  overagePrice: number;
}

const DEFAULT_PRICING: Pricing = {
  model: "subscription",
  perCrPrice: 1.5,
  subscriptionPrice: 39,
  includedCrs: 200,
  overagePrice: 0.15,
};

function loadPricing(): Pricing {
  if (typeof window === "undefined") return DEFAULT_PRICING;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PRICING;
    return { ...DEFAULT_PRICING, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PRICING;
  }
}

function savePricing(p: Pricing) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* silent */
  }
}

// ─── Calculs ──────────────────────────────────────────────

// (fonction revenuePerClinic supprimée — la simulation est désormais pire cas :
//  chaque clinique consomme l'intégralité de son forfait. Voir calcul dans le composant.)

// ─── Exports ──────────────────────────────────────────────

function escapeCsv(v: unknown): string {
  const s = String(v ?? "");
  if (/[,"\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob(["﻿" + content], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportCsv(rows: ClinicUsageRow[]) {
  const headers = [
    "Clinique",
    "Statut",
    "CR ce mois",
    "Quota mensuel",
    "Coût transcription (€)",
    "Coût génération (€)",
    "Coût régénération (€)",
    "Coût reformulation (€)",
    "Coût total (€)",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        escapeCsv(r.name),
        r.is_active ? "Active" : "Inactive",
        r.jobs,
        r.monthly_quota ?? "Illimité",
        r.transcriptionCost.toFixed(4),
        r.generationCost.toFixed(4),
        r.regenerationCost.toFixed(4),
        r.reformulationCost.toFixed(4),
        r.totalCost.toFixed(4),
      ].join(","),
    );
  }
  const date = new Date().toISOString().split("T")[0];
  downloadFile(`reqvet-couts-${date}.csv`, lines.join("\n"), "text/csv");
}

/**
 * Export XLSX minimaliste — génère un fichier .xlsx valide sans dépendance.
 * Utilise SpreadsheetML 2003 (SylonML), format XML lisible par Excel.
 */
function exportXlsx(rows: ClinicUsageRow[]) {
  const headers = [
    "Clinique",
    "Statut",
    "CR ce mois",
    "Quota mensuel",
    "Coût transcription (€)",
    "Coût génération (€)",
    "Coût régénération (€)",
    "Coût reformulation (€)",
    "Coût total (€)",
  ];

  const escapeXml = (v: string) =>
    v
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const headerRow = `<Row>${headers
    .map(
      (h) =>
        `<Cell ss:StyleID="head"><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`,
    )
    .join("")}</Row>`;

  const dataRows = rows
    .map(
      (r) => `<Row>
      <Cell><Data ss:Type="String">${escapeXml(r.name)}</Data></Cell>
      <Cell><Data ss:Type="String">${r.is_active ? "Active" : "Inactive"}</Data></Cell>
      <Cell><Data ss:Type="Number">${r.jobs}</Data></Cell>
      <Cell><Data ss:Type="${r.monthly_quota == null ? "String" : "Number"}">${r.monthly_quota ?? "Illimité"}</Data></Cell>
      <Cell><Data ss:Type="Number">${r.transcriptionCost.toFixed(4)}</Data></Cell>
      <Cell><Data ss:Type="Number">${r.generationCost.toFixed(4)}</Data></Cell>
      <Cell><Data ss:Type="Number">${r.regenerationCost.toFixed(4)}</Data></Cell>
      <Cell><Data ss:Type="Number">${r.reformulationCost.toFixed(4)}</Data></Cell>
      <Cell><Data ss:Type="Number">${r.totalCost.toFixed(4)}</Data></Cell>
    </Row>`,
    )
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
          xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="head">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#EEF2F0" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="Consommation">
    <Table>
      ${headerRow}
      ${dataRows}
    </Table>
  </Worksheet>
</Workbook>`;

  const date = new Date().toISOString().split("T")[0];
  downloadFile(`reqvet-couts-${date}.xls`, xml, "application/vnd.ms-excel");
}

// ─── Composant ────────────────────────────────────────────

export default function CostsClient() {
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [orgs, setOrgs] = useState<OrgLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pricing, setPricing] = useState<Pricing>(DEFAULT_PRICING);

  useEffect(() => setPricing(loadPricing()), []);
  useEffect(() => savePricing(pricing), [pricing]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, orgsRes] = await Promise.all([
        fetch("/api/admin/stats"),
        fetch("/api/admin/clinics"),
      ]);
      if (!statsRes.ok) throw new Error("Impossible de charger les stats");
      if (!orgsRes.ok) throw new Error("Impossible de charger les cliniques");

      setStats(await statsRes.json());
      const orgsData = await orgsRes.json();
      setOrgs(orgsData.organizations ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ─── Calculs BLOC 1 (réel) ─────────────────────────

  const totalCostUsd = stats?.costs_this_month_usd.total ?? 0;
  const totalCostEur = costUsdToEur(totalCostUsd);
  const totalJobs = stats?.jobs.this_month ?? 0;
  const avgCostPerCr = totalJobs > 0 ? totalCostEur / totalJobs : 0;

  const transcriptionCostEur = stats
    ? costUsdToEur(stats.costs_this_month_usd.transcription)
    : 0;
  const generationCostEur = stats
    ? costUsdToEur(stats.costs_this_month_usd.generation)
    : 0;
  const regenerationCostEur = stats
    ? costUsdToEur(stats.costs_this_month_usd.regeneration)
    : 0;
  const reformulationCostEur = stats
    ? costUsdToEur(stats.costs_this_month_usd.reformulation ?? 0)
    : 0;

  // Répartition proportionnelle par clinique (basée sur le nb de jobs réels)
  const clinicUsageRows: ClinicUsageRow[] = useMemo(() => {
    if (!stats) return [];
    return orgs
      .map((org) => {
        const jobs = org.usage?.jobs_this_month ?? 0;
        const share = totalJobs > 0 ? jobs / totalJobs : 0;
        return {
          id: org.id,
          name: org.name,
          is_active: org.is_active,
          monthly_quota: org.monthly_quota,
          jobs,
          transcriptionCost: transcriptionCostEur * share,
          generationCost: generationCostEur * share,
          regenerationCost: regenerationCostEur * share,
          reformulationCost: reformulationCostEur * share,
          totalCost: totalCostEur * share,
        };
      })
      .sort((a, b) => b.jobs - a.jobs);
  }, [
    orgs,
    stats,
    totalJobs,
    transcriptionCostEur,
    generationCostEur,
    regenerationCostEur,
    reformulationCostEur,
    totalCostEur,
  ]);

  // ─── Calculs BLOC 2 (simulation one-shot pire cas) ──
  //
  // Simulateur d'une offre unique : « si je vends un pack de X CR à Y€,
  // quelle est ma marge MINIMUM si le client consomme tout ? »
  // Base de coût : coût moyen d'un CR calculé au bloc 1 (avgCostPerCr).

  const packRevenue =
    pricing.model === "subscription"
      ? pricing.subscriptionPrice
      : pricing.includedCrs * pricing.perCrPrice;
  const packMaxCost = pricing.includedCrs * avgCostPerCr;
  const packMinMargin = packRevenue - packMaxCost;
  const packMinMarginPct = packRevenue > 0 ? (packMinMargin / packRevenue) * 100 : 0;
  const marginPerCr =
    pricing.includedCrs > 0 ? packMinMargin / pricing.includedCrs : 0;

  // ─── Rendu ─────────────────────────────────────────

  if (loading && !stats) {
    return (
      <div className={styles.section}>
        <div style={{ padding: 40, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
          Chargement des données depuis reqvet-engine…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.section}>
        <div className={controls.errorBox}>
          <p style={{ margin: 0, fontWeight: 600 }}>⚠ Erreur de récupération</p>
          <p style={{ margin: "6px 0 12px", fontSize: 13 }}>{error}</p>
          <button className={controls.btnSecondary} onClick={refresh}>
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ═══════════════════════════════════════════════════ */}
      {/* BLOC 1 — CONSOMMATION RÉELLE                        */}
      {/* ═══════════════════════════════════════════════════ */}

      <div className={controls.blockHeader}>
        <div>
          <span className={controls.blockTag}>Bloc 1</span>
          <h2 className={controls.blockTitle}>Consommation réelle ce mois</h2>
          <p className={controls.blockSubtitle}>
            Données brutes issues de reqvet-engine — coûts fournisseurs (transcription
            + LLM) tels que facturés. Base pour la répartition par clinique et les
            exports comptables.
          </p>
        </div>
        <button className={controls.btnSecondary} onClick={refresh}>
          ↻ Rafraîchir
        </button>
      </div>

      {/* KPIs réels */}
      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Coût pipeline réel</span>
          <span className={styles.kpiValue}>{fmtEur(totalCostEur)}</span>
          <span className={styles.kpiSub}>
            {fmtUsd(totalCostUsd)} · taux 1$ = {USD_TO_EUR}€
          </span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>CR générés ce mois</span>
          <span className={styles.kpiValue}>{fmtNumber(totalJobs)}</span>
          <span className={styles.kpiSub}>
            Success rate {stats?.jobs.success_rate_month ?? "N/A"} ·{" "}
            {stats?.jobs.failed_this_month ?? 0} échec
            {(stats?.jobs.failed_this_month ?? 0) !== 1 ? "s" : ""}
          </span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Coût moyen / CR</span>
          <span className={`${styles.kpiValue} ${styles.kpiAccent}`}>
            {fmtEurFine(avgCostPerCr)}
          </span>
          <span className={styles.kpiSub}>Sert de base au simulateur ↓</span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>CR sur 24h</span>
          <span className={styles.kpiValue}>{fmtNumber(stats?.jobs.last_24h ?? 0)}</span>
          <span className={styles.kpiSub}>
            Total historique : {fmtNumber(stats?.jobs.total_ever ?? 0)}
          </span>
        </div>
      </div>

      {/* Décomposition pipeline */}
      {stats && (
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <div>
              <h2 className={styles.sectionTitle}>Décomposition du coût pipeline</h2>
              <p className={styles.sectionSubtitle}>
                Ventilation par étape de la pipeline sur l&apos;instance reqvet-engine.
              </p>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <BreakdownRow
              label="Transcription"
              sub="Whisper via RunPod / Groq"
              valueEur={transcriptionCostEur}
              totalEur={totalCostEur}
              color="#6366f1"
            />
            <BreakdownRow
              label="Génération"
              sub="LLM initial (OpenAI / Mistral / Anthropic)"
              valueEur={generationCostEur}
              totalEur={totalCostEur}
              color="#f59e0b"
            />
            <BreakdownRow
              label="Régénération"
              sub="Nouvelles instructions sans re-transcrire"
              valueEur={regenerationCostEur}
              totalEur={totalCostEur}
              color="#7c3aed"
            />
            <BreakdownRow
              label="Reformulation"
              sub="Propriétaire, référé, résumé, diagnostic"
              valueEur={reformulationCostEur}
              totalEur={totalCostEur}
              color="#00d17d"
            />
          </div>
        </div>
      )}

      {/* Table cliniques + export */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <h2 className={styles.sectionTitle}>Consommation par clinique</h2>
            <p className={styles.sectionSubtitle}>
              Répartition du coût pipeline proportionnellement au nombre de CR
              générés par chaque clinique. Exportable pour la comptabilité.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className={controls.btnSecondary}
              onClick={() => exportCsv(clinicUsageRows)}
              disabled={clinicUsageRows.length === 0}
            >
              📄 Exporter CSV
            </button>
            <button
              className={controls.btnSecondary}
              onClick={() => exportXlsx(clinicUsageRows)}
              disabled={clinicUsageRows.length === 0}
            >
              📊 Exporter XLSX
            </button>
          </div>
        </div>

        {clinicUsageRows.length === 0 ? (
          <p className={controls.emptyMsg}>
            Aucune consommation ce mois — la table se remplira dès que les cliniques
            généreront des CR.
          </p>
        ) : (
          <div className={controls.tableWrap}>
            <div className={controls.tableHeadReal}>
              <span>Clinique</span>
              <span>CR ce mois</span>
              <span>Transcription</span>
              <span>Génération</span>
              <span>Total réel</span>
            </div>
            {clinicUsageRows.map((row) => (
              <div key={row.id} className={controls.tableRowReal}>
                <div className={controls.cellName}>
                  <span
                    className={row.is_active ? controls.dotActive : controls.dotInactive}
                  />
                  <span>{row.name}</span>
                </div>
                <span className={controls.cellNum}>{fmtNumber(row.jobs)}</span>
                <span className={controls.cellNum}>
                  {fmtEurFine(row.transcriptionCost)}
                </span>
                <span className={controls.cellNum}>
                  {fmtEurFine(row.generationCost)}
                </span>
                <span className={`${controls.cellNum} ${controls.cellStrong}`}>
                  {fmtEurFine(row.totalCost)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════ */}
      {/* BLOC 2 — SIMULATEUR DE RENTABILITÉ                  */}
      {/* ═══════════════════════════════════════════════════ */}

      <div
        className={controls.blockHeader}
        style={{
          marginTop: 40,
          paddingTop: 32,
          borderTop: "2px dashed rgba(0, 209, 125, 0.30)",
        }}
      >
        <div>
          <span className={controls.blockTag}>Bloc 2</span>
          <h2 className={controls.blockTitle}>Simulateur de rentabilité par clinique</h2>
          <p className={controls.blockSubtitle}>
            Basé sur le coût moyen réel de <strong>{fmtEurFine(avgCostPerCr)}</strong>{" "}
            par CR calculé au-dessus. Ajustez votre grille tarifaire — la marge se
            recalcule instantanément sur toutes vos cliniques.
          </p>
        </div>
      </div>

      <div className={styles.section}>
        {/* Toggle modèle */}
        <div className={controls.modelToggle}>
          <button
            className={`${controls.modelTab} ${pricing.model === "per_cr" ? controls.modelTabActive : ""}`}
            onClick={() => setPricing({ ...pricing, model: "per_cr" })}
          >
            💵 Prix par CR - Pay as you go
          </button>
          <button
            className={`${controls.modelTab} ${pricing.model === "subscription" ? controls.modelTabActive : ""}`}
            onClick={() => setPricing({ ...pricing, model: "subscription" })}
          >
            📅 Abonnement mensuel ou pack
          </button>
        </div>

        {/* Contrôles */}
        {pricing.model === "per_cr" ? (
          <div className={controls.controls}>
            <div className={controls.field}>
              <label>Prix par compte rendu généré</label>
              <div className={controls.inputWithSuffix}>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  value={pricing.perCrPrice}
                  onChange={(e) =>
                    setPricing({ ...pricing, perCrPrice: Number(e.target.value) || 0 })
                  }
                />
                <span>€ / CR</span>
              </div>
              <span className={controls.hint}>
                Facturation à l&apos;usage — simple, transparent pour la clinique.
              </span>
            </div>
          </div>
        ) : (
          <div className={controls.controls}>
            <div className={controls.field}>
              <label>Prix de l&apos;abonnement mensuel</label>
              <div className={controls.inputWithSuffix}>
                <input
                  type="number"
                  step={1}
                  min={0}
                  value={pricing.subscriptionPrice}
                  onChange={(e) =>
                    setPricing({
                      ...pricing,
                      subscriptionPrice: Number(e.target.value) || 0,
                    })
                  }
                />
                <span>€ / mois</span>
              </div>
            </div>

            <div className={controls.field}>
              <label>CR inclus / mois</label>
              <div className={controls.inputWithSuffix}>
                <input
                  type="number"
                  step={10}
                  min={0}
                  value={pricing.includedCrs}
                  onChange={(e) =>
                    setPricing({ ...pricing, includedCrs: Number(e.target.value) || 0 })
                  }
                />
                <span>CR</span>
              </div>
            </div>

            <div className={controls.field}>
              <label>Prix par CR supplémentaire</label>
              <div className={controls.inputWithSuffix}>
                <input
                  type="number"
                  step={0.01}
                  min={0}
                  value={pricing.overagePrice}
                  onChange={(e) =>
                    setPricing({
                      ...pricing,
                      overagePrice: Number(e.target.value) || 0,
                    })
                  }
                />
                <span>€ / CR au-delà</span>
              </div>
              <span className={controls.hint}>
                Facturé pour chaque CR au-delà du forfait.
              </span>
            </div>
          </div>
        )}

        {/* Résumé one-shot */}
        <div className={controls.summary}>
          {pricing.model === "per_cr" ? (
            <p>
              Grille : <strong>{fmtEur(pricing.perCrPrice)}</strong> par CR généré ·
              coût moyen réel <strong>{fmtEurFine(avgCostPerCr)}</strong> par CR.
              <br />
              Marge <strong>par CR généré</strong> ={" "}
              <strong
                style={{
                  color:
                    pricing.perCrPrice - avgCostPerCr >= 0 ? "#065f46" : "#dc2626",
                }}
              >
                {fmtEur(pricing.perCrPrice - avgCostPerCr)}
              </strong>
              {pricing.perCrPrice > 0 &&
                ` · ${Math.round(((pricing.perCrPrice - avgCostPerCr) / pricing.perCrPrice) * 100)}% de marge brute`}
              .
            </p>
          ) : (
            <p>
              Pack : <strong>{pricing.includedCrs} CR à {fmtEur(pricing.subscriptionPrice)}</strong>.
              Si la clinique <strong>consomme tout son forfait</strong>{" "}
              ({pricing.includedCrs} × {fmtEurFine(avgCostPerCr)}) : coût max ={" "}
              <strong>{fmtEur(packMaxCost)}</strong> · marge <strong>MINIMUM</strong>{" "}
              par pack ={" "}
              <strong
                style={{
                  color: packMinMargin >= 0 ? "#065f46" : "#dc2626",
                }}
              >
                {fmtEur(packMinMargin)}
              </strong>{" "}
              ({packMinMarginPct.toFixed(0)}%). En pratique, la marge réelle sera
              supérieure — les cliniques consomment souvent moins que leur quota.
            </p>
          )}
        </div>
      </div>

      {/* KPI one-shot */}
      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Revenu par pack</span>
          <span className={`${styles.kpiValue} ${styles.kpiAccent}`}>
            {fmtEur(packRevenue)}
          </span>
          <span className={styles.kpiSub}>
            {pricing.model === "subscription"
              ? `Prix de l'abonnement pour ${pricing.includedCrs} CR inclus`
              : `${pricing.includedCrs} CR × ${fmtEur(pricing.perCrPrice)}`}
          </span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Coût pire cas</span>
          <span className={styles.kpiValue}>{fmtEur(packMaxCost)}</span>
          <span className={styles.kpiSub}>
            Si les {pricing.includedCrs} CR sont tous consommés
          </span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Marge MIN par pack</span>
          <span
            className={
              packMinMargin >= 0
                ? `${styles.kpiValue} ${styles.kpiAccent}`
                : `${styles.kpiValue} ${styles.kpiDanger}`
            }
          >
            {fmtEur(packMinMargin)}
          </span>
          <span className={styles.kpiSub}>
            {packMinMarginPct.toFixed(0)}% de marge brute
          </span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Marge par CR</span>
          <span
            className={
              marginPerCr >= 0
                ? `${styles.kpiValue} ${styles.kpiAccent}`
                : `${styles.kpiValue} ${styles.kpiDanger}`
            }
          >
            {fmtEurFine(marginPerCr)}
          </span>
          <span className={styles.kpiSub}>
            Ce que vous gagnez à chaque CR généré
          </span>
        </div>
      </div>

      {stats && (
        <p
          style={{
            fontSize: 11.5,
            color: "#9ca3af",
            textAlign: "right",
            marginTop: 12,
          }}
        >
          Dernière mise à jour : {new Date(stats.timestamp).toLocaleString("fr-FR")}
        </p>
      )}
    </>
  );
}

// ─── Row helper ──────────────────────────────────────────

function BreakdownRow({
  label,
  sub,
  valueEur,
  totalEur,
  color,
}: {
  label: string;
  sub: string;
  valueEur: number;
  totalEur: number;
  color: string;
}) {
  const percentage = totalEur > 0 ? Math.round((valueEur / totalEur) * 100) : 0;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "12px 16px",
        background: "#f9fafb",
        border: "1px solid rgba(0,0,0,0.06)",
        borderRadius: 12,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>{label}</div>
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{sub}</div>
      </div>

      <div
        style={{
          width: 200,
          height: 10,
          background: "#e5e7eb",
          borderRadius: 5,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${percentage}%`,
            height: "100%",
            background: color,
            transition: "width 300ms ease",
          }}
        />
      </div>

      <div
        style={{
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 13,
          fontWeight: 700,
          color: color,
          minWidth: 96,
          textAlign: "right",
        }}
      >
        {fmtEurFine(valueEur)}
      </div>

      <div
        style={{
          fontSize: 12,
          color: "#6b7280",
          minWidth: 40,
          textAlign: "right",
        }}
      >
        {percentage}%
      </div>
    </div>
  );
}
