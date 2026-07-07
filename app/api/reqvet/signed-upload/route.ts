// app/api/reqvet/signed-upload/route.ts
// ─────────────────────────────────────────────────────────────
// Renvoie une URL d'upload signée Supabase.
// Le navigateur PUT l'audio directement dessus, contournant la
// limite de payload des Vercel Serverless Functions (~4,5 Mo).
//
// Flow complet :
//   1. Browser  → POST /api/reqvet/signed-upload  (JSON léger)
//   2. Browser  → PUT uploadUrl (audio → Supabase, aucune limite)
//   3. Browser  → POST /api/reqvet/generate       (JSON avec audioPath)
// ─────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { reqvet } from "@/lib/reqvet";

export async function POST(req: NextRequest) {
  try {
    const { fileName, contentType } = await req.json();

    if (!fileName || !contentType) {
      return NextResponse.json(
        { error: "Champs requis manquants : fileName, contentType" },
        { status: 400 }
      );
    }

    const { uploadUrl, path } = await reqvet.getSignedUploadUrl(fileName, contentType);
    return NextResponse.json({ uploadUrl, path });
  } catch (err: unknown) {
    console.error("[ReqVet signed-upload] Error:", err);
    const message = err instanceof Error ? err.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
