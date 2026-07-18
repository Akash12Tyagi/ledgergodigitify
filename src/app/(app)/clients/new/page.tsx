import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/PageHeader";
import { ClientForm } from "@/features/clients/components/ClientForm";

export const metadata: Metadata = { title: "New Client — Finance & Ledger" };

export default function NewClientPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New Client" />
      <ClientForm />
    </div>
  );
}
