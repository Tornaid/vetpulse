// app/api/consultations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getConsultations, getConsultation, getJobByConsultation } from "@/lib/db";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");

  try {
    if (id) {
      const consultation = await getConsultation(id);
      if (!consultation) {
        return NextResponse.json({ error: "Consultation introuvable" }, { status: 404 });
      }
      const job = await getJobByConsultation(id);
      return NextResponse.json({ consultation, job });
    }

    const consultations = await getConsultations();
    return NextResponse.json({ consultations });
  } catch (err: unknown) {
    console.error("[Consultations] Error:", err);
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
  }
}
