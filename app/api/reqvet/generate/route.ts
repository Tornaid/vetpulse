// app/api/reqvet/generate/route.ts
// ─────────────────────────────────────────────────────────────
// PROXY ROUTE — le frontend appelle cet endpoint APRÈS avoir
// uploadé l'audio directement vers Supabase via /signed-upload.
//
// Cette route reçoit un JSON léger avec :
//   - audioPath (chemin canonique retourné par /signed-upload)
//   - animalName, animalBreed?, animalAge?
//   - templateId, consultationId
//   - extraInstructions?
//
// Elle :
//   1. Crée un job ReqVet avec le audioPath + callbackUrl
//   2. Persiste le mapping local en Turso
//   3. Retourne le job_id immédiatement
//
// ⚠️  Le navigateur doit avoir uploadé l'audio AVANT (via /signed-upload
//     + PUT direct vers Supabase). Ce endpoint reçoit uniquement le path.
//     C'est ce qui contourne la limite Vercel Serverless (~4,5 Mo).
// ─────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { reqvet } from "@/lib/reqvet";
import { createJob } from "@/lib/db";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      audioPath,
      animalName,
      animalBreed,
      animalAge,
      templateId,
      consultationId,
      extraInstructions,
    } = body as {
      audioPath?: string;
      animalName?: string;
      animalBreed?: string;
      animalAge?: string;
      templateId?: string;
      consultationId?: string;
      extraInstructions?: string;
    };

    if (!audioPath || !animalName || !templateId || !consultationId) {
      return NextResponse.json(
        { error: "Champs requis manquants : audioPath, animalName, templateId, consultationId" },
        { status: 400 }
      );
    }

    // Construire le callbackUrl — le webhook de notre app
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const callbackUrl = `${appUrl}/api/reqvet/webhook`;

    // Créer le job sur ReqVet avec le callbackUrl
    const job = await reqvet.createJob({
      audioFile: audioPath,
      animalName,
      animalBreed: animalBreed || undefined,
      animalAge: animalAge || undefined,
      templateId,
      callbackUrl,
      metadata: {
        consultationId,
        source: "vetpulse",
      },
      ...(extraInstructions ? { extraInstructions } : {}),
    });

    // Persister en base Turso
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
    const message = err instanceof Error ? err.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
