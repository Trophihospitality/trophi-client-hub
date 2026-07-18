import { createFileRoute } from '@tanstack/react-router';
import CRM from '@/components/crm/CRM';

export const Route = createFileRoute('/_authenticated/crm/')({
  component: CRM,
});
