// app/api/reqvet/amend/route.ts
// ─────────────────────────────────────────────────────────────
// Proxy pour les amendements (compléments audio).
//
// Le frontend a déjà uploadé l'audio du complément vers Supabase
// via /api/reqvet/signed-upload — il ne nous envoie que le path.
//
// Cette route :
//   1. Appelle reqvet.amendJob() avec le audioPath
//   2. Met à jour le statut en base → 'amending'
//   3. Le résultat arrivera via webhook (job.amended)
// ─────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { reqvet } from "@/lib/reqvet";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const { audioPath, jobId } = await req.json() as { audioPath?: string; jobId?: string };

    if (!audioPath || !jobId) {
      return NextResponse.json(
        { error: "Champs requis manquants : audioPath, jobId" },
        { status: 400 }
      );
    }

    // Soumettre l'amendement
    const amend = await reqvet.amendJob(jobId, { audioFile: audioPath });

    // Mettre à jour le statut en base
    await db.execute({
      sql: "UPDATE jobs SET status = 'amending', updated_at = datetime('now') WHERE reqvet_job_id = ?",
      args: [jobId],
    });

    return NextResponse.json({
      job_id: amend.job_id,
      status: amend.status,
      amendment_number: amend.amendment_number,
      message: amend.message,
    });
  } catch (err: unknown) {
    console.error("[ReqVet amend] Error:", err);
    const message = err instanceof Error ? err.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
