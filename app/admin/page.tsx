// app/admin/page.tsx — Dashboard reseller DrVeto
import { ClinicDashboard } from "./ClinicDashboard";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  const isConfigured = !!process.env.REQVET_RESELLER_API_KEY;

  if (!isConfigured) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        gap: "12px",
        color: "var(--text-secondary)",
        fontFamily: "var(--font-sans)",
      }}>
        <p style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)" }}>
          Acces admin non disponible
        </p>
        <p style={{ fontSize: "13px" }}>
          Cette instance Vetpulse n&apos;est pas configuree avec une cle reseller.
        </p>
        <p style={{ fontSize: "12px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          Ajoutez REQVET_RESELLER_API_KEY dans .env.local
        </p>
      </div>
    );
  }

  return <ClinicDashboard />;
}
