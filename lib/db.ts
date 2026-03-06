// lib/db.ts — Client Turso (LibSQL) + helpers
import { createClient } from "@libsql/client";

if (!process.env.TURSO_DATABASE_URL) {
  throw new Error("TURSO_DATABASE_URL manquante dans .env.local");
}

export const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// ─── Types ──────────────────────────────────────────────────

export interface ConsultationRow {
  id: string;
  patient_name: string;
  patient_species: string;
  patient_breed: string;
  patient_age: string;
  patient_weight: string;
  owner_name: string;
  vet_name: string;
  motif: string;
  compte_rendu: string | null;
  conclusion: string | null;
  created_at: string;
}

export interface JobRow {
  id: string;
  consultation_id: string;
  reqvet_job_id: string;
  template_id: string;
  status: string;
  html: string | null;
  transcription: string | null;
  fields: string | null; // JSON string
  amendment_number: number;
  error: string | null;
  metadata: string | null; // JSON string
  created_at: string;
  updated_at: string;
}

export interface ReformulationRow {
  id: string;
  job_id: string;
  reqvet_reformulation_id: string;
  purpose: string;
  html: string;
  custom_instructions: string | null;
  cost_usd: number | null;
  created_at: string;
}

// ─── Helpers ────────────────────────────────────────────────

export async function getConsultations(): Promise<ConsultationRow[]> {
  const result = await db.execute(
    "SELECT * FROM consultations ORDER BY created_at DESC"
  );
  return result.rows.map((r) => ({ ...r })) as unknown as ConsultationRow[];
}

export async function getConsultation(id: string): Promise<ConsultationRow | null> {
  const result = await db.execute({
    sql: "SELECT * FROM consultations WHERE id = ?",
    args: [id],
  });
  return result.rows[0] ? ({ ...result.rows[0] } as unknown as ConsultationRow) : null;
}

export async function getJobByConsultation(consultationId: string): Promise<JobRow | null> {
  const result = await db.execute({
    sql: "SELECT * FROM jobs WHERE consultation_id = ? ORDER BY created_at DESC LIMIT 1",
    args: [consultationId],
  });
  return result.rows[0] ? ({ ...result.rows[0] } as unknown as JobRow) : null;
}

export async function getJob(reqvetJobId: string): Promise<JobRow | null> {
  const result = await db.execute({
    sql: "SELECT * FROM jobs WHERE reqvet_job_id = ?",
    args: [reqvetJobId],
  });
  return result.rows[0] ? ({ ...result.rows[0] } as unknown as JobRow) : null;
}

export async function createJob(params: {
  id: string;
  consultationId: string;
  reqvetJobId: string;
  templateId: string;
  status: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.execute({
    sql: `INSERT INTO jobs (id, consultation_id, reqvet_job_id, template_id, status, metadata, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    args: [
      params.id,
      params.consultationId,
      params.reqvetJobId,
      params.templateId,
      params.status,
      params.metadata ? JSON.stringify(params.metadata) : null,
    ],
  });
}

export async function updateJobFromWebhook(params: {
  reqvetJobId: string;
  status: string;
  html?: string | null;
  transcription?: string | null;
  fields?: Record<string, unknown> | null;
  amendmentNumber?: number;
  error?: string | null;
}): Promise<void> {
  await db.execute({
    sql: `UPDATE jobs SET
            status = ?,
            html = COALESCE(?, html),
            transcription = COALESCE(?, transcription),
            fields = COALESCE(?, fields),
            amendment_number = COALESCE(?, amendment_number),
            error = ?,
            updated_at = datetime('now')
          WHERE reqvet_job_id = ?`,
    args: [
      params.status,
      params.html ?? null,
      params.transcription ?? null,
      params.fields ? JSON.stringify(params.fields) : null,
      params.amendmentNumber ?? null,
      params.error ?? null,
      params.reqvetJobId,
    ],
  });
}

export async function saveReformulation(params: {
  id: string;
  jobId: string;
  reqvetReformulationId: string;
  purpose: string;
  html: string;
  customInstructions?: string | null;
  costUsd?: number | null;
}): Promise<void> {
  await db.execute({
    sql: `INSERT INTO reformulations (id, job_id, reqvet_reformulation_id, purpose, html, custom_instructions, cost_usd, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    args: [
      params.id,
      params.jobId,
      params.reqvetReformulationId,
      params.purpose,
      params.html,
      params.customInstructions ?? null,
      params.costUsd ?? null,
    ],
  });
}

export async function updateConsultationDossier(params: {
  id: string;
  motif: string;
  compteRendu: string | null;
  conclusion: string | null;
}): Promise<void> {
  await db.execute({
    sql: `UPDATE consultations SET motif = ?, compte_rendu = ?, conclusion = ? WHERE id = ?`,
    args: [params.motif, params.compteRendu, params.conclusion, params.id],
  });
}

export async function createConsultation(params: {
  id: string;
  patientName: string;
  patientSpecies: string;
  patientBreed: string;
  patientAge: string;
  patientWeight: string;
  ownerName: string;
  vetName: string;
  motif?: string;
}): Promise<void> {
  await db.execute({
    sql: `INSERT INTO consultations (id, patient_name, patient_species, patient_breed, patient_age, patient_weight, owner_name, vet_name, motif, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    args: [
      params.id,
      params.patientName,
      params.patientSpecies,
      params.patientBreed,
      params.patientAge,
      params.patientWeight,
      params.ownerName,
      params.vetName,
      params.motif ?? "",
    ],
  });
}

export async function getReformulations(jobId: string): Promise<ReformulationRow[]> {
  const result = await db.execute({
    sql: "SELECT * FROM reformulations WHERE job_id = ? ORDER BY created_at ASC",
    args: [jobId],
  });
  return result.rows.map((r) => ({ ...r })) as unknown as ReformulationRow[];
}

// ─── Clinics ─────────────────────────────────────────────────

export interface ClinicRow {
  id: string;
  reqvet_org_id: string;
  name: string;
  notes: string | null;
  created_at: string;
}

export async function getClinics(): Promise<ClinicRow[]> {
  const result = await db.execute("SELECT * FROM clinics ORDER BY created_at DESC");
  return result.rows.map((r) => ({ ...r })) as unknown as ClinicRow[];
}

export async function getClinicByReqvetOrgId(orgId: string): Promise<ClinicRow | null> {
  const result = await db.execute({
    sql: "SELECT * FROM clinics WHERE reqvet_org_id = ?",
    args: [orgId],
  });
  return result.rows[0] ? ({ ...result.rows[0] } as unknown as ClinicRow) : null;
}

export async function createClinicRecord(params: {
  id: string;
  reqvetOrgId: string;
  name: string;
  notes?: string | null;
}): Promise<void> {
  await db.execute({
    sql: `INSERT INTO clinics (id, reqvet_org_id, name, notes, created_at)
          VALUES (?, ?, ?, ?, datetime('now'))`,
    args: [params.id, params.reqvetOrgId, params.name, params.notes ?? null],
  });
}

export async function updateClinicNotes(reqvetOrgId: string, notes: string | null): Promise<void> {
  await db.execute({
    sql: "UPDATE clinics SET notes = ? WHERE reqvet_org_id = ?",
    args: [notes, reqvetOrgId],
  });
}
