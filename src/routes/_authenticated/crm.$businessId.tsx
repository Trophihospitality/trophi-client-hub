import { createFileRoute } from '@tanstack/react-router';
import ClientDetail from '@/components/crm/ClientDetail';

export const Route = createFileRoute('/_authenticated/crm/$businessId')({
  component: ClientDetail,
});
