// app/api/admin/clinics/route.ts
// ─────────────────────────────────────────────────────────────
// GET  — Liste toutes les organisations (ReqVet API + notes locales Turso)
// POST — Cree une nouvelle clinique via la cle reseller
//
// Necessite REQVET_RESELLER_API_KEY dans l'environnement.
// ─────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { getResellerClient } from "@/lib/reqvet-admin";
import { getClinics, createClinicRecord, getClinicByReqvetOrgId } from "@/lib/db";
import { randomUUID } from "crypto";

function requireAdmin() {
  if (!process.env.REQVET_RESELLER_API_KEY) {
    return NextResponse.json(
      { error: "Ce Vetpulse n'est pas configure en mode admin reseller." },
      { status: 403 }
    );
  }
  return null;
}

export async function GET() {
  const guard = requireAdmin();
  if (guard) return guard;

  try {
    const reqvetAdmin = getResellerClient();

    // Appel ReqVet : liste des orgs avec usage
    const { organizations } = await reqvetAdmin.listOrganizations();

    // Notes locales (Turso) : indexed par reqvet_org_id
    const localClinics = await getClinics();
    const notesMap = new Map(localClinics.map((c) => [c.reqvet_org_id, c.notes]));

    const enriched = organizations.map((org) => ({
      ...org,
      notes: notesMap.get(org.id) ?? null,
    }));

    return NextResponse.json({ organizations: enriched });
  } catch (err: unknown) {
    console.error("[Admin clinics GET]", err);
    const message = err instanceof Error ? err.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = requireAdmin();
  if (guard) return guard;

  try {
    const body = await req.json();
    const { name, contactEmail, monthlyQuota, webhookUrl, notes } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "Le nom de la clinique est requis." }, { status: 400 });
    }

    const reqvetAdmin = getResellerClient();

    // Generer un UUID local en avance — sert d'externalId pour l'idempotence ReqVet
    const localId = randomUUID();

    const result = await reqvetAdmin.createOrganization({
      name: name.trim(),
      contactEmail: contactEmail?.trim() || undefined,
      monthlyQuota: monthlyQuota ? Number(monthlyQuota) : undefined,
      webhookUrl: webhookUrl?.trim() || undefined,
      externalId: localId,
    });

    // L'org existait deja (idempotence via externalId) — retourner sans api_key
    if (result.message) {
      const existing = await getClinicByReqvetOrgId(result.organization.id);
      return NextResponse.json({
        organization: result.organization,
        already_existed: true,
        local_id: existing?.id ?? null,
        message: result.message,
      });
    }

    // Nouvelle org — persister en local (sans la cle)
    await createClinicRecord({
      id: localId,
      reqvetOrgId: result.organization.id,
      name: result.organization.name,
      notes: notes?.trim() || null,
    });

    // Retourner la cle et le secret UNE SEULE FOIS
    return NextResponse.json(
      {
        organization: result.organization,
        local_id: localId,
        api_key: result.api_key,
        webhook_secret: result.webhook_secret,
        warning: result.warning,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    console.error("[Admin clinics POST]", err);
    const message = err instanceof Error ? err.message : "Erreur interne";
    const status = (err as { status?: number }).status ?? 500;
    return NextResponse.json({ error: message }, { status });
  }
}
