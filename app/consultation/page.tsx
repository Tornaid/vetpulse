// app/consultation/page.tsx
import { getConsultations } from "@/lib/db";
import ConsultationView from "@/components/ConsultationView";

export const dynamic = "force-dynamic";

export default async function ConsultationPage() {
  const consultations = await getConsultations();

  return <ConsultationView consultations={consultations} />;
}
