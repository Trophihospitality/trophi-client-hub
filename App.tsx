import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { CrmProvider } from '@/store/crmStore';
import { UserProvider } from '@/store/userStore';
import AppShell from '@/components/layout/AppShell';
import CRM from '@/pages/CRM';
import ClientDetail from '@/pages/ClientDetail';
import Onboarding from '@/pages/Onboarding';

// Placeholder pages — built in later phases
function ComingSoon({ title }: { title: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="gold-rule w-24" />
      <div className="rounded-xl border border-dashed bg-card py-20 text-center text-sm text-muted-foreground">
        This module is next on the build plan. Business IDs and Location IDs from the CRM will map directly into it.
      </div>
    </div>
  );
}

export default function App() {
  return (
    <UserProvider>
    <CrmProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Navigate to="/crm" replace />} />
            <Route path="/crm" element={<CRM />} />
            <Route path="/crm/:businessId" element={<ClientDetail />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/accounts" element={<ComingSoon title="Account Management" />} />
            <Route path="/support" element={<ComingSoon title="Tech / Support" />} />
            <Route path="/client-portal" element={<ComingSoon title="Client Portal" />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster richColors position="bottom-right" />
    </CrmProvider>
    </UserProvider>
  );
}
