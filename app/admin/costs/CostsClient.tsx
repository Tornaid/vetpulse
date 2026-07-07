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

// ─── Constantes ───────────────────────────────────────────

const USD_TO_EUR = 0.92;
const FALLBACK_COST_PER_CR = 0.04; // €, si aucun CR généré ce mois

// ─── Formatage ────────────────────────────────────────────

const fmtEur = (n: number, d = 2): string => `${n.toFixed(d)} €`;
const fmtEurFine = (n: number): string => `${n.toFixed(4)} €`;
const fmtUsd = (n: number, d = 2): string => `$${n.toFixed(d)}`;
const fmtNumber = (n: number): string => n.toLocaleString("fr-FR");
const costUsdToEur = (usd: number): number => usd * USD_TO_EUR;

// ─── LocalStorage helper (simulateur) ─────────────────────

const STORAGE_KEY = "vetpulse.admin.pricing.v2";

type ProjectionModel = "pack" | "payg";

interface Pricing {
  // Coût fournisseur — sync avec Bloc 1 par défaut, éditable
  costPerCr: number;
  // Pack forfaitaire
  packSize: number;      // nb CR inclus par pack
  packPrice: number;     // € / mois
  // Pay-as-you-go
  payAsYouGoPrice: number; // € / CR facturé
  // Projection multi-cliniques
  nbClinics: number;
  projectionModel: ProjectionModel; // scénario retenu pour le ROI
  investment: number;      // € — cession + setup + dev
  // Opex (hébergement, monitoring, support, maintenance, salaires ops…)
  // exprimé en % de la marge BRUTE — 20 % = SaaS lean typique
  opexPct: number;
}

const DEFAULT_PRICING: Pricing = {
  costPerCr: FALLBACK_COST_PER_CR,
  packSize: 200,
  packPrice: 20,
  payAsYouGoPrice: 0.15,
  nbClinics: 50,
  projectionModel: "pack",
  investment: 60000,
  opexPct: 20,
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

  // ─── Auto-sync du coût / CR sur le Bloc 1 (une seule fois) ──
  // Si le Bloc 1 a des données réelles (avgCostPerCr > 0) et que le user
  // n'a pas encore modifié la valeur (encore au fallback 0,04 €),
  // on synchronise automatiquement.
  useEffect(() => {
    if (avgCostPerCr > 0 && pricing.costPerCr === FALLBACK_COST_PER_CR) {
      setPricing((p) => ({ ...p, costPerCr: avgCostPerCr }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avgCostPerCr]);

  // ─── Calculs BLOC 2A — Rentabilité par clinique ────────────
  //
  // Comparaison PACK vs PAY-AS-YOU-GO à consommation identique
  // (packSize CR/mois par clinique — hypothèse pire cas côté pack).

  // Pack — coût max si la clinique consomme tout son forfait
  const packRevenue = pricing.packPrice;
  const packMaxCost = pricing.packSize * pricing.costPerCr;
  const packMinMargin = packRevenue - packMaxCost;
  const packMinMarginPct = packRevenue > 0 ? (packMinMargin / packRevenue) * 100 : 0;
  const packMarginPerCr = pricing.packSize > 0 ? packMinMargin / pricing.packSize : 0;

  // Pay-as-you-go — à consommation équivalente (packSize CR)
  const paygRevenueEquiv = pricing.packSize * pricing.payAsYouGoPrice;
  const paygCostEquiv = pricing.packSize * pricing.costPerCr;
  const paygMarginEquiv = paygRevenueEquiv - paygCostEquiv;
  const paygMarginPct =
    paygRevenueEquiv > 0 ? (paygMarginEquiv / paygRevenueEquiv) * 100 : 0;
  const paygMarginPerCr = pricing.payAsYouGoPrice - pricing.costPerCr;

  // ─── Calculs BLOC 2B — Projection multi-cliniques ──────────
  //
  // Un seul modèle appliqué à toutes les cliniques (choix explicite via toggle) :
  //   Pack  : nbClinics × packPrice                          (revenu fixe)
  //   PAYG  : nbClinics × packSize × payAsYouGoPrice        (à volume packSize)
  // Coût   : nbClinics × packSize × costPerCr

  const monthlyRevenue =
    pricing.projectionModel === "pack"
      ? pricing.nbClinics * pricing.packPrice
      : pricing.nbClinics * pricing.packSize * pricing.payAsYouGoPrice;

  const monthlyCost = pricing.nbClinics * pricing.packSize * pricing.costPerCr;
  const monthlyMargin = monthlyRevenue - monthlyCost;
  const monthlyMarginPct = monthlyRevenue > 0 ? (monthlyMargin / monthlyRevenue) * 100 : 0;
  const yearlyMargin = monthlyMargin * 12;

  // ─── Marge nette : marge brute − opex estimés ────────────
  // Opex = hébergement, monitoring, Sentry, support niveau 1/2,
  // maintenance dev, on-call, comptabilité, part fixe salaires ops.
  // Exprimé en % de la marge brute (approximation lean).
  const monthlyOpex = monthlyMargin * (pricing.opexPct / 100);
  const monthlyMarginNet = monthlyMargin - monthlyOpex;
  const monthlyMarginNetPct =
    monthlyRevenue > 0 ? (monthlyMarginNet / monthlyRevenue) * 100 : 0;
  const yearlyMarginNet = monthlyMarginNet * 12;

  // Le ROI se base sur la marge NETTE — c'est le cash réellement dispo
  // pour rembourser l'investissement initial.
  const roiMonths = monthlyMarginNet > 0 ? pricing.investment / monthlyMarginNet : null;

  const projectionLabel =
    pricing.projectionModel === "pack"
      ? `Pack ${pricing.packSize} CR à ${fmtEur(pricing.packPrice)}`
      : `Pay-as-you-go à ${fmtEur(pricing.payAsYouGoPrice)}/CR`;

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
      {/* BLOC 2A — RENTABILITÉ PAR CLINIQUE (comparaison)     */}
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
          <h2 className={controls.blockTitle}>Rentabilité par clinique — Pack vs Pay-as-you-go</h2>
          <p className={controls.blockSubtitle}>
            Comparez la marge d&apos;un pack forfaitaire (ex. 200 CR à 20 €) avec une
            facturation à l&apos;usage, à volume identique. Toutes les valeurs sont
            éditables — la simulation se met à jour instantanément.
          </p>
        </div>
      </div>

      <div className={styles.section}>
        {/* Coût moyen fournisseur — commun aux deux modèles */}
        <div className={controls.controls} style={{ marginBottom: 24 }}>
          <div className={controls.field}>
            <label>Coût moyen fournisseur par CR</label>
            <div className={controls.inputWithSuffix}>
              <input
                type="number"
                step={0.001}
                min={0}
                value={pricing.costPerCr}
                onChange={(e) =>
                  setPricing({ ...pricing, costPerCr: Number(e.target.value) || 0 })
                }
              />
              <span>€ / CR</span>
            </div>
            <span className={controls.hint}>
              {avgCostPerCr > 0
                ? `Synchronisé auto sur le Bloc 1 (${fmtEurFine(avgCostPerCr)}). Modifiable.`
                : `Défaut ${fmtEurFine(FALLBACK_COST_PER_CR)} — pas encore de CR ce mois pour calibrer.`}
            </span>
          </div>
        </div>

        {/* Comparaison Pack vs PAYG */}
        <div className={controls.comparison}>
          {/* ─── Colonne PACK ─── */}
          <div className={controls.comparisonCard}>
            <div className={controls.comparisonHead}>
              <span className={controls.comparisonBadge}>📦 Pack forfaitaire</span>
              <h3>Prix fixe mensuel · nb CR inclus</h3>
            </div>

            <div className={controls.controls}>
              <div className={controls.field}>
                <label>CR inclus / mois</label>
                <div className={controls.inputWithSuffix}>
                  <input
                    type="number"
                    step={10}
                    min={0}
                    value={pricing.packSize}
                    onChange={(e) =>
                      setPricing({ ...pricing, packSize: Number(e.target.value) || 0 })
                    }
                  />
                  <span>CR</span>
                </div>
              </div>
              <div className={controls.field}>
                <label>Prix du pack</label>
                <div className={controls.inputWithSuffix}>
                  <input
                    type="number"
                    step={1}
                    min={0}
                    value={pricing.packPrice}
                    onChange={(e) =>
                      setPricing({ ...pricing, packPrice: Number(e.target.value) || 0 })
                    }
                  />
                  <span>€ / mois</span>
                </div>
              </div>
            </div>

            <div className={controls.comparisonResults}>
              <div className={controls.resultRow}>
                <span>Revenu par clinique</span>
                <strong>{fmtEur(packRevenue)}</strong>
              </div>
              <div className={controls.resultRow}>
                <span>Coût max (pack consommé)</span>
                <strong>{fmtEur(packMaxCost)}</strong>
              </div>
              <div className={controls.resultRow} data-highlight>
                <span>Marge minimum</span>
                <strong style={{ color: packMinMargin >= 0 ? "#065f46" : "#dc2626" }}>
                  {fmtEur(packMinMargin)}
                  <span className={controls.resultPct}>
                    · {packMinMarginPct.toFixed(0)}%
                  </span>
                </strong>
              </div>
              <div className={controls.resultRow}>
                <span>Marge min par CR</span>
                <strong style={{ color: packMarginPerCr >= 0 ? "#065f46" : "#dc2626" }}>
                  {fmtEurFine(packMarginPerCr)}
                </strong>
              </div>
            </div>
            <p className={controls.comparisonNote}>
              🎯 Marge <strong>garantie minimum</strong> — si la clinique consomme moins,
              elle est meilleure. Modèle prévisible côté trésorerie.
            </p>
          </div>

          {/* ─── Colonne PAYG ─── */}
          <div className={controls.comparisonCard}>
            <div className={controls.comparisonHead}>
              <span className={controls.comparisonBadge}>💰 Pay-as-you-go</span>
              <h3>Facturation à l&apos;usage · par CR généré</h3>
            </div>

            <div className={controls.controls}>
              <div className={controls.field}>
                <label>Prix par CR facturé</label>
                <div className={controls.inputWithSuffix}>
                  <input
                    type="number"
                    step={0.01}
                    min={0}
                    value={pricing.payAsYouGoPrice}
                    onChange={(e) =>
                      setPricing({
                        ...pricing,
                        payAsYouGoPrice: Number(e.target.value) || 0,
                      })
                    }
                  />
                  <span>€ / CR</span>
                </div>
                <span className={controls.hint}>
                  Simulation à volume identique ({pricing.packSize} CR/mois) pour comparaison.
                </span>
              </div>
            </div>

            <div className={controls.comparisonResults}>
              <div className={controls.resultRow}>
                <span>Revenu par clinique ({pricing.packSize} CR)</span>
                <strong>{fmtEur(paygRevenueEquiv)}</strong>
              </div>
              <div className={controls.resultRow}>
                <span>Coût fournisseur ({pricing.packSize} CR)</span>
                <strong>{fmtEur(paygCostEquiv)}</strong>
              </div>
              <div className={controls.resultRow} data-highlight>
                <span>Marge à volume équivalent</span>
                <strong style={{ color: paygMarginEquiv >= 0 ? "#065f46" : "#dc2626" }}>
                  {fmtEur(paygMarginEquiv)}
                  <span className={controls.resultPct}>
                    · {paygMarginPct.toFixed(0)}%
                  </span>
                </strong>
              </div>
              <div className={controls.resultRow}>
                <span>Marge par CR</span>
                <strong style={{ color: paygMarginPerCr >= 0 ? "#065f46" : "#dc2626" }}>
                  {fmtEurFine(paygMarginPerCr)}
                </strong>
              </div>
            </div>
            <p className={controls.comparisonNote}>
              📈 Marge <strong>proportionnelle</strong> — plus la clinique génère, plus le
              revenu monte. Aucun risque de sur-consommation.
            </p>
          </div>
        </div>

        {/* Verdict de comparaison */}
        <div className={controls.summary} style={{ marginTop: 20 }}>
          <p>
            À consommation identique de <strong>{pricing.packSize} CR/mois</strong> par
            clinique, le modèle <strong>Pack</strong> génère{" "}
            <strong style={{ color: packMinMargin >= 0 ? "#065f46" : "#dc2626" }}>
              {fmtEur(packMinMargin)}
            </strong>{" "}
            de marge et le modèle <strong>Pay-as-you-go</strong>{" "}
            <strong style={{ color: paygMarginEquiv >= 0 ? "#065f46" : "#dc2626" }}>
              {fmtEur(paygMarginEquiv)}
            </strong>
            .{" "}
            {packMinMargin > paygMarginEquiv
              ? "Le Pack est plus rentable à ce volume — préconisez-le en priorité."
              : paygMarginEquiv > packMinMargin
                ? "Le Pay-as-you-go est plus rentable à ce volume — utile pour les cliniques à forte consommation."
                : "Les deux modèles sont équivalents à ce volume."}
          </p>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════ */}
      {/* BLOC 2B — PROJECTION MULTI-CLINIQUES & ROI          */}
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
          <span className={controls.blockTag}>Bloc 3</span>
          <h2 className={controls.blockTitle}>Projection multi-cliniques &amp; ROI</h2>
          <p className={controls.blockSubtitle}>
            Vision haut niveau : ajustez le nombre de cliniques et la répartition
            Pack / Pay-as-you-go pour projeter le CA mensuel, la marge brute annuelle,
            et le temps de retour sur investissement.
          </p>
        </div>
      </div>

      <div className={styles.section}>
        {/* Toggle scénario : soit Pack pour tous, soit PAYG pour tous */}
        <div className={controls.modelToggle} style={{ marginBottom: 24 }}>
          <button
            className={`${controls.modelTab} ${pricing.projectionModel === "pack" ? controls.modelTabActive : ""}`}
            onClick={() => setPricing({ ...pricing, projectionModel: "pack" })}
          >
            📦 Scénario Pack forfaitaire
          </button>
          <button
            className={`${controls.modelTab} ${pricing.projectionModel === "payg" ? controls.modelTabActive : ""}`}
            onClick={() => setPricing({ ...pricing, projectionModel: "payg" })}
          >
            💰 Scénario Pay-as-you-go
          </button>
        </div>

        <div className={controls.controls}>
          <div className={controls.field}>
            <label>Nombre de cliniques clientes</label>
            <div className={controls.inputWithSuffix}>
              <input
                type="number"
                step={1}
                min={0}
                value={pricing.nbClinics}
                onChange={(e) =>
                  setPricing({ ...pricing, nbClinics: Number(e.target.value) || 0 })
                }
              />
              <span>cliniques</span>
            </div>
            <span className={controls.hint}>
              Toutes sous le modèle <strong>{projectionLabel}</strong>
            </span>
          </div>

          <div className={controls.field}>
            <label>Investissement initial</label>
            <div className={controls.inputWithSuffix}>
              <input
                type="number"
                step={1000}
                min={0}
                value={pricing.investment}
                onChange={(e) =>
                  setPricing({ ...pricing, investment: Number(e.target.value) || 0 })
                }
              />
              <span>€</span>
            </div>
            <span className={controls.hint}>
              Cession reqvet-engine + setup infra + dev intégration
            </span>
          </div>

          <div className={controls.field}>
            <label>Opex estimés (% marge brute)</label>
            <div className={controls.inputWithSuffix}>
              <input
                type="number"
                step={5}
                min={0}
                max={100}
                value={pricing.opexPct}
                onChange={(e) =>
                  setPricing({
                    ...pricing,
                    opexPct: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                  })
                }
              />
              <span>%</span>
            </div>
            <span className={controls.hint}>
              Hébergement, monitoring, support, maintenance, on-call…
              20&nbsp;% = SaaS lean typique.
            </span>
          </div>
        </div>

        {/* KPIs de projection */}
        <div className={styles.kpiGrid}>
          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>CA mensuel</span>
            <span className={`${styles.kpiValue} ${styles.kpiAccent}`}>
              {fmtEur(monthlyRevenue)}
            </span>
            <span className={styles.kpiSub}>
              {pricing.projectionModel === "pack"
                ? `${pricing.nbClinics} × ${fmtEur(pricing.packPrice)} / mois`
                : `${fmtNumber(pricing.nbClinics * pricing.packSize)} CR × ${fmtEur(pricing.payAsYouGoPrice)}`}
            </span>
          </div>

          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>Coût fournisseurs mensuel</span>
            <span className={styles.kpiValue}>{fmtEur(monthlyCost)}</span>
            <span className={styles.kpiSub}>
              {fmtNumber(pricing.nbClinics * pricing.packSize)} CR × {fmtEurFine(pricing.costPerCr)}
            </span>
          </div>

          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>Marge brute mensuelle</span>
            <span
              className={
                monthlyMargin >= 0
                  ? `${styles.kpiValue} ${styles.kpiAccent}`
                  : `${styles.kpiValue} ${styles.kpiDanger}`
              }
            >
              {fmtEur(monthlyMargin)}
            </span>
            <span className={styles.kpiSub}>
              {monthlyMarginPct.toFixed(0)}% · annuel {fmtEur(yearlyMargin)}
            </span>
          </div>

          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>
              Marge nette mensuelle
              <span className={controls.opexTag}>opex {pricing.opexPct}%</span>
            </span>
            <span
              className={
                monthlyMarginNet >= 0
                  ? `${styles.kpiValue} ${styles.kpiAccent}`
                  : `${styles.kpiValue} ${styles.kpiDanger}`
              }
            >
              {fmtEur(monthlyMarginNet)}
            </span>
            <span className={styles.kpiSub}>
              {monthlyMarginNetPct.toFixed(0)}% · annuel {fmtEur(yearlyMarginNet)}
            </span>
          </div>

          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>Retour sur investissement</span>
            <span
              className={
                roiMonths !== null && roiMonths > 0
                  ? `${styles.kpiValue} ${styles.kpiAccent}`
                  : `${styles.kpiValue} ${styles.kpiDanger}`
              }
            >
              {roiMonths !== null
                ? roiMonths < 1
                  ? `< 1 mois`
                  : roiMonths < 24
                    ? `${roiMonths.toFixed(1)} mois`
                    : `${(roiMonths / 12).toFixed(1)} ans`
                : "—"}
            </span>
            <span className={styles.kpiSub}>
              {roiMonths !== null
                ? `${fmtEur(pricing.investment)} ÷ marge nette mensuelle`
                : "Marge nette négative — pas de ROI possible"}
            </span>
          </div>
        </div>

        {/* Verdict projection */}
        {monthlyMarginNet > 0 && roiMonths !== null && (
          <div className={controls.summary} style={{ marginTop: 20 }}>
            <p>
              Scénario <strong>{projectionLabel}</strong> appliqué à{" "}
              <strong>{pricing.nbClinics} cliniques</strong> : CA mensuel{" "}
              <strong>{fmtEur(monthlyRevenue)}</strong>, marge brute annuelle{" "}
              <strong>{fmtEur(yearlyMargin)}</strong>, marge nette annuelle{" "}
              <strong>{fmtEur(yearlyMarginNet)}</strong> (après {pricing.opexPct}&nbsp;% d&apos;opex).
              L&apos;investissement de <strong>{fmtEur(pricing.investment)}</strong> est
              rentabilisé en{" "}
              <strong>
                {roiMonths < 12
                  ? `${roiMonths.toFixed(1)} mois`
                  : `${(roiMonths / 12).toFixed(1)} années`}
              </strong>{" "}
              (sur marge nette).
            </p>
          </div>
        )}
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
