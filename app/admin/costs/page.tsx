// app/admin/costs/page.tsx
import styles from "../adminShell.module.css";
import CostsClient from "./CostsClient";

export const dynamic = "force-dynamic";

export default function AdminCostsPage() {
  const isConfigured = !!process.env.REQVET_ADMIN_SECRET;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Coûts pipeline & revenu</h1>
        <p className={styles.pageSubtitle}>
          Décomposition des coûts réels du mois (transcription, génération, régénération)
          face au revenu potentiel selon votre grille de prix. Base pour votre refacturation
          aux cliniques.
        </p>
      </header>

      {!isConfigured ? (
        <div className={styles.section}>
          <div style={{ padding: 40, textAlign: "center" }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: "#111827", margin: "0 0 8px" }}>
              REQVET_ADMIN_SECRET manquant
            </p>
            <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 4px" }}>
              Le dashboard coûts nécessite l&apos;ADMIN_SECRET root de l&apos;engine.
            </p>
            <p style={{ fontSize: 12, color: "#9ca3af", fontFamily: "var(--font-mono, monospace)", marginTop: 8 }}>
              Ajoutez REQVET_ADMIN_SECRET dans .env.local
            </p>
          </div>
        </div>
      ) : (
        <CostsClient />
      )}
    </div>
  );
}
