import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_authenticated/accounts')({
  component: () => (
    <div className="py-16 text-center">
      <h1 className="font-display text-2xl font-semibold">Account Management</h1>
      <p className="mt-2 text-muted-foreground">Coming soon — active client health, renewals, and QBRs.</p>
    </div>
  ),
});
