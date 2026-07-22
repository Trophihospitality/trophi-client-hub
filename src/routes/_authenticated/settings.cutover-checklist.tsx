import { createFileRoute, redirect } from '@tanstack/react-router';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/store/userStore';
import checklistMarkdown from '../../../docs/PRODUCTION_CUTOVER_CHECKLIST.md?raw';
import { useMemo, useState, useEffect } from 'react';
import { CheckCircle2, Circle, ExternalLink } from 'lucide-react';

export const Route = createFileRoute('/_authenticated/settings/cutover-checklist')({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: '/auth' });
  },
  head: () => ({
    meta: [
      { title: 'Production Cutover Checklist · Trophi Hospitality' },
      { name: 'description', content: 'Durable checklist to move the Trophi Client Hub from sandbox to production.' },
      { property: 'og:title', content: 'Production Cutover Checklist · Trophi Hospitality' },
      { property: 'og:description', content: 'Durable checklist to move the Trophi Client Hub from sandbox to production.' },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary' },
    ],
  }),
  component: CutoverChecklistPage,
});

interface Section {
  title: string;
  items: string[];
}

interface Parsed {
  intro: string[];
  sections: Section[];
  notes: string[];
}

function parseChecklist(md: string): Parsed {
  const lines = md.split('\n');
  const intro: string[] = [];
  const sections: Section[] = [];
  const notes: string[] = [];
  let mode: 'intro' | 'section' | 'notes' = 'intro';
  let current: Section | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('# ')) continue;
    if (line.startsWith('## ')) {
      const title = line.slice(3).trim();
      if (/^Notes$/i.test(title)) { mode = 'notes'; current = null; continue; }
      current = { title, items: [] };
      sections.push(current);
      mode = 'section';
      continue;
    }
    if (line === '---') continue;
    if (mode === 'section' && current) {
      const m = line.match(/^- \[[ x]\]\s*(.+)$/);
      if (m) current.items.push(m[1]);
    } else if (mode === 'notes') {
      const m = line.match(/^- (.+)$/);
      if (m) notes.push(m[1]);
    } else if (mode === 'intro' && line) {
      intro.push(line);
    }
  }
  return { intro, sections, notes };
}

const STORAGE_KEY = 'trophi.cutover-checklist.v1';

function useChecked() {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setChecked(JSON.parse(raw));
    } catch { /* noop */ }
  }, []);
  const toggle = (key: string) => {
    setChecked(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  };
  return { checked, toggle };
}

function renderInline(text: string) {
  // Very small markdown: **bold** and `code`.
  const parts: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end !== -1) {
        parts.push(<strong key={key++}>{text.slice(i + 2, end)}</strong>);
        i = end + 2;
        continue;
      }
    }
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        parts.push(<code key={key++} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">{text.slice(i + 1, end)}</code>);
        i = end + 1;
        continue;
      }
    }
    const nextSpecial = (() => {
      const a = text.indexOf('**', i);
      const b = text.indexOf('`', i);
      const candidates = [a, b].filter(v => v !== -1);
      return candidates.length ? Math.min(...candidates) : -1;
    })();
    const stop = nextSpecial === -1 ? text.length : nextSpecial;
    parts.push(<span key={key++}>{text.slice(i, stop)}</span>);
    i = stop;
  }
  return parts;
}

function CutoverChecklistPage() {
  const { profile } = useAuth();
  const parsed = useMemo(() => parseChecklist(checklistMarkdown), []);
  const { checked, toggle } = useChecked();

  const totals = useMemo(() => {
    const all = parsed.sections.flatMap(s => s.items.map((_, idx) => `${s.title}::${idx}`));
    const done = all.filter(k => checked[k]).length;
    return { all: all.length, done };
  }, [parsed, checked]);

  if (profile?.role !== 'admin') {
    return (
      <div className="py-16 text-center">
        <h1 className="text-lg font-semibold mb-2">Admins only</h1>
        <p className="text-sm text-muted-foreground">The production cutover checklist is restricted to admins.</p>
      </div>
    );
  }

  const pct = totals.all ? Math.round((totals.done / totals.all) * 100) : 0;

  return (
    <div className="space-y-8 max-w-4xl">
      <header className="space-y-3">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Admin</div>
        <h1 className="text-3xl font-display font-semibold">Production Cutover Checklist</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Durable checklist for moving the Trophi Client Hub from sandbox / test infrastructure to live production.
          Every item must be verified before real clients are onboarded. Progress is tracked in your browser.
        </p>
        <div className="flex items-center gap-3 text-sm">
          <div className="flex-1 max-w-xs h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-[hsl(var(--trophi-gold))]" style={{ width: `${pct}%` }} />
          </div>
          <div className="text-muted-foreground tabular-nums">{totals.done} / {totals.all} · {pct}%</div>
        </div>
        <a
          href="https://github.com/"
          className="hidden"
          aria-hidden
        >placeholder</a>
        <div className="text-xs text-muted-foreground">
          Source of truth: <code className="rounded bg-muted px-1 py-0.5">docs/PRODUCTION_CUTOVER_CHECKLIST.md</code>. Edit the markdown file and this page together — they must stay in sync.
        </div>
      </header>

      <div className="space-y-6">
        {parsed.sections.map((section) => {
          const done = section.items.filter((_, idx) => checked[`${section.title}::${idx}`]).length;
          return (
            <section key={section.title} className="rounded-2xl border border-border bg-card p-6">
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="text-base font-semibold">{section.title}</h2>
                <div className="text-xs text-muted-foreground tabular-nums">{done} / {section.items.length}</div>
              </div>
              <ul className="space-y-2.5">
                {section.items.map((item, idx) => {
                  const key = `${section.title}::${idx}`;
                  const isDone = !!checked[key];
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => toggle(key)}
                        className="flex w-full items-start gap-3 text-left rounded-lg px-2 py-1.5 hover:bg-muted/50 transition-colors"
                      >
                        {isDone
                          ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--trophi-gold))]" />
                          : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                        <span className={`text-sm ${isDone ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                          {renderInline(item)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      {parsed.notes.length > 0 && (
        <section className="rounded-2xl border border-dashed border-border bg-muted/30 p-6">
          <h2 className="text-base font-semibold mb-3">Notes</h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {parsed.notes.map((n, i) => <li key={i} className="flex gap-2"><ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{renderInline(n)}</span></li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
