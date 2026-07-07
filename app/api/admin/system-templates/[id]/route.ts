// app/api/admin/system-templates/[id]/route.ts
// Proxy VetPulse → engine /api/admin/templates/:id
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

interface Ctx {
  params: Promise<{ id: string }>;
}

// PUT → met à jour un template système
export async function PUT(req: NextRequest, ctx: Ctx) {
  const env = requireEnv();
  if ("error" in env) return env.error;

  const { id } = await ctx.params;
  try {
    const body = await req.json();
    const res = await fetch(`${env.baseUrl}/api/admin/templates/${id}`, {
      method: "PUT",
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

    return NextResponse.json(await res.json());
  } catch (err) {
    console.error("[admin/system-templates PUT]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur interne" },
      { status: 500 },
    );
  }
}

// DELETE → supprime un template système
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const env = requireEnv();
  if ("error" in env) return env.error;

  const { id } = await ctx.params;
  try {
    const res = await fetch(`${env.baseUrl}/api/admin/templates/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer admin_${env.adminSecret}` },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Engine ${res.status}: ${text.slice(0, 200)}` },
        { status: res.status },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[admin/system-templates DELETE]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur interne" },
      { status: 500 },
    );
  }
}
