// app/api/consultations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getConsultations, getConsultation, getJobByConsultation, createConsultation } from "@/lib/db";
import { randomUUID } from "crypto";

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { patient_name, patient_species, patient_breed, patient_age, patient_weight, owner_name, vet_name, motif } = body;

    if (!patient_name?.trim() || !patient_species?.trim() || !owner_name?.trim()) {
      return NextResponse.json(
        { error: "patient_name, patient_species et owner_name sont requis" },
        { status: 400 }
      );
    }

    const id = randomUUID();
    await createConsultation({
      id,
      patientName: patient_name.trim(),
      patientSpecies: patient_species.trim(),
      patientBreed: (patient_breed ?? "").trim(),
      patientAge: (patient_age ?? "").trim(),
      patientWeight: (patient_weight ?? "").trim(),
      ownerName: owner_name.trim(),
      vetName: (vet_name ?? "").trim(),
      motif: (motif ?? "").trim(),
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (err: unknown) {
    console.error("[Consultations POST] Error:", err);
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
  }
}
