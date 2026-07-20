import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router';
import Onboarding from '@/components/crm/Onboarding';

export const Route = createFileRoute('/_authenticated/onboarding')({
  component: OnboardingRoute,
});

function OnboardingRoute() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return pathname === '/onboarding' ? <Onboarding /> : <Outlet />;
}
