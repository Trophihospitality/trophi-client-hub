import React, { createContext, useContext, useEffect, useReducer } from 'react';
import { Client, ClientNote, ActivityEvent, JourneyStatus, Attachment, ContactMethod } from '@/lib/types';
import { SEED_CLIENTS } from '@/data/seedData';
import { uid } from '@/lib/ids';

// ============================================================
// CRM STORE
// - Persists to localStorage (swap for Supabase later; the
//   action layer is the only thing that needs to change)
// - Automatically flags a client for Onboarding the moment its
//   journey status is set to "Approved"
// - Contact logging updates Last Contact fields + timeline
// ============================================================

const STORAGE_KEY = 'trophi-crm-clients-v2';

interface CrmState {
  clients: Client[];
}

type CrmAction =
  | { type: 'ADD_CLIENT'; client: Client }
  | { type: 'IMPORT_CLIENTS'; clients: Client[] }
  | { type: 'UPDATE_CLIENT'; businessId: string; updates: Partial<Client>; actor: string }
  | { type: 'CHANGE_STATUS'; businessId: string; status: JourneyStatus; actor: string }
  | { type: 'ADD_NOTE'; businessId: string; note: ClientNote }
  | { type: 'LOG_CONTACT'; businessId: string; method: ContactMethod; date: string; summary: string; nextFollowUpDate?: string; actor: string }
  | { type: 'ADD_ATTACHMENT'; businessId: string; attachment: Attachment }
  | { type: 'REMOVE_ATTACHMENT'; businessId: string; attachmentId: string; actor: string };

function withActivity(client: Client, event: Omit<ActivityEvent, 'id' | 'timestamp'>): Client {
  return {
    ...client,
    updatedAt: new Date().toISOString(),
    activity: [
      { ...event, id: uid(), timestamp: new Date().toISOString() },
      ...client.activity,
    ],
  };
}

function reducer(state: CrmState, action: CrmAction): CrmState {
  switch (action.type) {
    case 'ADD_CLIENT':
      return { clients: [action.client, ...state.clients] };

    case 'IMPORT_CLIENTS':
      return { clients: [...action.clients, ...state.clients] };

    case 'UPDATE_CLIENT':
      return {
        clients: state.clients.map((c) =>
          c.businessId === action.businessId
            ? withActivity({ ...c, ...action.updates }, {
                type: 'info_updated',
                description: 'Client information updated',
                actor: action.actor,
              })
            : c
        ),
      };

    case 'CHANGE_STATUS':
      return {
        clients: state.clients.map((c) => {
          if (c.businessId !== action.businessId) return c;
          if (c.journeyStatus === action.status) return c;
          const goingToOnboarding = action.status === 'Approved' && !c.sentToOnboarding;
          const updated: Client = {
            ...c,
            journeyStatus: action.status,
            sentToOnboarding: c.sentToOnboarding || action.status === 'Approved',
            onboardingSentAt: goingToOnboarding ? new Date().toISOString() : c.onboardingSentAt,
          };
          return withActivity(updated, {
            type: 'status_change',
            description: `Status changed: ${c.journeyStatus} → ${action.status}${goingToOnboarding ? ' · Sent to Onboarding' : ''}`,
            actor: action.actor,
          });
        }),
      };

    case 'ADD_NOTE':
      return {
        clients: state.clients.map((c) =>
          c.businessId === action.businessId
            ? withActivity({ ...c, notes: [action.note, ...c.notes] }, {
                type: 'note_added',
                description: 'Note added',
                actor: action.note.authorName,
              })
            : c
        ),
      };

    case 'LOG_CONTACT':
      return {
        clients: state.clients.map((c) =>
          c.businessId === action.businessId
            ? withActivity(
                {
                  ...c,
                  lastContactDate: action.date,
                  lastContactMethod: action.method,
                  nextFollowUpDate: action.nextFollowUpDate ?? c.nextFollowUpDate,
                },
                {
                  type: 'contact_logged',
                  description: `${action.method} contact logged${action.summary ? `: ${action.summary}` : ''}`,
                  actor: action.actor,
                }
              )
            : c
        ),
      };

    case 'ADD_ATTACHMENT':
      return {
        clients: state.clients.map((c) =>
          c.businessId === action.businessId
            ? withActivity({ ...c, attachments: [action.attachment, ...c.attachments] }, {
                type: 'info_updated',
                description: `Attachment added: ${action.attachment.fileName}`,
                actor: action.attachment.uploadedBy,
              })
            : c
        ),
      };

    case 'REMOVE_ATTACHMENT': {
      return {
        clients: state.clients.map((c) => {
          if (c.businessId !== action.businessId) return c;
          const att = c.attachments.find((a) => a.id === action.attachmentId);
          return withActivity(
            { ...c, attachments: c.attachments.filter((a) => a.id !== action.attachmentId) },
            {
              type: 'info_updated',
              description: `Attachment removed: ${att?.fileName ?? 'file'}`,
              actor: action.actor,
            }
          );
        }),
      };
    }

    default:
      return state;
  }
}

/** Fill fields added after v1 so older saved data keeps working. */
function migrate(clients: Partial<Client>[]): Client[] {
  return clients.map((c) => ({
    attachments: [],
    notes: [],
    activity: [],
    ...c,
  })) as Client[];
}

function loadInitial(): CrmState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem('trophi-crm-clients-v1');
    if (raw) return { clients: migrate(JSON.parse(raw)) };
  } catch {
    /* fall through to seed */
  }
  return { clients: SEED_CLIENTS };
}

interface CrmContextValue extends CrmState {
  addClient: (client: Client) => void;
  importClients: (clients: Client[]) => void;
  updateClient: (businessId: string, updates: Partial<Client>, actor: string) => void;
  changeStatus: (businessId: string, status: JourneyStatus, actor: string) => void;
  addNote: (businessId: string, note: ClientNote) => void;
  logContact: (businessId: string, method: ContactMethod, date: string, summary: string, actor: string, nextFollowUpDate?: string) => void;
  addAttachment: (businessId: string, attachment: Attachment) => void;
  removeAttachment: (businessId: string, attachmentId: string, actor: string) => void;
  getClient: (businessId: string) => Client | undefined;
}

const CrmContext = createContext<CrmContextValue | null>(null);

export function CrmProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitial);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.clients));
  }, [state.clients]);

  const value: CrmContextValue = {
    ...state,
    addClient: (client) => dispatch({ type: 'ADD_CLIENT', client }),
    importClients: (clients) => dispatch({ type: 'IMPORT_CLIENTS', clients }),
    updateClient: (businessId, updates, actor) =>
      dispatch({ type: 'UPDATE_CLIENT', businessId, updates, actor }),
    changeStatus: (businessId, status, actor) =>
      dispatch({ type: 'CHANGE_STATUS', businessId, status, actor }),
    addNote: (businessId, note) => dispatch({ type: 'ADD_NOTE', businessId, note }),
    logContact: (businessId, method, date, summary, actor, nextFollowUpDate) =>
      dispatch({ type: 'LOG_CONTACT', businessId, method, date, summary, actor, nextFollowUpDate }),
    addAttachment: (businessId, attachment) => dispatch({ type: 'ADD_ATTACHMENT', businessId, attachment }),
    removeAttachment: (businessId, attachmentId, actor) =>
      dispatch({ type: 'REMOVE_ATTACHMENT', businessId, attachmentId, actor }),
    getClient: (businessId) => state.clients.find((c) => c.businessId === businessId),
  };

  return <CrmContext.Provider value={value}>{children}</CrmContext.Provider>;
}

export function useCrm(): CrmContextValue {
  const ctx = useContext(CrmContext);
  if (!ctx) throw new Error('useCrm must be used within CrmProvider');
  return ctx;
}
