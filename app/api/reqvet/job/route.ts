// app/api/reqvet/job/route.ts
// ─────────────────────────────────────────────────────────────
// Le frontend poll cet endpoint pour récupérer le statut du job.
//
// Deux sources de vérité :
//   1. La base Turso (mise à jour par le webhook)
//   2. L'API ReqVet directement (fallback si le webhook n'est pas encore arrivé)
//
// En production, on remplacerait ce polling par du WebSocket/SSE.
// ─────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { reqvet } from "@/lib/reqvet";
import { getJob, updateJobFromWebhook } from "@/lib/db";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");

  if (!jobId) {
    return NextResponse.json({ error: "jobId requis" }, { status: 400 });
  }

  try {
    // 1. D'abord, regarder en base (alimentée par le webhook)
    const localJob = await getJob(jobId);

    if (localJob && localJob.status === "completed") {
      // Le webhook est déjà passé — on a tout
      return NextResponse.json({
        status: localJob.status,
        html: localJob.html,
        transcription: localJob.transcription,
        fields: localJob.fields ? JSON.parse(localJob.fields) : null,
        amendment_number: localJob.amendment_number,
      });
    }

    if (localJob && localJob.status === "failed") {
      return NextResponse.json({
        status: "failed",
        error: localJob.error,
      });
    }

    // 2. Sinon, interroger l'API ReqVet directement (fallback)
    // Cast nécessaire : le SDK ne type pas finement la réponse getJob
    const remoteJob = await reqvet.getJob(jobId) as {
      status: string;
      transcription?: string | null;
      result?: { html?: string | null; fields?: Record<string, unknown> | null };
    };

    // Si le job est completed côté ReqVet mais pas encore en base
    // (webhook en retard), on met à jour la base
    if (remoteJob.status === "completed" && localJob && localJob.status !== "completed") {
      await updateJobFromWebhook({
        reqvetJobId: jobId,
        status: "completed",
        html: remoteJob.result?.html,
        transcription: remoteJob.transcription,
        fields: remoteJob.result?.fields as Record<string, unknown> | undefined,
      });
    }

    return NextResponse.json({
      status: remoteJob.status,
      html: remoteJob.result?.html ?? null,
      transcription: remoteJob.transcription ?? null,
      fields: remoteJob.result?.fields ?? null,
      amendment_number: localJob?.amendment_number ?? 0,
    });
  } catch (err: unknown) {
    console.error("[ReqVet job] Error:", err);
    const message = err instanceof Error ? err.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
