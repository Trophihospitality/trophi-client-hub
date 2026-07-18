import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_authenticated/client-portal')({
  component: () => (
    <div className="py-16 text-center">
      <h1 className="font-display text-2xl font-semibold">Client Portal</h1>
      <p className="mt-2 text-muted-foreground">Coming soon — client-facing view of onboarding and reporting.</p>
    </div>
  ),
});
