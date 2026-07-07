// app/admin/templates/page.tsx — Templates système globaux
import styles from "../adminShell.module.css";
import TemplatesClient from "./TemplatesClient";

export const dynamic = "force-dynamic";

export default function AdminTemplatesPage() {
  const isConfigured = !!process.env.REQVET_ADMIN_SECRET;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Templates globaux</h1>
        <p className={styles.pageSubtitle}>
          Gérez les templates de compte rendu visibles par <strong>toutes vos cliniques</strong>.
          Créés ici → automatiquement disponibles dans chaque instance clinique via <code>reqvet.listTemplates()</code>.
        </p>
      </header>

      {!isConfigured ? (
        <div className={styles.section}>
          <div style={{ padding: 40, textAlign: "center" }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: "#111827", margin: "0 0 8px" }}>
              REQVET_ADMIN_SECRET manquant
            </p>
            <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 4px" }}>
              La gestion des templates système nécessite l&apos;ADMIN_SECRET root de l&apos;engine.
            </p>
            <p style={{ fontSize: 12, color: "#9ca3af", fontFamily: "var(--font-mono, monospace)", marginTop: 8 }}>
              Ajoutez REQVET_ADMIN_SECRET dans .env.local
            </p>
          </div>
        </div>
      ) : (
        <TemplatesClient />
      )}
    </div>
  );
}
