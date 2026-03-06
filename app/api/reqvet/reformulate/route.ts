// app/api/reqvet/reformulate/route.ts
// ─────────────────────────────────────────────────────────────
// Proxy pour les reformulations.
//
// POST — Génère une reformulation via reqvet.reformulateReport()
//        et la sauvegarde en base Turso.
//
// GET  — Liste les reformulations d'un job depuis la base.
// ─────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { reqvet } from "@/lib/reqvet";
import { getJob, saveReformulation, getReformulations } from "@/lib/db";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { jobId, purpose, customInstructions } = body;

    if (!jobId || !purpose) {
      return NextResponse.json(
        { error: "jobId et purpose requis" },
        { status: 400 }
      );
    }

    // Appeler l'API ReqVet
    const reformulation = await reqvet.reformulateReport(jobId, {
      purpose,
      ...(customInstructions ? { customInstructions } : {}),
    });

    // Récupérer le job local pour l'ID
    const localJob = await getJob(jobId);

    // Sauvegarder en base
    const localId = randomUUID();
    await saveReformulation({
      id: localId,
      jobId: localJob?.id ?? jobId,
      reqvetReformulationId: reformulation.id,
      purpose: reformulation.purpose,
      html: reformulation.html,
      customInstructions: reformulation.custom_instructions,
      costUsd: reformulation.cost?.cost_usd,
    });

    return NextResponse.json({
      id: localId,
      reqvet_id: reformulation.id,
      purpose: reformulation.purpose,
      html: reformulation.html,
      custom_instructions: reformulation.custom_instructions,
      cost: reformulation.cost,
      created_at: reformulation.created_at,
    });
  } catch (err: unknown) {
    console.error("[ReqVet reformulate] Error:", err);
    const message = err instanceof Error ? err.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");

  if (!jobId) {
    return NextResponse.json({ error: "jobId requis" }, { status: 400 });
  }

  try {
    // Récupérer depuis la base locale
    const localJob = await getJob(jobId);
    if (!localJob) {
      return NextResponse.json({ reformulations: [] });
    }

    const reformulations = await getReformulations(localJob.id);
    return NextResponse.json({ reformulations });
  } catch (err: unknown) {
    console.error("[ReqVet reformulations list] Error:", err);
    const message = err instanceof Error ? err.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
