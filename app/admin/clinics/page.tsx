// app/admin/clinics/page.tsx
import { ClinicDashboard } from "../ClinicDashboard";
import styles from "../adminShell.module.css";

export const dynamic = "force-dynamic";

export default function AdminClinicsPage() {
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Cliniques</h1>
        <p className={styles.pageSubtitle}>
          Provisionnez, éditez, désactivez vos cliniques clientes. Chaque clinique dispose
          de sa clé API isolée et de son quota mensuel.
        </p>
      </header>

      <ClinicDashboard />
    </div>
  );
}
