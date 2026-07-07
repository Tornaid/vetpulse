// app/admin/layout.tsx — Shell admin (sidebar + main)
import AdminSidebar from "./AdminSidebar";
import styles from "./adminShell.module.css";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const isConfigured = !!process.env.REQVET_RESELLER_API_KEY;

  if (!isConfigured) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          gap: 12,
          color: "#374151",
          fontFamily: "var(--font-sans, sans-serif)",
        }}
      >
        <p style={{ fontSize: 15, fontWeight: 600, color: "#111827" }}>
          Accès admin non disponible
        </p>
        <p style={{ fontSize: 13, color: "#6b7280" }}>
          Cette instance Vetpulse n&apos;est pas configurée avec une clé revendeur.
        </p>
        <p
          style={{
            fontSize: 12,
            color: "#9ca3af",
            fontFamily: "var(--font-mono, monospace)",
          }}
        >
          Ajoutez REQVET_RESELLER_API_KEY dans .env.local
        </p>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <AdminSidebar />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
