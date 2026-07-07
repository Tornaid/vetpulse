// app/api/admin/system-templates/route.ts
// Proxy VetPulse → engine /api/admin/templates
// System templates (org_id NULL) → visibles par toutes les cliniques.
import { NextResponse, type NextRequest } from "next/server";

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

// GET → liste les templates système
export async function GET() {
  const env = requireEnv();
  if ("error" in env) return env.error;

  try {
    const res = await fetch(`${env.baseUrl}/api/admin/templates`, {
      headers: { Authorization: `Bearer admin_${env.adminSecret}` },
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
    console.error("[admin/system-templates GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur interne" },
      { status: 500 },
    );
  }
}

// POST → crée un template système
export async function POST(req: NextRequest) {
  const env = requireEnv();
  if ("error" in env) return env.error;

  try {
    const body = await req.json();
    const res = await fetch(`${env.baseUrl}/api/admin/templates`, {
      method: "POST",
      headers: {
        Authorization: `Bearer admin_${env.adminSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Engine ${res.status}: ${text.slice(0, 200)}` },
        { status: res.status },
      );
    }

    const data = await res.json();
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("[admin/system-templates POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur interne" },
      { status: 500 },
    );
  }
}
