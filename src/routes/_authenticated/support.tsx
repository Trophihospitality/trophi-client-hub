import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_authenticated/support')({
  component: () => (
    <div className="py-16 text-center">
      <h1 className="font-display text-2xl font-semibold">Tech / Support</h1>
      <p className="mt-2 text-muted-foreground">Coming soon — ticket queue and knowledge base.</p>
    </div>
  ),
});
