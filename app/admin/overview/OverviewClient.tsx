"use client";

import Link from "next/link";

interface Row {
  id: string;
  name: string;
  monthly_quota: number | null;
  usage?: {
    jobs_this_month?: number;
  };
}

export default function OverviewClient({
  rows,
  highlight,
}: {
  rows: Row[];
  highlight?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((row) => {
        const jobs = row.usage?.jobs_this_month ?? 0;
        const quota = row.monthly_quota;
        const pct = quota && quota > 0 ? Math.round((jobs / quota) * 100) : 0;
        const barColor =
          pct >= 90 ? "#dc2626" : pct >= 80 ? "#d97706" : "#00d17d";

        return (
          <Link
            key={row.id}
            href={`/admin/clinics`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "12px 16px",
              background: highlight ? "#fef9e7" : "#f9fafb",
              border: highlight
                ? "1px solid rgba(217,119,6,0.30)"
                : "1px solid rgba(0,0,0,0.06)",
              borderRadius: 12,
              textDecoration: "none",
              color: "inherit",
              transition: "transform 150ms ease, background 150ms ease",
            }}
          >
            {/* Nom + jobs */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#111827",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {row.name}
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                {jobs.toLocaleString("fr-FR")} job{jobs !== 1 ? "s" : ""} ·{" "}
                {quota
                  ? `Quota ${quota.toLocaleString("fr-FR")}`
                  : "Quota illimité"}
              </div>
            </div>

            {/* Barre de progression */}
            {quota && quota > 0 && (
              <div
                style={{
                  width: 180,
                  height: 8,
                  background: "#e5e7eb",
                  borderRadius: 4,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.min(pct, 100)}%`,
                    height: "100%",
                    background: barColor,
                    transition: "width 300ms ease",
                  }}
                />
              </div>
            )}

            {/* Pourcentage */}
            <div
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 13,
                fontWeight: 700,
                color: barColor,
                minWidth: 48,
                textAlign: "right",
              }}
            >
              {quota ? `${pct}%` : "—"}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
