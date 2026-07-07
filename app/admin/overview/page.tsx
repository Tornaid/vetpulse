// app/admin/overview/page.tsx — KPI dashboard admin
import { getResellerClient } from "@/lib/reqvet-admin";
import styles from "../adminShell.module.css";
import OverviewClient from "./OverviewClient";

export const dynamic = "force-dynamic";

interface OrgLite {
  id: string;
  name: string;
  is_active: boolean;
  monthly_quota: number | null;
  created_at: string;
  usage?: {
    jobs_this_month?: number;
    quota_remaining?: number | "unlimited";
  };
}

export default async function OverviewPage() {
  const reseller = getResellerClient();

  let organizations: OrgLite[] = [];
  let fetchError: string | null = null;

  try {
    const result = await reseller.listOrganizations();
    organizations = (result.organizations ?? []) as OrgLite[];
  } catch (err) {
    fetchError = err instanceof Error ? err.message : "Erreur de récupération";
  }

  // ─── Agrégations ─────────────────────────────────────

  const totalClinics = organizations.length;
  const activeClinics = organizations.filter((o) => o.is_active).length;
  const inactiveClinics = totalClinics - activeClinics;

  const jobsThisMonth = organizations.reduce(
    (sum, o) => sum + (o.usage?.jobs_this_month ?? 0),
    0,
  );

  const totalQuota = organizations.reduce(
    (sum, o) => sum + (o.monthly_quota ?? 0),
    0,
  );

  const quotaUsagePct =
    totalQuota > 0 ? Math.round((jobsThisMonth / totalQuota) * 100) : 0;

  // Clinique proche de son quota (>= 80%)
  const alertClinics = organizations.filter((o) => {
    if (!o.monthly_quota || !o.usage?.jobs_this_month) return false;
    const pct = (o.usage.jobs_this_month / o.monthly_quota) * 100;
    return pct >= 80;
  });

  // Top 5 par usage
  const topByUsage = [...organizations]
    .filter((o) => (o.usage?.jobs_this_month ?? 0) > 0)
    .sort(
      (a, b) => (b.usage?.jobs_this_month ?? 0) - (a.usage?.jobs_this_month ?? 0),
    )
    .slice(0, 5);

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Vue d&apos;ensemble</h1>
        <p className={styles.pageSubtitle}>
          Situation en temps réel de vos cliniques provisionnées.
          Les données proviennent de reqvet-engine via l&apos;API revendeur.
        </p>
      </header>

      {fetchError && (
        <div
          style={{
            padding: "14px 18px",
            background: "#fef2f2",
            border: "1px solid rgba(220,38,38,0.25)",
            borderRadius: 12,
            color: "#991b1b",
            fontSize: 13,
            marginBottom: 20,
          }}
        >
          ⚠ Impossible de récupérer les données : {fetchError}
        </div>
      )}

      {/* KPI cards */}
      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Cliniques actives</span>
          <span className={styles.kpiValue}>{activeClinics}</span>
          <span className={styles.kpiSub}>
            sur {totalClinics} provisionnées
            {inactiveClinics > 0 && ` · ${inactiveClinics} suspendues`}
          </span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Jobs ce mois</span>
          <span className={`${styles.kpiValue} ${styles.kpiAccent}`}>
            {jobsThisMonth.toLocaleString("fr-FR")}
          </span>
          <span className={styles.kpiSub}>
            {jobsThisMonth === 0
              ? "Aucun job encore"
              : `Moyenne ${Math.round(jobsThisMonth / Math.max(activeClinics, 1))} / clinique`}
          </span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Quota utilisé</span>
          <span
            className={
              quotaUsagePct >= 80
                ? `${styles.kpiValue} ${styles.kpiWarn}`
                : `${styles.kpiValue}`
            }
          >
            {quotaUsagePct}%
          </span>
          <span className={styles.kpiSub}>
            {jobsThisMonth.toLocaleString("fr-FR")} /{" "}
            {totalQuota.toLocaleString("fr-FR")} jobs
          </span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Alertes quota</span>
          <span
            className={
              alertClinics.length > 0
                ? `${styles.kpiValue} ${styles.kpiDanger}`
                : styles.kpiValue
            }
          >
            {alertClinics.length}
          </span>
          <span className={styles.kpiSub}>
            {alertClinics.length === 0
              ? "Aucune clinique en zone rouge"
              : `Cliniques à ≥ 80% du quota`}
          </span>
        </div>
      </div>

      {/* Top usage clinique */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <h2 className={styles.sectionTitle}>Top 5 cliniques — usage ce mois</h2>
            <p className={styles.sectionSubtitle}>
              Classement par nombre de jobs générés dans le mois courant.
            </p>
          </div>
        </div>

        {topByUsage.length === 0 ? (
          <p style={{ fontSize: 13, color: "#9ca3af", fontStyle: "italic", margin: 0 }}>
            Aucune activité ce mois. Les jobs apparaîtront ici dès qu&apos;une clinique
            commencera à générer des comptes rendus.
          </p>
        ) : (
          <OverviewClient rows={topByUsage} />
        )}
      </div>

      {/* Cliniques en alerte */}
      {alertClinics.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <div>
              <h2 className={styles.sectionTitle}>
                ⚠ Cliniques proches de leur quota
              </h2>
              <p className={styles.sectionSubtitle}>
                Ces cliniques ont atteint au moins 80% de leur quota mensuel.
                Contactez-les pour ajuster leur plan.
              </p>
            </div>
          </div>

          <OverviewClient rows={alertClinics} highlight />
        </div>
      )}
    </div>
  );
}
