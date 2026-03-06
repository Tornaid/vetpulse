// app/api/admin/clinics/[id]/route.ts
// ─────────────────────────────────────────────────────────────
// GET    — Details + usage du mois de l'organisation
// PATCH  — Modifier quota, statut actif, webhookUrl, notes locales
// DELETE — Desactiver l'organisation et revoquer ses cles
// ─────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { getResellerClient } from "@/lib/reqvet-admin";
import { updateClinicNotes } from "@/lib/db";

function requireAdmin() {
  if (!process.env.REQVET_RESELLER_API_KEY) {
    return NextResponse.json(
      { error: "Ce Vetpulse n'est pas configure en mode admin reseller." },
      { status: 403 }
    );
  }
  return null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireAdmin();
  if (guard) return guard;

  const { id } = await params;
  try {
    const reqvetAdmin = getResellerClient();
    const org = await reqvetAdmin.getOrganization(id);
    return NextResponse.json(org);
  } catch (err: unknown) {
    console.error("[Admin clinic GET]", err);
    const message = err instanceof Error ? err.message : "Erreur interne";
    const status = (err as { status?: number }).status ?? 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireAdmin();
  if (guard) return guard;

  const { id } = await params;
  try {
    const body = await req.json();
    const { monthlyQuota, isActive, webhookUrl, notes } = body;

    const reqvetAdmin = getResellerClient();

    const updatedOrg = await reqvetAdmin.updateOrganization(id, {
      monthlyQuota: monthlyQuota !== undefined ? Number(monthlyQuota) : undefined,
      isActive: isActive !== undefined ? Boolean(isActive) : undefined,
      webhookUrl: webhookUrl !== undefined ? webhookUrl : undefined,
    });

    if (notes !== undefined) {
      await updateClinicNotes(updatedOrg.id, notes ?? null);
    }

    return NextResponse.json(updatedOrg);
  } catch (err: unknown) {
    console.error("[Admin clinic PATCH]", err);
    const message = err instanceof Error ? err.message : "Erreur interne";
    const status = (err as { status?: number }).status ?? 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = requireAdmin();
  if (guard) return guard;

  const { id } = await params;
  try {
    const reqvetAdmin = getResellerClient();
    const result = await reqvetAdmin.deactivateOrganization(id);
    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error("[Admin clinic DELETE]", err);
    const message = err instanceof Error ? err.message : "Erreur interne";
    const status = (err as { status?: number }).status ?? 500;
    return NextResponse.json({ error: message }, { status });
  }
}
