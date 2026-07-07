"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../adminShell.module.css";
import formStyles from "./templates.module.css";

interface Template {
  id: string;
  name: string;
  description?: string;
  content: string;
  is_default?: boolean;
  created_at?: string;
  updated_at?: string;
}

const EMPTY: Template = { id: "", name: "", description: "", content: "", is_default: false };

export default function TemplatesClient() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Template | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/system-templates");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur");
      const list = Array.isArray(data) ? data : (data.templates ?? []);
      setTemplates(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = selectedId ? templates.find((t) => t.id === selectedId) : null;

  function startNew() {
    setSelectedId(null);
    setEditing({ ...EMPTY });
  }

  function startEdit(t: Template) {
    setSelectedId(t.id);
    setEditing({ ...t });
  }

  function cancelEdit() {
    setEditing(null);
    setSelectedId(null);
  }

  async function save() {
    if (!editing) return;
    if (!editing.name.trim() || !editing.content.trim()) {
      alert("Nom et contenu requis.");
      return;
    }

    setSaving(true);
    try {
      const isNew = !editing.id;
      const res = await fetch(
        isNew ? "/api/admin/system-templates" : `/api/admin/system-templates/${editing.id}`,
        {
          method: isNew ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: editing.name.trim(),
            content: editing.content,
            description: editing.description?.trim() || "",
            is_default: editing.is_default ?? false,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur");

      cancelEdit();
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/system-templates/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur");
      setConfirmDeleteId(null);
      cancelEdit();
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={formStyles.layout}>
      {/* Sidebar liste */}
      <aside className={formStyles.list}>
        <div className={formStyles.listHead}>
          <div>
            <div className={formStyles.listTitle}>Templates système</div>
            <div className={formStyles.listSub}>
              {templates.length} template{templates.length !== 1 ? "s" : ""} · visibles par toutes les cliniques
            </div>
          </div>
          <button className={formStyles.btnPrimary} onClick={startNew}>
            + Nouveau
          </button>
        </div>

        {error && <div className={formStyles.errorBox}>{error}</div>}

        {loading ? (
          <div style={{ padding: 20, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
            Chargement…
          </div>
        ) : templates.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>
              Aucun template système.
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#9ca3af" }}>
              Créez-en un pour qu&apos;il apparaisse chez toutes vos cliniques.
            </p>
          </div>
        ) : (
          <ul className={formStyles.items}>
            {templates.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => startEdit(t)}
                  className={`${formStyles.item} ${selectedId === t.id ? formStyles.itemActive : ""}`}
                >
                  <div className={formStyles.itemMain}>
                    <div className={formStyles.itemName}>{t.name}</div>
                    {t.description && (
                      <div className={formStyles.itemDesc}>{t.description}</div>
                    )}
                  </div>
                  {t.is_default && (
                    <span className={formStyles.badgeDefault}>★ Défaut</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* Éditeur */}
      <div className={formStyles.editor}>
        {!editing ? (
          <div className={formStyles.placeholder}>
            <div style={{ fontSize: 40 }}>📄</div>
            <h3>Sélectionnez un template</h3>
            <p>
              Cliquez sur un template dans la liste pour l&apos;éditer, ou créez-en un nouveau.
              Chaque template créé ici sera disponible automatiquement dans <strong>toutes vos cliniques</strong>.
            </p>
            <button className={formStyles.btnPrimary} onClick={startNew}>
              + Nouveau template
            </button>
          </div>
        ) : (
          <div className={formStyles.editorInner}>
            <header className={formStyles.editorHead}>
              <div>
                <h2>{editing.id ? `Éditer : ${editing.name || "Template"}` : "Nouveau template système"}</h2>
                {editing.id && (
                  <span className={formStyles.chipSystem}>Template système · toutes cliniques</span>
                )}
              </div>
              <button onClick={cancelEdit} className={formStyles.btnGhost}>
                ✕
              </button>
            </header>

            <div className={formStyles.form}>
              <div className={formStyles.field}>
                <label>Nom *</label>
                <input
                  type="text"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="Ex : Consultation vaccinale — DrVeto"
                  disabled={saving}
                />
              </div>

              <div className={formStyles.field}>
                <label>Description</label>
                <input
                  type="text"
                  value={editing.description ?? ""}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  placeholder="Description courte visible dans le sélecteur clinique"
                  disabled={saving}
                />
              </div>

              <div className={formStyles.field}>
                <label>Contenu (prompt système)</label>
                <textarea
                  rows={18}
                  value={editing.content}
                  onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                  placeholder={`# Compte rendu vétérinaire\n\n## Signalement\n## Motif de consultation\n## Examen clinique\n## Diagnostic\n## Traitement\n## Recommandations propriétaire`}
                  disabled={saving}
                  className={formStyles.contentField}
                />
                <span className={formStyles.hint}>
                  Ce contenu est injecté dans le prompt LLM comme structure et guide de génération.
                  Utilisez du Markdown / plain text — le LLM produira du HTML en sortie.
                </span>
              </div>

              <div className={formStyles.checkbox}>
                <input
                  id="isDefault"
                  type="checkbox"
                  checked={editing.is_default ?? false}
                  onChange={(e) => setEditing({ ...editing, is_default: e.target.checked })}
                  disabled={saving}
                />
                <label htmlFor="isDefault">Marquer comme template par défaut (pré-sélectionné dans les cliniques)</label>
              </div>
            </div>

            <footer className={formStyles.editorFoot}>
              {editing.id && (
                <button
                  className={formStyles.btnDanger}
                  onClick={() => setConfirmDeleteId(editing.id)}
                  disabled={saving}
                >
                  🗑 Supprimer
                </button>
              )}
              <div className={formStyles.footRight}>
                <button className={formStyles.btnGhost} onClick={cancelEdit} disabled={saving}>
                  Annuler
                </button>
                <button
                  className={formStyles.btnPrimary}
                  onClick={save}
                  disabled={saving || !editing.name.trim() || !editing.content.trim()}
                >
                  {saving ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>
            </footer>
          </div>
        )}
      </div>

      {/* Modal confirmation delete */}
      {confirmDeleteId && (
        <div className={formStyles.overlay} onClick={() => setConfirmDeleteId(null)}>
          <div className={formStyles.confirmModal} onClick={(e) => e.stopPropagation()}>
            <h3>Supprimer ce template système ?</h3>
            <p>
              Il sera immédiatement retiré de <strong>toutes les cliniques</strong>. Les jobs déjà générés
              avec ce template ne sont pas affectés. Action irréversible.
            </p>
            <div className={formStyles.confirmActions}>
              <button className={formStyles.btnGhost} onClick={() => setConfirmDeleteId(null)}>
                Annuler
              </button>
              <button
                className={formStyles.btnDanger}
                onClick={() => remove(confirmDeleteId)}
                disabled={saving}
              >
                {saving ? "Suppression…" : "Supprimer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
