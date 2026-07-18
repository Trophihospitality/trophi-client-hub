import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { listSalesTeam } from '@/lib/crm.functions';
import { SalesPerson } from '@/lib/types';

export function useSalesTeam(): SalesPerson[] {
  const fn = useServerFn(listSalesTeam);
  const { data } = useQuery<SalesPerson[]>({
    queryKey: ['sales-team'],
    queryFn: () => fn({} as any),
    staleTime: 60_000,
  });
  return data ?? [];
}
