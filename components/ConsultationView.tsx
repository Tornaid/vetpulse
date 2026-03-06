"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { ConsultationRow } from "@/lib/db";
import styles from "./ConsultationView.module.css";

// ─── Types ──────────────────────────────────────────────────

interface Template {
  id: string;
  name: string;
  description: string;
  type?: string;
}

interface ReformulationResult {
  id: string;
  purpose: string;
  html: string;
  custom_instructions?: string;
  cost?: { cost_usd: number };
  created_at: string;
}

type JobStatus = "idle" | "uploading" | "pending" | "transcribing" | "generating" | "completed" | "failed" | "amending";

const REFORMULATION_PURPOSES = [
  { value: "owner", label: "Propriétaire", icon: "👤", desc: "Version simplifiée, sans jargon" },
  { value: "referral", label: "Confrère / Référé", icon: "🩺", desc: "Résumé clinique pour spécialiste" },
  { value: "summary", label: "Résumé interne", icon: "📋", desc: "Note synthétique courte" },
  { value: "diagnostic_hypothesis", label: "Hypothèses Dx", icon: "🔬", desc: "Diagnostics différentiels" },
  { value: "custom", label: "Personnalisé", icon: "✏️", desc: "Instructions libres" },
] as const;

const SPECIES_EMOJI: Record<string, string> = {
  Chien: "🐕", Chat: "🐱", Lapin: "🐰", Oiseau: "🦜", NAC: "🦎",
};

// ─── Component ──────────────────────────────────────────────

export default function ConsultationView({
  consultations,
}: {
  consultations: ConsultationRow[];
}) {
  const router = useRouter();

  // Navigation
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Nouvelle consultation
  const [showNewModal, setShowNewModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newForm, setNewForm] = useState({
    patient_name: "", patient_species: "Chien", patient_breed: "",
    patient_age: "", patient_weight: "", owner_name: "", vet_name: "", motif: "",
  });

  // Templates
  const [templates, setTemplates] = useState<{ system: Template[]; custom: Template[] } | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  // Audio
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);

  // Job
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus>("idle");
  const [report, setReport] = useState<{
    html: string;
    transcription: string;
    fields: Record<string, unknown> | null;
    amendment_number: number;
  } | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [extraInstructions, setExtraInstructions] = useState("");

  // Reformulations
  const [reformulations, setReformulations] = useState<ReformulationResult[]>([]);
  const [reformLoading, setReformLoading] = useState<string | null>(null);
  const [activeReformTab, setActiveReformTab] = useState<string | null>(null);
  const [customReformInstructions, setCustomReformInstructions] = useState("");

  // Amend
  const [amendFile, setAmendFile] = useState<File | null>(null);
  const [amendRecording, setAmendRecording] = useState(false);
  const [amendRecordingTime, setAmendRecordingTime] = useState(0);
  const [amendMediaRecorder, setAmendMediaRecorder] = useState<MediaRecorder | null>(null);
  const [amendChunks, setAmendChunks] = useState<Blob[]>([]);
  const [amendSubmitting, setAmendSubmitting] = useState(false);

  // Tabs
  const [activeTab, setActiveTab] = useState<"report" | "transcription" | "fields" | "reformulations" | "amend">("report");

  // Champs libres du dossier (éditables manuellement, auto-remplis par la pipeline)
  const [motifText, setMotifText] = useState("");
  const [compteRenduText, setCompteRenduText] = useState("");
  const [conclusionText, setConclusionText] = useState("");
  const [compteRenduEditing, setCompteRenduEditing] = useState(true);

  // Refs
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const amendTimerRef = useRef<ReturnType<typeof setInterval>>();
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const amendFileInputRef = useRef<HTMLInputElement>(null);
  const autosaveRef = useRef<ReturnType<typeof setTimeout>>();

  const consult = consultations.find((c) => c.id === selectedId) ?? null;

  // ─── Load templates on mount ────────────────────────────────

  useEffect(() => {
    async function load() {
      setTemplatesLoading(true);
      setTemplatesError(null);
      try {
        const res = await fetch("/api/reqvet/templates");
        if (!res.ok) throw new Error("Impossible de charger les templates");
        const data = await res.json();
        setTemplates(data);
        const all = [...(data.system || []), ...(data.custom || [])];
        if (all.length > 0 && !selectedTemplate) {
          setSelectedTemplate(all[0].id);
        }
      } catch (err) {
        setTemplatesError(err instanceof Error ? err.message : "Erreur");
      } finally {
        setTemplatesLoading(false);
      }
    }
    load();
  }, []);

  // ─── Recording timer ────────────────────────────────────────

  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isRecording]);

  useEffect(() => {
    if (amendRecording) {
      amendTimerRef.current = setInterval(() => setAmendRecordingTime((t) => t + 1), 1000);
    } else {
      clearInterval(amendTimerRef.current);
    }
    return () => clearInterval(amendTimerRef.current);
  }, [amendRecording]);

  // ─── Poll job status ────────────────────────────────────────
  // En production : remplacer par WebSocket/SSE depuis le webhook handler

  useEffect(() => {
    if (!jobId || jobStatus === "completed" || jobStatus === "failed" || jobStatus === "idle") {
      clearInterval(pollRef.current);
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/reqvet/job?jobId=${jobId}`);
        if (!res.ok) return;
        const data = await res.json();

        setJobStatus(data.status);

        if (data.status === "completed") {
          setReport({
            html: data.html ?? "",
            transcription: data.transcription ?? "",
            fields: data.fields ?? null,
            amendment_number: data.amendment_number ?? 0,
          });
          clearInterval(pollRef.current);
        } else if (data.status === "failed") {
          setJobError(data.error ?? "Erreur inconnue");
          clearInterval(pollRef.current);
        }
      } catch (err) {
        console.error("Poll error:", err);
      }
    }, 3000);

    return () => clearInterval(pollRef.current);
  }, [jobId, jobStatus]);

  // ─── Réinitialise les champs au changement de consultation ──

  useEffect(() => {
    setMotifText(consult?.motif ?? "");
    const cr = consult?.compte_rendu ?? "";
    setCompteRenduText(cr);
    setCompteRenduEditing(!/<[a-z][\s\S]*>/i.test(cr));
    setConclusionText(consult?.conclusion ?? "");
  }, [selectedId]);

  // ─── Auto-remplit les champs quand la pipeline termine ───────

  useEffect(() => {
    if (!report) return;
    if (report.fields?.motif) setMotifText(String(report.fields.motif));
    setCompteRenduText(stripHtml(report.html));
    setCompteRenduEditing(true);
    if (report.fields?.conclusion) setConclusionText(String(report.fields.conclusion));
  }, [report]);

  // ─── Autosave dossier (debounce 1 s) ────────────────────────

  useEffect(() => {
    if (!selectedId) return;
    clearTimeout(autosaveRef.current);
    autosaveRef.current = setTimeout(() => {
      fetch(`/api/consultations/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          motif: motifText,
          compte_rendu: compteRenduText || null,
          conclusion: conclusionText || null,
        }),
      }).catch(() => {/* autosave silencieux */});
    }, 1000);
    return () => clearTimeout(autosaveRef.current);
  }, [selectedId, motifText, compteRenduText, conclusionText]);

  // ─── Helpers ────────────────────────────────────────────────

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const filteredConsults = consultations.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.patient_name.toLowerCase().includes(q) ||
      c.owner_name.toLowerCase().includes(q) ||
      c.motif.toLowerCase().includes(q)
    );
  });

  // ─── Audio Recording (real MediaRecorder) ───────────────────

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 32000 });
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        const file = new File([blob], `consultation-${Date.now()}.webm`, { type: "audio/webm" });
        setUploadedFile(file);
        setAudioChunks([]);
        stream.getTracks().forEach((t) => t.stop());
      };

      setMediaRecorder(recorder);
      setAudioChunks(chunks);
      recorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      setUploadedFile(null);
    } catch (err) {
      alert("Impossible d'accéder au microphone. Vérifiez les permissions.");
    }
  }, []);

  const stopRecording = useCallback(() => {
    mediaRecorder?.stop();
    setIsRecording(false);
    setMediaRecorder(null);
  }, [mediaRecorder]);

  // ─── Amend Recording ───────────────────────────────────────

  const startAmendRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 32000 });
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        const file = new File([blob], `complement-${Date.now()}.webm`, { type: "audio/webm" });
        setAmendFile(file);
        setAmendChunks([]);
        stream.getTracks().forEach((t) => t.stop());
      };

      setAmendMediaRecorder(recorder);
      setAmendChunks(chunks);
      recorder.start();
      setAmendRecording(true);
      setAmendRecordingTime(0);
      setAmendFile(null);
    } catch (err) {
      alert("Impossible d'accéder au microphone.");
    }
  }, []);

  const stopAmendRecording = useCallback(() => {
    amendMediaRecorder?.stop();
    setAmendRecording(false);
    setAmendMediaRecorder(null);
  }, [amendMediaRecorder]);

  // ─── Créer une consultation ──────────────────────────────────

  const handleCreateConsultation = useCallback(async () => {
    if (!newForm.patient_name.trim() || !newForm.patient_species.trim() || !newForm.owner_name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/consultations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newForm),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "Erreur création consultation");
        return;
      }
      const { id } = await res.json();
      setShowNewModal(false);
      setNewForm({ patient_name: "", patient_species: "Chien", patient_breed: "", patient_age: "", patient_weight: "", owner_name: "", vet_name: "", motif: "" });
      router.refresh();
      setSelectedId(id);
    } finally {
      setCreating(false);
    }
  }, [newForm, router]);

  // ─── Submit Job (real API call through proxy) ───────────────

  const handleSubmitJob = useCallback(async () => {
    if (!uploadedFile || !selectedTemplate || !consult) return;

    const MAX_SIZE_MB = 100;
    if (uploadedFile.size > MAX_SIZE_MB * 1024 * 1024) {
      setJobError(`Fichier trop volumineux (${(uploadedFile.size / 1024 / 1024).toFixed(1)} Mo). Maximum : ${MAX_SIZE_MB} Mo.`);
      setJobStatus("failed");
      return;
    }

    setJobStatus("uploading");
    setJobError(null);
    setReport(null);
    setReformulations([]);
    setActiveReformTab(null);
    setActiveTab("report");

    try {
      const form = new FormData();
      form.append("audio", uploadedFile);
      form.append("animalName", consult.patient_name);
      form.append("templateId", selectedTemplate);
      form.append("consultationId", consult.id);
      if (extraInstructions.trim()) {
        form.append("extraInstructions", extraInstructions.trim());
      }

      // POST vers notre proxy — PAS directement vers ReqVet
      const res = await fetch("/api/reqvet/generate", {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Erreur HTTP ${res.status}`);
      }

      const data = await res.json();
      setJobId(data.job_id);
      setJobStatus("pending");
    } catch (err) {
      setJobError(err instanceof Error ? err.message : "Erreur lors de l'envoi");
      setJobStatus("failed");
    }
  }, [uploadedFile, selectedTemplate, consult, extraInstructions]);

  // ─── Reformulate (real API call) ────────────────────────────

  const handleReformulate = useCallback(
    async (purpose: string) => {
      if (!jobId) return;

      setReformLoading(purpose);
      try {
        const res = await fetch("/api/reqvet/reformulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId,
            purpose,
            ...(purpose === "custom" ? { customInstructions: customReformInstructions } : {}),
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Erreur reformulation");
        }

        const data = await res.json();
        setReformulations((prev) => [...prev, data]);
        setActiveReformTab(data.id);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Erreur reformulation");
      } finally {
        setReformLoading(null);
      }
    },
    [jobId, customReformInstructions]
  );

  // ─── Amend (real API call) ──────────────────────────────────

  const handleAmendSubmit = useCallback(async () => {
    if (!amendFile || !jobId) return;

    setAmendSubmitting(true);
    try {
      const form = new FormData();
      form.append("audio", amendFile);
      form.append("jobId", jobId);

      const res = await fetch("/api/reqvet/amend", {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erreur amendement");
      }

      setJobStatus("amending");
      setAmendFile(null);
      setAmendRecordingTime(0);
      setActiveTab("report");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur amendement");
    } finally {
      setAmendSubmitting(false);
    }
  }, [amendFile, jobId]);

  // ─── Reset ──────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    clearInterval(pollRef.current);
    setJobId(null);
    setJobStatus("idle");
    setReport(null);
    setJobError(null);
    setUploadedFile(null);
    setRecordingTime(0);
    setIsRecording(false);
    setReformulations([]);
    setActiveReformTab(null);
    setExtraInstructions("");
    setAmendFile(null);
    setActiveTab("report");
  }, []);

  // ─── Render ─────────────────────────────────────────────────

  return (
    <div className={styles.app}>
      {/* ── Topbar ──────────────────────────────────────────── */}
      <header className={styles.topbar}>
        <div className={styles.topbarLogo}>
          <div className={styles.topbarLogoIcon}>VP</div>
          <span>VetPulse</span>
        </div>
        <nav className={styles.topbarNav}>
          <button className={styles.topbarNavItem}>Planning</button>
          <button className={`${styles.topbarNavItem} ${styles.active}`}>Consultations</button>
          <button className={styles.topbarNavItem}>Patients</button>
          <button className={styles.topbarNavItem}>Facturation</button>
        </nav>
        <div className={styles.topbarRight}>
          <span className={styles.reqvetBadge}>ReqVet connecté ✓</span>
          <div className={styles.vetAvatar}>
            <div className={styles.vetAvatarCircle}>DM</div>
            Dr. Martin
          </div>
        </div>
      </header>

      <div className={styles.mainLayout}>
        {/* ── Sidebar ──────────────────────────────────────── */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <div className={styles.sidebarTitle}>Consultations du jour</div>
            <input
              className={styles.searchInput}
              placeholder="Rechercher patient, propriétaire…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className={styles.sidebarNewBtn} onClick={() => setShowNewModal(true)}>
              + Nouvelle consultation
            </button>
          </div>
          <div className={styles.sidebarList}>
            {filteredConsults.map((c) => (
              <div
                key={c.id}
                className={`${styles.consultCard} ${selectedId === c.id ? styles.consultCardActive : ""}`}
                onClick={() => {
                  setSelectedId(c.id);
                  handleReset();
                }}
              >
                <div className={styles.consultCardTop}>
                  <div className={styles.patientAvatar}>
                    {SPECIES_EMOJI[c.patient_species] ?? "🐾"}
                  </div>
                  <div className={styles.patientInfo}>
                    <strong>{c.patient_name}</strong>
                    <span>
                      {c.patient_species} • {c.patient_breed} • {c.owner_name}
                    </span>
                  </div>
                </div>
                <div className={styles.consultCardBottom}>
                  <span className={styles.consultMotif}>{c.motif}</span>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* ── Content ──────────────────────────────────────── */}
        <main className={styles.content}>
          {!consult ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>🩺</div>
              <h3>Sélectionnez une consultation</h3>
              <p>
                Choisissez une consultation dans la liste pour démarrer
                l'enregistrement et générer un compte-rendu IA via ReqVet.
              </p>
            </div>
          ) : (
            <>
              {/* Patient header */}
              <div className={styles.contentHeader}>
                <div className={styles.headerLeft}>
                  <div className={styles.headerAvatar}>
                    {SPECIES_EMOJI[consult.patient_species] ?? "🐾"}
                  </div>
                  <div>
                    <h2 className={styles.headerName}>{consult.patient_name}</h2>
                    <div className={styles.headerMeta}>
                      {consult.patient_species} — {consult.patient_breed} • {consult.patient_age} • {consult.patient_weight} • Prop. : {consult.owner_name}
                    </div>
                  </div>
                </div>
                <div className={styles.headerRight}>
                  {jobStatus !== "idle" && <StatusBadge status={jobStatus} />}
                </div>
              </div>

              <div className={styles.contentBody}>
                {/* ── Dossier — toujours visible ───────────── */}
                <Section icon="📋" title="Dossier de consultation" iconBg="#f0fdf4" iconColor="#16a34a">
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div>
                      <div className={styles.fieldLabel} style={{ marginBottom: 4 }}>Motif</div>
                      <textarea
                        className={styles.textarea}
                        value={motifText}
                        onChange={(e) => setMotifText(e.target.value)}
                        placeholder="Motif de la consultation…"
                        style={{ minHeight: 60 }}
                      />
                    </div>
                    <div>
                      <div className={styles.fieldLabel} style={{ marginBottom: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span>Compte-Rendu</span>
                        {compteRenduText && (
                          <button
                            style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "1px solid #d1d5db", background: "#f9fafb", cursor: "pointer", color: "#374151" }}
                            onClick={() => setCompteRenduEditing((v) => !v)}
                          >
                            {compteRenduEditing ? "Aperçu" : "Modifier"}
                          </button>
                        )}
                      </div>
                      {compteRenduEditing ? (
                        <textarea
                          className={styles.textarea}
                          value={compteRenduText}
                          onChange={(e) => setCompteRenduText(e.target.value)}
                          placeholder="Rédigez le compte-rendu ici, ou lancez la pipeline ReqVet pour le générer automatiquement…"
                          style={{ minHeight: 140 }}
                        />
                      ) : (
                        <div
                          className={styles.reportViewer}
                          dangerouslySetInnerHTML={{ __html: compteRenduText }}
                        />
                      )}
                    </div>
                    <div>
                      <div className={styles.fieldLabel} style={{ marginBottom: 4 }}>Conclusion</div>
                      <textarea
                        className={styles.textarea}
                        value={conclusionText}
                        onChange={(e) => setConclusionText(e.target.value)}
                        placeholder="Conclusion…"
                        style={{ minHeight: 60 }}
                      />
                    </div>
                  </div>
                </Section>

                {/* ── PHASE 1: Template + Audio + Submit ──── */}
                {jobStatus === "idle" && (
                  <div className="fade-in">
                    {/* Template picker */}
                    <Section icon="📄" title="Template de compte-rendu" iconBg="#eef2ff" iconColor="#6366f1">
                      {templatesLoading && <p className={styles.muted}>Chargement des templates…</p>}
                      {templatesError && <p className={styles.error}>{templatesError}</p>}
                      {templates && (
                        <div className={styles.templateGrid}>
                          {[
                            ...templates.system.map((t) => ({ ...t, type: "system" })),
                            ...templates.custom.map((t) => ({ ...t, type: "custom" })),
                          ].map((t) => (
                            <div
                              key={t.id}
                              className={`${styles.templateItem} ${selectedTemplate === t.id ? styles.templateItemSelected : ""}`}
                              onClick={() => setSelectedTemplate(t.id)}
                            >
                              <span className={`${styles.templateBadge} ${t.type === "system" ? styles.badgeSystem : styles.badgeCustom}`}>
                                {t.type === "system" ? "Système" : "Custom"}
                              </span>
                              <div className={styles.templateName}>{t.name}</div>
                              <div className={styles.templateDesc}>{t.description}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </Section>

                    {/* Audio recorder / uploader */}
                    <Section icon="🎙️" title="Audio de consultation" iconBg="#fef2f2" iconColor="#ef4444">
                      <div className={styles.recorderZone}>
                        <button
                          className={`${styles.recorderBtn} ${isRecording ? styles.recorderBtnRecording : styles.recorderBtnIdle}`}
                          onClick={isRecording ? stopRecording : startRecording}
                        >
                          {isRecording ? "■" : "●"}
                        </button>

                        {isRecording && (
                          <div className={styles.recorderTimer}>{formatTime(recordingTime)}</div>
                        )}

                        <div className={styles.recorderHint}>
                          {isRecording
                            ? "Enregistrement en cours — cliquez pour arrêter"
                            : uploadedFile
                            ? null
                            : "Cliquez pour enregistrer la consultation"}
                        </div>

                        {uploadedFile && (
                          <div className={styles.fileChip}>
                            📎 {uploadedFile.name} ({(uploadedFile.size / 1024 / 1024).toFixed(1)} Mo)
                            <button className={styles.fileChipRemove} onClick={() => setUploadedFile(null)}>
                              ×
                            </button>
                          </div>
                        )}

                        {!isRecording && !uploadedFile && (
                          <>
                            <div className={styles.muted} style={{ fontSize: 12 }}>— ou —</div>
                            <div className={styles.uploadZone} onClick={() => fileInputRef.current?.click()}>
                              <strong style={{ color: "var(--accent)" }}>Importer un fichier audio</strong>
                              <br />
                              MP3, WAV, WebM, OGG, M4A, AAC, FLAC — max 100 Mo
                            </div>
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept="audio/*"
                              style={{ display: "none" }}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) setUploadedFile(f);
                              }}
                            />
                          </>
                        )}
                      </div>
                    </Section>

                    {/* Extra instructions */}
                    <Section icon="💡" title="Instructions supplémentaires" iconBg="#fffbeb" iconColor="#d97706" subtitle="(optionnel)">
                      <textarea
                        className={styles.textarea}
                        placeholder="Ex : Insister sur le suivi post-opératoire, mentionner le régime alimentaire recommandé…"
                        value={extraInstructions}
                        onChange={(e) => setExtraInstructions(e.target.value)}
                      />
                      <p className={styles.muted} style={{ marginTop: 6, fontSize: 11 }}>
                        Enrichit le prompt de génération. N'affecte pas les champs structurés (fields).
                      </p>
                    </Section>

                    {/* Submit */}
                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                      <button
                        className={styles.btnPrimary}
                        disabled={!uploadedFile || !selectedTemplate}
                        onClick={handleSubmitJob}
                      >
                        🚀 Générer le compte-rendu
                      </button>
                    </div>
                  </div>
                )}

                {/* ── PHASE 2: Pipeline in progress ──────── */}
                {(jobStatus === "uploading" || jobStatus === "pending" || jobStatus === "transcribing" || jobStatus === "generating" || jobStatus === "amending") && (
                  <div className="fade-in">
                    <Section icon="⚡" title="Pipeline ReqVet" iconBg="#eef2ff" iconColor="#6366f1">
                      <PipelineProgress status={jobStatus} />
                      <p className={styles.muted} style={{ textAlign: "center", marginTop: 16 }}>
                        {jobStatus === "uploading" && "Envoi de l'audio vers ReqVet…"}
                        {jobStatus === "pending" && "Job créé — en attente de traitement…"}
                        {jobStatus === "transcribing" && "Transcription de la consultation par Whisper…"}
                        {jobStatus === "generating" && "Génération du compte-rendu par l'IA…"}
                        {jobStatus === "amending" && "Intégration du complément audio — le CR sera régénéré…"}
                      </p>
                    </Section>
                  </div>
                )}

                {/* ── PHASE 2b: Error ────────────────────── */}
                {jobStatus === "failed" && (
                  <div className="fade-in">
                    <Section icon="❌" title="Erreur" iconBg="#fef2f2" iconColor="#ef4444">
                      <p className={styles.error}>{jobError ?? "Une erreur est survenue."}</p>
                      <button className={styles.btnSecondary} onClick={handleReset} style={{ marginTop: 12 }}>
                        ↺ Réessayer
                      </button>
                    </Section>
                  </div>
                )}

                {/* ── PHASE 3: Report ready ──────────────── */}
                {report && jobStatus === "completed" && (
                  <div className="fade-in">
                    {/* Tabs */}
                    <div className={styles.viewTabs}>
                      {(["report", "transcription", "fields", "reformulations", "amend"] as const).map((tab) => (
                        <button
                          key={tab}
                          className={`${styles.viewTab} ${activeTab === tab ? styles.viewTabActive : ""}`}
                          onClick={() => setActiveTab(tab)}
                        >
                          {tab === "report" && "Compte-rendu"}
                          {tab === "transcription" && "Transcription"}
                          {tab === "fields" && "Fields"}
                          {tab === "reformulations" && `Reformulations${reformulations.length ? ` (${reformulations.length})` : ""}`}
                          {tab === "amend" && "Amendement"}
                        </button>
                      ))}
                      <button className={styles.btnGhost} onClick={handleReset} style={{ marginLeft: "auto" }}>
                        ↺ Nouvelle consultation
                      </button>
                    </div>

                    {/* Tab: Report */}
                    {activeTab === "report" && (
                      <Section icon="✅" title="Compte-rendu généré" iconBg="#ecfdf5" iconColor="#059669">
                        {report.amendment_number > 0 && (
                          <div className={styles.amendBadge}>
                            + Amendement #{report.amendment_number} intégré
                          </div>
                        )}
                        <div
                          className={styles.reportViewer}
                          dangerouslySetInnerHTML={{ __html: report.html }}
                        />
                      </Section>
                    )}

                    {/* Tab: Transcription */}
                    {activeTab === "transcription" && (
                      <Section icon="📝" title="Transcription complète" iconBg="#f5f3ff" iconColor="#7c3aed">
                        <div className={styles.transcriptionBox}>{report.transcription || "Aucune transcription."}</div>
                      </Section>
                    )}

                    {/* Tab: Fields */}
                    {activeTab === "fields" && (
                      <Section icon="📊" title="Champs structurés (fields)" iconBg="#fffbeb" iconColor="#d97706">
                        {report.fields ? (
                          <div className={styles.fieldsGrid}>
                            {Object.entries(report.fields).map(([key, val]) => (
                              <div className={styles.fieldItem} key={key}>
                                <div className={styles.fieldLabel}>{key}</div>
                                <div className={styles.fieldValue}>
                                  {val === null
                                    ? "—"
                                    : typeof val === "boolean"
                                    ? val
                                      ? "Oui"
                                      : "Non"
                                    : String(val)}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className={styles.muted} style={{ fontStyle: "italic" }}>
                            Aucun field_schema configuré pour cette organisation. Les fields seront disponibles
                            une fois le schema activé par l'équipe ReqVet.
                          </p>
                        )}
                      </Section>
                    )}

                    {/* Tab: Reformulations */}
                    {activeTab === "reformulations" && (
                      <Section icon="🔄" title="Reformuler le compte-rendu" iconBg="#eef2ff" iconColor="#6366f1">
                        <div className={styles.reformPurposes}>
                          {REFORMULATION_PURPOSES.map((rp) => {
                            const done = reformulations.some((r) => r.purpose === rp.value);
                            const loading = reformLoading === rp.value;
                            return (
                              <button
                                key={rp.value}
                                className={`${styles.reformPurposeBtn} ${done ? styles.reformPurposeDone : ""}`}
                                disabled={loading || done || (rp.value === "custom" && !customReformInstructions)}
                                onClick={() => handleReformulate(rp.value)}
                                title={rp.desc}
                              >
                                <span>{rp.icon}</span>
                                <span>{rp.label}</span>
                                {loading && <span className="spinner" />}
                                {done && " ✓"}
                              </button>
                            );
                          })}
                        </div>

                        {!reformulations.some((r) => r.purpose === "custom") && (
                          <textarea
                            className={styles.textarea}
                            placeholder="Instructions pour la reformulation personnalisée…"
                            value={customReformInstructions}
                            onChange={(e) => setCustomReformInstructions(e.target.value)}
                            style={{ marginBottom: 16, minHeight: 60 }}
                          />
                        )}

                        {reformulations.length > 0 && (
                          <>
                            <div className={styles.reformTabs}>
                              {reformulations.map((r) => {
                                const rp = REFORMULATION_PURPOSES.find((p) => p.value === r.purpose);
                                return (
                                  <button
                                    key={r.id}
                                    className={`${styles.reformTab} ${activeReformTab === r.id ? styles.reformTabActive : ""}`}
                                    onClick={() => setActiveReformTab(r.id)}
                                  >
                                    {rp?.icon} {rp?.label}
                                  </button>
                                );
                              })}
                            </div>
                            {reformulations
                              .filter((r) => r.id === activeReformTab)
                              .map((r) => (
                                <div key={r.id} className="fade-in">
                                  <div
                                    className={styles.reportViewer}
                                    dangerouslySetInnerHTML={{ __html: r.html }}
                                  />
                                  <div className={styles.reformMeta}>
                                    {r.cost && (
                                      <span className={styles.costBadge}>
                                        💲 {r.cost.cost_usd.toFixed(4)} USD
                                      </span>
                                    )}
                                    <span className={styles.muted}>
                                      Généré le {new Date(r.created_at).toLocaleString("fr-FR")}
                                    </span>
                                    {r.custom_instructions && (
                                      <span style={{ color: "var(--purple)", fontStyle: "italic", fontSize: 11 }}>
                                        « {r.custom_instructions.slice(0, 80)}… »
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}
                          </>
                        )}
                      </Section>
                    )}

                    {/* Tab: Amend */}
                    {activeTab === "amend" && (
                      <Section icon="➕" title="Ajouter un complément audio" iconBg="#f5f3ff" iconColor="#7c3aed">
                        <p className={styles.muted} style={{ marginBottom: 16 }}>
                          Ajoutez un audio complémentaire (résultats d'analyse, correction…). La transcription
                          sera fusionnée et le CR régénéré automatiquement.
                        </p>

                        {report.amendment_number > 0 && (
                          <div className={styles.amendBadge} style={{ marginBottom: 16 }}>
                            ✓ {report.amendment_number} amendement{report.amendment_number > 1 ? "s" : ""} déjà intégré{report.amendment_number > 1 ? "s" : ""}
                          </div>
                        )}

                        <div className={styles.amendActions}>
                          <button
                            className={amendRecording ? styles.btnDanger : styles.btnSecondary}
                            onClick={amendRecording ? stopAmendRecording : startAmendRecording}
                          >
                            {amendRecording ? `■ Stop (${formatTime(amendRecordingTime)})` : "🎙️ Enregistrer"}
                          </button>

                          <span className={styles.muted}>ou</span>

                          <button className={styles.btnSecondary} onClick={() => amendFileInputRef.current?.click()}>
                            📁 Importer audio
                          </button>
                          <input
                            ref={amendFileInputRef}
                            type="file"
                            accept="audio/*"
                            style={{ display: "none" }}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) setAmendFile(f);
                            }}
                          />

                          {amendFile && (
                            <>
                              <div className={styles.fileChip}>
                                📎 {amendFile.name}
                                <button className={styles.fileChipRemove} onClick={() => setAmendFile(null)}>×</button>
                              </div>
                              <button
                                className={styles.btnPrimary}
                                onClick={handleAmendSubmit}
                                disabled={amendSubmitting}
                              >
                                {amendSubmitting ? <><span className="spinner" /> Envoi…</> : "🚀 Soumettre l'amendement"}
                              </button>
                            </>
                          )}
                        </div>
                      </Section>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {/* ── Modal nouvelle consultation ───────────────────── */}
      {showNewModal && (
        <div className={styles.modalOverlay} onClick={() => setShowNewModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>Nouvelle consultation</div>
            <div className={styles.modalGrid}>
              <div className={styles.modalGridFull}>
                <div className={styles.modalLabel}>Nom du patient *</div>
                <input className={styles.modalInput} value={newForm.patient_name} onChange={(e) => setNewForm((f) => ({ ...f, patient_name: e.target.value }))} placeholder="Rex" />
              </div>
              <div>
                <div className={styles.modalLabel}>Espèce *</div>
                <select className={styles.modalInput} value={newForm.patient_species} onChange={(e) => setNewForm((f) => ({ ...f, patient_species: e.target.value }))}>
                  {["Chien", "Chat", "Lapin", "Oiseau", "NAC", "Autre"].map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <div className={styles.modalLabel}>Race</div>
                <input className={styles.modalInput} value={newForm.patient_breed} onChange={(e) => setNewForm((f) => ({ ...f, patient_breed: e.target.value }))} placeholder="Berger Allemand" />
              </div>
              <div>
                <div className={styles.modalLabel}>Âge</div>
                <input className={styles.modalInput} value={newForm.patient_age} onChange={(e) => setNewForm((f) => ({ ...f, patient_age: e.target.value }))} placeholder="3 ans" />
              </div>
              <div>
                <div className={styles.modalLabel}>Poids</div>
                <input className={styles.modalInput} value={newForm.patient_weight} onChange={(e) => setNewForm((f) => ({ ...f, patient_weight: e.target.value }))} placeholder="12 kg" />
              </div>
              <div>
                <div className={styles.modalLabel}>Propriétaire *</div>
                <input className={styles.modalInput} value={newForm.owner_name} onChange={(e) => setNewForm((f) => ({ ...f, owner_name: e.target.value }))} placeholder="Jean Dupont" />
              </div>
              <div>
                <div className={styles.modalLabel}>Vétérinaire</div>
                <input className={styles.modalInput} value={newForm.vet_name} onChange={(e) => setNewForm((f) => ({ ...f, vet_name: e.target.value }))} placeholder="Dr. Martin" />
              </div>
              <div className={styles.modalGridFull}>
                <div className={styles.modalLabel}>Motif</div>
                <input className={styles.modalInput} value={newForm.motif} onChange={(e) => setNewForm((f) => ({ ...f, motif: e.target.value }))} placeholder="Vaccination annuelle…" />
              </div>
            </div>
            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={() => setShowNewModal(false)} disabled={creating}>Annuler</button>
              <button
                className={styles.btnPrimary}
                onClick={handleCreateConsultation}
                disabled={creating || !newForm.patient_name.trim() || !newForm.owner_name.trim()}
              >
                {creating ? "Création…" : "Créer la consultation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Utilitaires ────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// ─── Sub-components ─────────────────────────────────────────

function Section({
  icon,
  title,
  iconBg,
  iconColor,
  subtitle,
  children,
}: {
  icon: string;
  title: string;
  iconBg: string;
  iconColor: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionIcon} style={{ background: iconBg, color: iconColor }}>
          {icon}
        </div>
        <span>{title}</span>
        {subtitle && <span className={styles.muted} style={{ fontWeight: 400, marginLeft: 4, fontSize: 11 }}>{subtitle}</span>}
      </div>
      <div className={styles.sectionBody}>{children}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: JobStatus }) {
  const MAP: Record<string, { label: string; color: string; bg: string }> = {
    idle: { label: "", color: "", bg: "" },
    uploading: { label: "Envoi…", color: "#6366f1", bg: "#eef2ff" },
    pending: { label: "En attente", color: "#94a3b8", bg: "#f1f5f9" },
    transcribing: { label: "Transcription…", color: "#6366f1", bg: "#eef2ff" },
    generating: { label: "Génération…", color: "#f59e0b", bg: "#fffbeb" },
    completed: { label: "Terminé", color: "#059669", bg: "#ecfdf5" },
    failed: { label: "Erreur", color: "#ef4444", bg: "#fef2f2" },
    amending: { label: "Amendement…", color: "#7c3aed", bg: "#f5f3ff" },
  };
  const s = MAP[status] ?? MAP.pending;
  const isLoading = ["uploading", "pending", "transcribing", "generating", "amending"].includes(status);

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: s.bg, color: s.color }}>
      {isLoading && <span className="spinner" />}
      {status === "completed" && "✓ "}
      {status === "failed" && "✕ "}
      {s.label}
    </span>
  );
}

function PipelineProgress({ status }: { status: JobStatus }) {
  const steps = [
    { key: "uploading", label: "Envoi" },
    { key: "transcribing", label: "Transcription" },
    { key: "generating", label: "Génération" },
    { key: "completed", label: "Terminé" },
  ];
  const order = ["uploading", "pending", "transcribing", "generating", "completed"];
  const idx = order.indexOf(status);

  return (
    <div className={styles.pipelineSteps}>
      {steps.map((step, i) => {
        const stepIdx = order.indexOf(step.key);
        let cls = styles.pipelineStep;
        if (stepIdx < idx) cls += ` ${styles.pipelineStepDone}`;
        else if (stepIdx === idx || (status === "pending" && step.key === "uploading")) cls += ` ${styles.pipelineStepActive}`;
        else if (status === "amending" && step.key === "generating") cls += ` ${styles.pipelineStepActive}`;

        return (
          <div key={step.key} style={{ display: "flex", alignItems: "center", gap: 0 }}>
            {i > 0 && (
              <div
                className={styles.pipelineConnector}
                style={{ background: stepIdx <= idx ? "var(--success)" : "var(--border)" }}
              />
            )}
            <div className={cls}>
              {stepIdx < idx ? "✓ " : stepIdx === idx && status !== "completed" ? <><span className="spinner" />{" "}</> : ""}
              {step.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
