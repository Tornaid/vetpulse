// app/api/reqvet/generate/route.ts
// ─────────────────────────────────────────────────────────────
// PROXY ROUTE — le frontend envoie l'audio ici.
// Cette route :
//   1. Obtient une URL signée Supabase via reqvet.getSignedUploadUrl()
//   2. Upload l'audio DIRECTEMENT sur Supabase (PUT vers l'URL signée)
//   3. Crée un job avec callbackUrl (reqvet.createJob)
//   4. Stocke le job en base Turso
//   5. Retourne le job_id immédiatement au frontend
//
// ⚠️  N'utilisez PAS reqvet.uploadAudio() côté serveur (Vercel / Serverless) :
//     /api/v1/upload est une Serverless Function limitée à ~4.5 MB → 413.
//     Utilisez à la place getSignedUploadUrl() + PUT direct vers Supabase.
//
// La clé API ne quitte jamais le serveur.
// ─────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { reqvet } from "@/lib/reqvet";
import { createJob } from "@/lib/db";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();

    const audio = form.get("audio") as File | null;
    const animalName = form.get("animalName") as string | null;
    const templateId = form.get("templateId") as string | null;
    const consultationId = form.get("consultationId") as string | null;
    const extraInstructions = form.get("extraInstructions") as string | null;

    if (!audio || !animalName || !templateId || !consultationId) {
      return NextResponse.json(
        { error: "Champs requis manquants : audio, animalName, templateId, consultationId" },
        { status: 400 }
      );
    }

    // 1a. Obtenir une URL d'upload signée (requête JSON légère, aucun fichier envoyé)
    const { uploadUrl, path: audioPath } = await reqvet.getSignedUploadUrl(
      audio.name || "consultation.webm",
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

    // audioPath → identifiant canonique à passer dans createJob

    // 2. Construire le callbackUrl — le webhook de notre app
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const callbackUrl = `${appUrl}/api/reqvet/webhook`;

    // 3. Créer le job sur ReqVet avec le callbackUrl
    const job = await reqvet.createJob({
      audioFile: audioPath,
      animalName,
      templateId,
      callbackUrl,
      metadata: {
        consultationId,
        source: "vetpulse",
      },
      ...(extraInstructions ? { extraInstructions } : {}),
    });

    // 4. Persister en base Turso
    const localJobId = randomUUID();
    await createJob({
      id: localJobId,
      consultationId,
      reqvetJobId: job.job_id,
      templateId,
      status: job.status,
      metadata: { consultationId },
    });

    return NextResponse.json(
      {
        job_id: job.job_id,
        local_job_id: localJobId,
        status: job.status,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    console.error("[ReqVet generate] Error:", err);
    const status = (err as { status?: number }).status;
    if (status === 413) {
      return NextResponse.json(
        { error: "Fichier audio trop volumineux pour l'API ReqVet. Réduisez la durée ou compressez l'audio." },
        { status: 413 }
      );
    }
    const message = err instanceof Error ? err.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
