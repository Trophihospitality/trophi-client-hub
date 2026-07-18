import { createFileRoute } from '@tanstack/react-router';
import Onboarding from '@/components/crm/Onboarding';

export const Route = createFileRoute('/_authenticated/onboarding')({
  component: Onboarding,
});
