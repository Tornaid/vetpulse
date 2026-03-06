// lib/db-setup.mjs — Run with: node lib/db-setup.mjs
// Creates tables + seed consultations in Turso
import { createClient } from "@libsql/client";
import { config } from "dotenv";

config({ path: ".env" });
config({ path: ".env.local" }); // surcharge .env si présent

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function setup() {
  console.log("🔧 Creating tables...");

  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS consultations (
      id TEXT PRIMARY KEY,
      patient_name TEXT NOT NULL,
      patient_species TEXT NOT NULL,
      patient_breed TEXT NOT NULL,
      patient_age TEXT NOT NULL,
      patient_weight TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      vet_name TEXT NOT NULL,
      motif TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      consultation_id TEXT NOT NULL REFERENCES consultations(id),
      reqvet_job_id TEXT NOT NULL UNIQUE,
      template_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      html TEXT,
      transcription TEXT,
      fields TEXT,
      amendment_number INTEGER DEFAULT 0,
      error TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reformulations (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id),
      reqvet_reformulation_id TEXT NOT NULL,
      purpose TEXT NOT NULL,
      html TEXT NOT NULL,
      custom_instructions TEXT,
      cost_usd REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS webhook_events (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      processed_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_consultation ON jobs(consultation_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_reqvet ON jobs(reqvet_job_id);
    CREATE INDEX IF NOT EXISTS idx_reformulations_job ON reformulations(job_id);
    CREATE INDEX IF NOT EXISTS idx_webhook_events_dedup ON webhook_events(job_id, event_type);
  `);

  console.log("✅ Tables created.");

  // Migration : colonnes compte_rendu + conclusion (ignorées si déjà présentes)
  for (const sql of [
    "ALTER TABLE consultations ADD COLUMN compte_rendu TEXT",
    "ALTER TABLE consultations ADD COLUMN conclusion TEXT",
  ]) {
    try { await db.execute(sql); } catch { /* colonne déjà présente */ }
  }
  console.log("✅ Migration colonnes compte_rendu / conclusion OK.");

  // Seed consultations
  const consultations = [
    {
      id: "CONSULT-001",
      patient_name: "Rex",
      patient_species: "Chien",
      patient_breed: "Berger Allemand",
      patient_age: "7 ans",
      patient_weight: "34 kg",
      owner_name: "Pierre Martin",
      vet_name: "Dr. Martin",
      motif: "Boiterie MPD depuis 3 jours",
    },
    {
      id: "CONSULT-002",
      patient_name: "Luna",
      patient_species: "Chat",
      patient_breed: "Européen",
      patient_age: "3 ans",
      patient_weight: "4.2 kg",
      owner_name: "Marie Dupont",
      vet_name: "Dr. Martin",
      motif: "Vaccin annuel + check-up",
    },
    {
      id: "CONSULT-003",
      patient_name: "Max",
      patient_species: "Chien",
      patient_breed: "Golden Retriever",
      patient_age: "5 ans",
      patient_weight: "28.5 kg",
      owner_name: "Jean Lefèvre",
      vet_name: "Dr. Lefèvre",
      motif: "Diarrhée liquide depuis 5 jours",
    },
    {
      id: "CONSULT-004",
      patient_name: "Plume",
      patient_species: "Lapin",
      patient_breed: "Bélier nain",
      patient_age: "2 ans",
      patient_weight: "1.8 kg",
      owner_name: "Sophie Bernard",
      vet_name: "Dr. Martin",
      motif: "Perte d'appétit + apathie",
    },
  ];

  for (const c of consultations) {
    try {
      await db.execute({
        sql: `INSERT OR IGNORE INTO consultations (id, patient_name, patient_species, patient_breed, patient_age, patient_weight, owner_name, vet_name, motif)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [c.id, c.patient_name, c.patient_species, c.patient_breed, c.patient_age, c.patient_weight, c.owner_name, c.vet_name, c.motif],
      });
    } catch (e) {
      // Ignore duplicates
    }
  }

  console.log(`✅ Seeded ${consultations.length} consultations.`);
  console.log("🚀 Database ready!");
}

setup().catch(console.error);
