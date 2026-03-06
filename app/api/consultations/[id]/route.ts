// app/api/consultations/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { updateConsultationDossier } from "@/lib/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await req.json();
    const motif: string = typeof body.motif === "string" ? body.motif : "";
    const compteRendu: string | null = typeof body.compte_rendu === "string" ? body.compte_rendu : null;
    const conclusion: string | null = typeof body.conclusion === "string" ? body.conclusion : null;

    await updateConsultationDossier({ id, motif, compteRendu, conclusion });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("[Consultations PATCH] Error:", err);
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
  }
}
