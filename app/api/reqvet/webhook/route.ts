// app/api/reqvet/webhook/route.ts
// ─────────────────────────────────────────────────────────────
// WEBHOOK HANDLER — ReqVet POSTe les résultats ici.
//
// Events gérés :
//   - job.completed   → sauvegarde HTML + transcription + fields
//   - job.failed      → marque l'erreur
//   - job.amended     → met à jour le HTML avec l'amendement
//   - job.amend_failed → log l'erreur, CR original préservé
//   - job.regenerated → met à jour le HTML régénéré
//
// Sécurité :
//   - Vérification HMAC (X-ReqVet-Signature + X-ReqVet-Timestamp)
//   - Anti-replay (maxSkewMs: 5 min)
//   - Idempotence (dedup sur job_id + event dans webhook_events)
// ─────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@reqvet-sdk/sdk/webhooks";
import { db, updateJobFromWebhook } from "@/lib/db";

export async function POST(req: NextRequest) {
  // 1. Lire le raw body AVANT JSON.parse (obligatoire pour HMAC)
  const rawBody = await req.text();
  const signature = req.headers.get("x-reqvet-signature") ?? "";
  const timestamp = req.headers.get("x-reqvet-timestamp") ?? "";

  // 2. Vérifier la signature HMAC
  if (process.env.REQVET_WEBHOOK_SECRET) {
    const result = verifyWebhookSignature({
      secret: process.env.REQVET_WEBHOOK_SECRET,
      rawBody,
      signature,
      timestamp,
      maxSkewMs: 5 * 60 * 1000,
    });

    if (!result.ok) {
      console.warn("[ReqVet webhook] Signature invalide:", result);
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  // 3. Parser le body
  let event: {
    event: string;
    job_id: string;
    animal_name?: string;
    html?: string;
    transcription?: string;
    fields?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    amendment_number?: number;
    error?: string;
  };

  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  console.log(`[ReqVet webhook] ${event.event} — job ${event.job_id}`);

  // 4. Idempotence — dédupliquer sur job_id + event
  const dedupKey = `${event.job_id}:${event.event}`;
  const existing = await db.execute({
    sql: "SELECT id FROM webhook_events WHERE job_id = ? AND event_type = ?",
    args: [event.job_id, event.event],
  });

  if (existing.rows.length > 0) {
    console.log(`[ReqVet webhook] Event déjà traité: ${dedupKey}`);
    return NextResponse.json({ ok: true, deduplicated: true });
  }

  // Enregistrer l'event pour l'idempotence
  await db.execute({
    sql: "INSERT INTO webhook_events (id, job_id, event_type) VALUES (?, ?, ?)",
    args: [dedupKey, event.job_id, event.event],
  });

  // 5. Traiter selon le type d'event
  switch (event.event) {
    case "job.completed": {
      await updateJobFromWebhook({
        reqvetJobId: event.job_id,
        status: "completed",
        html: event.html,
        transcription: event.transcription,
        fields: event.fields,
      });
      console.log(`[ReqVet webhook] ✅ CR prêt pour ${event.animal_name}`);
      break;
    }

    case "job.failed": {
      await updateJobFromWebhook({
        reqvetJobId: event.job_id,
        status: "failed",
        error: event.error,
      });
      console.error(`[ReqVet webhook] ❌ Job échoué:`, event.error);
      break;
    }

    case "job.amended": {
      await updateJobFromWebhook({
        reqvetJobId: event.job_id,
        status: "completed",
        html: event.html,
        transcription: event.transcription,
        fields: event.fields,
        amendmentNumber: event.amendment_number,
      });
      console.log(`[ReqVet webhook] ✅ Amendement #${event.amendment_number} intégré`);
      break;
    }

    case "job.amend_failed": {
      // Le CR original est préservé — on log juste l'erreur
      await updateJobFromWebhook({
        reqvetJobId: event.job_id,
        status: "completed", // Revient à completed (CR original intact)
        error: event.error,
      });
      console.error(`[ReqVet webhook] ❌ Amendement échoué:`, event.error);
      break;
    }

    case "job.regenerated": {
      await updateJobFromWebhook({
        reqvetJobId: event.job_id,
        status: "completed",
        html: event.html,
        fields: event.fields,
      });
      console.log(`[ReqVet webhook] ✅ CR régénéré`);
      break;
    }

    default:
      console.warn(`[ReqVet webhook] Event inconnu: ${event.event}`);
  }

  return NextResponse.json({ ok: true });
}
