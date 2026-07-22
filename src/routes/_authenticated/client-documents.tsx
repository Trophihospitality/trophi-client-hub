import { createFileRoute } from '@tanstack/react-router';
import { useAuth } from '@/store/userStore';
import { DocumentsSection } from '@/components/documents/DocumentsSection';

export const Route = createFileRoute('/_authenticated/client-documents')({
  ssr: false,
  head: () => ({ meta: [
    { title: 'Documents · Trophi Client Portal' },
    { name: 'description', content: 'Your executed contracts and shared documents from Trophi Hospitality.' },
  ]}),
  component: ClientDocumentsPage,
});

function ClientDocumentsPage() {
  const { client, isClient, loading } = useAuth();
  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!isClient || !client) {
    return <div className="p-6 text-sm text-muted-foreground">No client portal access on this account.</div>;
  }
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Documents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {client.company} · Contracts, forms, and shared assets from Trophi.
        </p>
      </header>
      <DocumentsSection businessId={client.businessId} mode="client" />
    </div>
  );
}
