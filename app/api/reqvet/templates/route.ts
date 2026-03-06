// app/api/reqvet/templates/route.ts
// Proxy pour lister les templates ReqVet — cache possible côté serveur
import { NextResponse } from "next/server";
import { reqvet } from "@/lib/reqvet";

export async function GET() {
  try {
    const templates = await reqvet.listTemplates();
    return NextResponse.json(templates);
  } catch (err: unknown) {
    console.error("[ReqVet templates] Error:", err);
    const message = err instanceof Error ? err.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
