"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./adminShell.module.css";

const LINKS = [
  { href: "/admin/overview", label: "Vue d'ensemble", icon: "📊" },
  { href: "/admin/clinics", label: "Cliniques", icon: "🏥" },
  { href: "/admin/templates", label: "Templates globaux", icon: "📄" },
  { href: "/admin/costs", label: "Coûts", icon: "💰" },
];

export default function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <div className={styles.brandMark}>◐</div>
        <div>
          <div className={styles.brandName}>Vetpulse</div>
          <div className={styles.brandSub}>Console admin — DrVeto</div>
        </div>
      </div>

      <nav className={styles.nav}>
        {LINKS.map(({ href, label, icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`}
            >
              <span className={styles.navIcon}>{icon}</span>
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className={styles.footer}>
        <Link href="/consultation" className={styles.footerLink}>
          ← Vue clinique
        </Link>
      </div>
    </aside>
  );
}
