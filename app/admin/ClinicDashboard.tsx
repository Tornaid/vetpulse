"use client";

import { useState, useEffect, useCallback } from "react";
import styles from "./admin.module.css";

// ─── Types ───────────────────────────────────────────────────

interface ClinicOrg {
  id: string;
  name: string;
  contact_email: string | null;
  is_active: boolean;
  monthly_quota: number | null;
  external_id: string | null;
  created_at: string;
  notes: string | null;
  usage?: {
    jobs_this_month: number;
    quota_remaining: number | "unlimited";
  };
}

interface Credentials {
  clinicName: string;
  api_key: string;
  webhook_secret: string;
  warning: string;
}

// ─── Sous-composants ─────────────────────────────────────────

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={active ? styles.badgeActive : styles.badgeInactive}>
      {active ? "Actif" : "Inactif"}
    </span>
  );
}

function UsageBar({ used, quota }: { used: number; quota: number | null | "unlimited" }) {
  if (!quota || quota === "unlimited") {
    return <span className={styles.usageMuted}>{used} jobs ce mois</span>;
  }
  const pct = Math.min(100, Math.round((used / quota) * 100));
  const danger = pct >= 90;
  const warning = pct >= 70;
  return (
    <div className={styles.usageWrap}>
      <div className={styles.usageBar}>
        <div
          className={styles.usageFill}
          style={{
            width: `${pct}%`,
            background: danger ? "var(--danger)" : warning ? "var(--warning)" : "var(--accent)",
          }}
        />
      </div>
      <span className={styles.usageLabel}>
        {used} / {quota} jobs ({pct}%)
      </span>
    </div>
  );
}

// ─── Modal : credentials (affichage unique) ───────────────────

function CredentialsModal({ creds, onClose }: { creds: Credentials; onClose: () => void }) {
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  function copy(text: string, which: "key" | "secret") {
    navigator.clipboard.writeText(text);
    if (which === "key") {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } else {
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Clinique creee : {creds.clinicName}</h2>
          <p className={styles.warningBanner}>{creds.warning}</p>
        </div>

        <div className={styles.credBlock}>
          <label className={styles.credLabel}>Cle API clinique</label>
          <div className={styles.credRow}>
            <code className={styles.credValue}>{creds.api_key}</code>
            <button
              className={styles.btnCopy}
              onClick={() => copy(creds.api_key, "key")}
            >
              {copiedKey ? "Copie !" : "Copier"}
            </button>
          </div>
        </div>

        <div className={styles.credBlock}>
          <label className={styles.credLabel}>Secret webhook</label>
          <div className={styles.credRow}>
            <code className={styles.credValue}>{creds.webhook_secret}</code>
            <button
              className={styles.btnCopy}
              onClick={() => copy(creds.webhook_secret, "secret")}
            >
              {copiedSecret ? "Copie !" : "Copier"}
            </button>
          </div>
        </div>

        <div className={styles.credInstructions}>
          <p className={styles.credInstructionsTitle}>Comment configurer la clinique</p>
          <p>1. Ouvrez le <code>.env.local</code> du Vetpulse de la clinique</p>
          <p>2. Definissez :</p>
          <pre className={styles.envPreview}>
{`REQVET_API_KEY=${creds.api_key}
REQVET_WEBHOOK_SECRET=${creds.webhook_secret}`}
          </pre>
          <p>3. Sauvegardez ces valeurs dans votre gestionnaire de mots de passe (Bitwarden, 1Password...)</p>
        </div>

        <div className={styles.modalFooter}>
          <button className={styles.btnPrimary} onClick={onClose}>
            J&apos;ai sauvegarde les credentials
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal : creer une clinique ───────────────────────────────

function CreateClinicModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (creds: Credentials) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [quota, setQuota] = useState("200");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/clinics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          contactEmail: email.trim() || undefined,
          monthlyQuota: quota ? Number(quota) : undefined,
          notes: notes.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur interne");

      if (data.already_existed) {
        setError(`Une clinique avec cet ID existe deja (${data.message}). Les credentials ne peuvent pas etre re-affiches.`);
        setLoading(false);
        return;
      }

      onCreated({
        clinicName: data.organization.name,
        api_key: data.api_key,
        webhook_secret: data.webhook_secret,
        warning: data.warning,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur interne");
      setLoading(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Ajouter une clinique</h2>
        </div>

        <form onSubmit={submit} className={styles.form}>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Nom de la clinique *</label>
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Clinique Veterinaire du Parc"
              required
            />
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel}>Email de contact</label>
            <input
              className={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contact@clinique.fr"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel}>Quota mensuel (jobs)</label>
            <input
              className={styles.input}
              type="number"
              min={1}
              max={10000}
              value={quota}
              onChange={(e) => setQuota(e.target.value)}
            />
            <span className={styles.fieldHint}>Defaut : 200. Maximum : 10 000.</span>
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel}>Notes internes</label>
            <textarea
              className={styles.textarea}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Phase pilote — Dr Dupont, contact le 01/03/2026..."
              rows={3}
            />
          </div>

          {error && <p className={styles.errorMsg}>{error}</p>}

          <div className={styles.modalFooter}>
            <button type="button" className={styles.btnGhost} onClick={onClose} disabled={loading}>
              Annuler
            </button>
            <button type="submit" className={styles.btnPrimary} disabled={loading || !name.trim()}>
              {loading ? <span className="spinner" /> : "Creer la clinique"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Modal : detail clinique ──────────────────────────────────

function ClinicDetailModal({
  org,
  onClose,
  onUpdated,
}: {
  org: ClinicOrg;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [quota, setQuota] = useState(String(org.monthly_quota ?? ""));
  const [notes, setNotes] = useState(org.notes ?? "");
  const [loading, setLoading] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  async function save() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/clinics/${org.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthlyQuota: quota ? Number(quota) : undefined,
          notes: notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur");
      onUpdated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  async function deactivate() {
    setDeactivating(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/clinics/${org.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur");
      onUpdated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setDeactivating(false);
      setConfirm(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{org.name}</h2>
          <p className={styles.orgMeta}>
            ID ReqVet : <code>{org.id}</code>
            {org.contact_email && <> · {org.contact_email}</>}
          </p>
        </div>

        <div className={styles.form}>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Quota mensuel (jobs)</label>
            <input
              className={styles.input}
              type="number"
              min={1}
              max={10000}
              value={quota}
              onChange={(e) => setQuota(e.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel}>Notes internes</label>
            <textarea
              className={styles.textarea}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
            />
          </div>

          {org.usage && (
            <div className={styles.usageDetail}>
              <p className={styles.fieldLabel}>Utilisation ce mois</p>
              <UsageBar used={org.usage.jobs_this_month} quota={org.monthly_quota} />
            </div>
          )}

          {error && <p className={styles.errorMsg}>{error}</p>}

          {!confirm ? (
            <div className={styles.modalFooter}>
              {org.is_active && (
                <button
                  className={styles.btnDanger}
                  onClick={() => setConfirm(true)}
                  disabled={loading}
                >
                  Desactiver
                </button>
              )}
              <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
                <button className={styles.btnGhost} onClick={onClose} disabled={loading}>
                  Annuler
                </button>
                <button className={styles.btnPrimary} onClick={save} disabled={loading}>
                  {loading ? <span className="spinner" /> : "Enregistrer"}
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.confirmZone}>
              <p className={styles.confirmText}>
                Confirmer la desactivation de <strong>{org.name}</strong> ?
                Toutes ses cles API seront revoquees.
              </p>
              <div className={styles.modalFooter}>
                <button className={styles.btnGhost} onClick={() => setConfirm(false)}>
                  Annuler
                </button>
                <button className={styles.btnDanger} onClick={deactivate} disabled={deactivating}>
                  {deactivating ? <span className="spinner" /> : "Confirmer la desactivation"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard principal ──────────────────────────────────────

export function ClinicDashboard() {
  const [orgs, setOrgs] = useState<ClinicOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [pendingCreds, setPendingCreds] = useState<Credentials | null>(null);
  const [selectedOrg, setSelectedOrg] = useState<ClinicOrg | null>(null);

  const fetchOrgs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/clinics");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur");
      setOrgs(data.organizations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOrgs(); }, [fetchOrgs]);

  function handleCreated(creds: Credentials) {
    setShowCreate(false);
    setPendingCreds(creds);
    fetchOrgs();
  }

  const active = orgs.filter((o) => o.is_active);
  const inactive = orgs.filter((o) => !o.is_active);

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Gestion des cliniques</h1>
          <p className={styles.subtitle}>
            {active.length} clinique{active.length !== 1 ? "s" : ""} active{active.length !== 1 ? "s" : ""}
            {inactive.length > 0 && ` · ${inactive.length} inactive${inactive.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button className={styles.btnRefresh} onClick={fetchOrgs} disabled={loading}>
            {loading ? <span className="spinner" /> : "Actualiser"}
          </button>
          <button className={styles.btnPrimary} onClick={() => setShowCreate(true)}>
            + Ajouter une clinique
          </button>
        </div>
      </header>

      {/* Erreur */}
      {error && <div className={styles.errorBanner}>{error}</div>}

      {/* Liste */}
      {loading && orgs.length === 0 ? (
        <div className={styles.emptyState}>Chargement...</div>
      ) : orgs.length === 0 ? (
        <div className={styles.emptyState}>
          <p>Aucune clinique pour le moment.</p>
          <p style={{ marginTop: "6px", color: "var(--text-muted)", fontSize: "12px" }}>
            Cliquez sur &quot;Ajouter une clinique&quot; pour en creer une.
          </p>
        </div>
      ) : (
        <div className={styles.table}>
          <div className={styles.tableHead}>
            <span>Clinique</span>
            <span>Statut</span>
            <span>Utilisation</span>
            <span>Quota</span>
            <span>Creee le</span>
            <span />
          </div>

          {orgs.map((org) => (
            <div key={org.id} className={`${styles.tableRow} ${!org.is_active ? styles.tableRowInactive : ""}`}>
              <div>
                <p className={styles.orgName}>{org.name}</p>
                {org.contact_email && (
                  <p className={styles.orgEmail}>{org.contact_email}</p>
                )}
                {org.notes && (
                  <p className={styles.orgNotes}>{org.notes}</p>
                )}
              </div>

              <div>
                <StatusBadge active={org.is_active} />
              </div>

              <div>
                {org.usage ? (
                  <UsageBar
                    used={org.usage.jobs_this_month}
                    quota={org.monthly_quota}
                  />
                ) : (
                  <span className={styles.usageMuted}>—</span>
                )}
              </div>

              <div>
                <span className={styles.quota}>
                  {org.monthly_quota ? `${org.monthly_quota} / mois` : "Illimite"}
                </span>
              </div>

              <div>
                <span className={styles.date}>
                  {new Date(org.created_at).toLocaleDateString("fr-FR")}
                </span>
              </div>

              <div>
                <button
                  className={styles.btnManage}
                  onClick={() => setSelectedOrg(org)}
                >
                  Gerer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {showCreate && (
        <CreateClinicModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}

      {pendingCreds && (
        <CredentialsModal
          creds={pendingCreds}
          onClose={() => setPendingCreds(null)}
        />
      )}

      {selectedOrg && (
        <ClinicDetailModal
          org={selectedOrg}
          onClose={() => setSelectedOrg(null)}
          onUpdated={fetchOrgs}
        />
      )}
    </div>
  );
}
