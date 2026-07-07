// app/api/admin/stats/route.ts
// Proxy VetPulse → engine /api/admin/stats
// Utilise REQVET_ADMIN_SECRET (l'ADMIN_SECRET root de l'engine)
import { NextResponse } from "next/server";

function requireEnv() {
  const adminSecret = process.env.REQVET_ADMIN_SECRET;
  const baseUrl = process.env.REQVET_BASE_URL || "https://api.reqvet.com";
  if (!adminSecret) {
    return {
      error: NextResponse.json(
        { error: "REQVET_ADMIN_SECRET manquant dans .env.local" },
        { status: 500 },
      ),
    };
  }
  return { adminSecret, baseUrl };
}

export async function GET() {
  const env = requireEnv();
  if ("error" in env) return env.error;

  try {
    const res = await fetch(`${env.baseUrl}/api/admin/stats`, {
      headers: {
        Authorization: `Bearer admin_${env.adminSecret}`,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Engine ${res.status}: ${text.slice(0, 200)}` },
        { status: res.status },
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[admin/stats proxy]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur interne" },
      { status: 500 },
    );
  }
}
