// Legacy compat wrapper — CRM UI still imports useCrm() from this path.
// It now wraps the Query cache + server functions.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import {
  listClients, changeStatusFn, addNoteFn, logContactFn, updateClientFn,
  registerAttachmentFn, removeAttachmentFn, importClientsFn,
} from '@/lib/crm.functions';
import type { Client, ClientNote, ActivityEvent, JourneyStatus, Attachment, ContactMethod } from '@/lib/types';

export const clientsQueryKey = ['clients'] as const;

export function useCrm() {
  const qc = useQueryClient();
  const listFn = useServerFn(listClients);
  const { data: clients = [] } = useQuery({
    queryKey: clientsQueryKey,
    queryFn: () => listFn({} as any),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: clientsQueryKey });

  const changeStatusM = useMutation({
    mutationFn: useServerFn(changeStatusFn),
    onSuccess: invalidate,
  });
  const addNoteM = useMutation({ mutationFn: useServerFn(addNoteFn), onSuccess: invalidate });
  const logContactM = useMutation({ mutationFn: useServerFn(logContactFn), onSuccess: invalidate });
  const updateM = useMutation({ mutationFn: useServerFn(updateClientFn), onSuccess: invalidate });
  const attachM = useMutation({ mutationFn: useServerFn(registerAttachmentFn), onSuccess: invalidate });
  const removeAttachM = useMutation({ mutationFn: useServerFn(removeAttachmentFn), onSuccess: invalidate });
  const importM = useMutation({ mutationFn: useServerFn(importClientsFn), onSuccess: invalidate });

  return {
    clients,
    getClient: (businessId: string) => clients.find((c) => c.businessId === businessId),
    changeStatus: (businessId: string, status: JourneyStatus, _actor?: string) =>
      changeStatusM.mutateAsync({ data: { businessId, status } }),
    addNote: (businessId: string, note: ClientNote) =>
      addNoteM.mutateAsync({ data: { businessId, body: note.body } }),
    logContact: (businessId: string, method: ContactMethod, date: string, summary: string, _actor: string, nextFollowUpDate?: string) =>
      logContactM.mutateAsync({ data: { businessId, method, date, summary, nextFollowUpDate } }),
    updateClient: (businessId: string, updates: Partial<Client>, _actor: string) => {
      const { businessId: _b, brands, ...rest } = updates;
      return updateM.mutateAsync({ data: { businessId, updates: {
        company: rest.company,
        brands,
        contactName: rest.contactName,
        contactEmail: rest.contactEmail,
        contactPhone: rest.contactPhone,
        isDecisionMaker: rest.isDecisionMaker,
        packageType: rest.packageType,
        budget: rest.budget ?? null,
        salesPersonId: rest.salesPersonId,
        lastContactDate: rest.lastContactDate,
        lastContactMethod: rest.lastContactMethod,
        nextFollowUpDate: rest.nextFollowUpDate,
      } as any } });
    },
    addAttachment: async (businessId: string, attachment: Attachment & { storagePath?: string }) => {
      await attachM.mutateAsync({ data: {
        businessId,
        fileName: attachment.fileName,
        fileType: attachment.fileType,
        fileSize: attachment.fileSize,
        storagePath: (attachment as any).storagePath ?? attachment.dataUrl,
      } });
    },
    removeAttachment: (businessId: string, attachmentId: string, _actor: string) =>
      removeAttachM.mutateAsync({ data: { businessId, attachmentId } }),
    importClients: (rows: any[]) => importM.mutateAsync({ data: { rows } }),
    // legacy no-op
    addClient: (_c: Client) => {},
  };
}

export function CrmProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// legacy shape re-exports
export type { ActivityEvent };
