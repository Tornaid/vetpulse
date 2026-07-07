// app/admin/page.tsx — Redirect vers la vue par défaut
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function AdminIndex() {
  redirect("/admin/overview");
}
