## Trophi client portal — build plan

Ship the portal end-to-end: TanStack Router port of the existing pages, Tailwind v4 token migration, and Lovable Cloud backend replacing the localStorage store (auth, RLS, storage, server-generated IDs).

### 1. Repo intake

Loose source files at project root (`AppShell.tsx`, `CRM.tsx`, `ClientDetail.tsx`, `Onboarding.tsx`, `crmStore.tsx`, `seedData.ts`, `types.ts`, `ids.ts`, `csv.ts`, `statusConfig.ts`, `PipelineBoard.tsx`, `StatusBadge.tsx`, `AddClientDialog.tsx`, `AttachmentsSection.tsx`, `LogContactDialog.tsx`, `userStore.tsx`, `App.tsx`, `index.css`) are the source of truth. The public GitHub repo currently holds only the TanStack template shell, so we treat the loose files as the code to move in.

Move them into the standard layout:
- Pages → `src/pages/…` referenced from route files
- Components → `src/components/{layout,crm}/…`
- Store/lib/data → `src/store/`, `src/lib/`, `src/data/`

### 2. Tailwind v4 tokens & fonts

- Delete `@import url(fonts.googleapis.com…)` from CSS. Add Google Fonts preconnect + stylesheet `<link>` entries to `head()` in `src/routes/__root.tsx` (Montserrat + Inter).
- Rewrite `src/styles.css` around `@import "tailwindcss"` with an `@theme` block. Preserve every variable name and value verbatim: `--trophi-gold`, `--trophi-gold-light`, `--trophi-bronze`, `--trophi-gold-soft`, `--trophi-ink`, `--trophi-charcoal`, `--trophi-cream`, the shadcn semantic tokens, and all nine `--status-*` colors. Register `--font-display: "Montserrat"` and `--font-sans: "Inter"` in `@theme` so `font-display`/`font-sans` utilities work.
- Port the `.gold-rule` and `.text-gold-gradient` utilities via `@utility`.

### 3. Routing port (React Router → TanStack Router)

Create file-based routes; keep component bodies unchanged except for routing imports:

```
src/routes/
  __root.tsx                (already exists — extend head + shell)
  index.tsx                 → redirect to /crm when signed in, /auth otherwise
  auth.tsx                  → sign in / sign up (email + password)
  _authenticated/route.tsx  → integration-managed gate (created by supabase enable)
  _authenticated/crm.tsx
  _authenticated/crm.$businessId.tsx
  _authenticated/onboarding.tsx
  _authenticated/accounts.tsx    (placeholder — matches sidebar)
  _authenticated/support.tsx     (placeholder)
  _authenticated/client-portal.tsx (placeholder)
```

Global find/replace inside moved components:
- `react-router-dom` → `@tanstack/react-router`
- `NavLink` → `Link` with `activeProps`
- `useNavigate()` returns a function accepting `{ to, params }`
- `useParams<{ businessId: string }>()` → `Route.useParams()` in leaf route
- `<Outlet />` from tanstack

`AppShell` becomes the `component` of `_authenticated/route.tsx` (renders sidebar + `<Outlet />`). Demo user switcher is removed; footer shows the signed-in user + sign-out button.

### 4. Lovable Cloud backend

Enable Cloud, then create one migration with the full schema:

**Enums:** `app_role` (`manager`, `sales_rep`), `client_type`, `journey_status`, `package_type`, `contact_method`, `activity_type`.

**Tables (all `public`):**
- `profiles` (id uuid PK → auth.users, name text, email text)
- `user_roles` (user_id uuid, role app_role) — per user_roles knowledge, with `has_role(_user_id, _role)` security-definer fn
- `clients` — `business_id text PK` generated server-side (`TRP-XXXXXX` via `gen_business_id()` default), sales_person_id uuid → profiles, all Client fields
- `locations` — `location_id text PK` (`<business_id>-L01…` via trigger), business_id FK, name/address/city/state
- `client_notes` (id uuid, business_id FK, author_id, author_name, body, created_at)
- `activity_events` (id uuid, business_id FK, type activity_type, description, actor, created_at)
- `attachments` (id uuid, business_id FK, file_name, file_type, file_size, storage_path, uploaded_by, uploaded_at)

**Storage bucket:** `client-attachments` (private) via `supabase--storage_create_bucket`.

**RLS (managers see all, reps see own; enforced in DB):**
- `has_role(auth.uid(),'manager')` OR `sales_person_id = auth.uid()` for SELECT on `clients`
- Child tables (locations, notes, activity, attachments) delegate via `EXISTS (SELECT 1 FROM clients c WHERE c.business_id = <table>.business_id AND (has_role(auth.uid(),'manager') OR c.sales_person_id = auth.uid()))`
- Insert/update on `clients`: `sales_person_id = auth.uid()` OR manager
- Storage policies mirror `clients` visibility keyed by first path segment = business_id
- Full `GRANT SELECT, INSERT, UPDATE, DELETE … TO authenticated` blocks per public-schema-grants rule

**Triggers:**
- `set_business_id` before insert on `clients` if null
- `set_location_id` before insert on `locations` (auto-increment `L01`, `L02`… per business)
- `bump_onboarding_flag` on `clients` update: when new `journey_status = 'Approved'` and `sent_to_onboarding = false`, set true + `onboarding_sent_at = now()`, insert activity row
- `log_status_change` / `log_contact` etc. handled in server functions for cleaner activity descriptions
- `handle_new_user` → inserts profile + default `sales_rep` role

### 5. Server functions replacing `crmStore`

`src/server/crm.functions.ts` (client-safe import path) with `requireSupabaseAuth`:
- `listClients()` — returns clients + nested locations/notes/attachments/activity (RLS filters)
- `getClient(businessId)`
- `createClient(payload)` — server generates business_id, inserts locations, seeds activity
- `updateClient(businessId, updates)`
- `changeStatus(businessId, status)` — atomic status + activity + Approved→onboarding side-effect
- `addNote(businessId, body)`
- `logContact(businessId, method, date, summary, nextFollowUpDate?)`
- `uploadAttachment(businessId, file base64 + meta)` — writes to Storage via admin client (after verifying caller can see client), inserts row
- `removeAttachment(attachmentId)`
- `importClients(rows)` for CSV
- `listSalesTeam()` for assignment dropdowns (from profiles + user_roles)

Client code uses TanStack Query (`useQuery(['clients'])`, `useMutation`) wrapping `useServerFn`. `crmStore.tsx` becomes a thin hook layer exposing the same API surface the pages already call (`addClient`, `changeStatus`, etc.), so page components stay untouched aside from the import path.

### 6. Auth

- `/auth` page: email + password sign in / sign up using `@/integrations/supabase/client` (per Lovable Cloud auth defaults). No Google/Apple this round unless requested.
- `handle_new_user` trigger creates profile with `name = raw_user_meta_data->>'name'` (captured at sign up) and `sales_rep` role. Managers are promoted manually.
- Sidebar footer shows `profile.name / role` and Sign Out. Demo switcher deleted.
- `userStore` collapsed to a hook that returns the signed-in profile + role.

### 7. Verification

- Typecheck via harness after each batch.
- Playwright smoke: sign up → land on `/crm` → seed one client → status → Approved → confirm it appears in `/onboarding` → upload attachment → sign out.

### Technical notes

- `useServerFn` + TanStack Query used for reads/writes; loaders stay light. Protected loaders live only under `_authenticated/`.
- Business/Location IDs come only from Postgres defaults/triggers — never from client code (`ids.ts` retained only for local optimistic UI keys, unused for persisted rows).
- Attachment files live in Storage; DB row stores `storage_path`; UI resolves signed URLs on demand.
- Existing `SEED_CLIENTS` is not auto-inserted; can be reintroduced later as a one-off seed migration if the user asks.
