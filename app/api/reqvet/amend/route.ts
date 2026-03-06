// app/api/reqvet/amend/route.ts
// ─────────────────────────────────────────────────────────────
// Proxy pour les amendements (compléments audio).
//
// Le frontend envoie un nouvel audio + le jobId.
// Cette route :
//   1. Obtient une URL signée Supabase via reqvet.getSignedUploadUrl()
//   2. Upload l'audio DIRECTEMENT sur Supabase (PUT vers l'URL signée)
//   3. Appelle reqvet.amendJob()
//   4. Met à jour le statut en base → 'amending'
//   5. Le résultat arrivera via webhook (job.amended)
//
// ⚠️  N'utilisez PAS reqvet.uploadAudio() côté serveur (Vercel / Serverless) :
//     /api/v1/upload est une Serverless Function limitée à ~4.5 MB → 413.
//     Utilisez à la place getSignedUploadUrl() + PUT direct vers Supabase.
// ─────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { reqvet } from "@/lib/reqvet";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();

    const audio = form.get("audio") as File | null;
    const jobId = form.get("jobId") as string | null;

    if (!audio || !jobId) {
      return NextResponse.json(
        { error: "Champs requis manquants : audio, jobId" },
        { status: 400 }
      );
    }

    // 1a. Obtenir une URL d'upload signée (requête JSON légère, aucun fichier envoyé)
    const { uploadUrl, path: audioPath } = await reqvet.getSignedUploadUrl(
      audio.name || "complement.webm",
      audio.type || "audio/webm",
    );

    // 1b. Upload direct vers Supabase (bypass Vercel, aucune limite de taille)
    const audioBuffer = Buffer.from(await audio.arrayBuffer());
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": audio.type || "audio/webm" },
      body: audioBuffer,
    });
    if (!uploadRes.ok) throw new Error(`Upload Supabase échoué: ${uploadRes.status}`);

    // audioPath → identifiant canonique à passer dans amendJob

    // 2. Soumettre l'amendement
    const amend = await reqvet.amendJob(jobId, {
      audioFile: audioPath,
    });

    // 3. Mettre à jour le statut en base
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
