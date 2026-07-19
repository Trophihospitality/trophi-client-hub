import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

export type TemplateKey =
  | 'msa'
  | 'order_form'
  | 'client_authorization'
  | 'payment_authorization';

export interface TemplateRow {
  key: TemplateKey;
  label: string;
  notes: string | null;
  templateId: string | null;
  updatedAt: string;
}

export const listPandadocTemplatesFn = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TemplateRow[]> => {
    const { data, error } = await context.supabase
      .from('pandadoc_templates')
      .select('key, label, notes, template_id, updated_at')
      .order('key');
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      key: r.key as TemplateKey,
      label: r.label,
      notes: r.notes,
      templateId: r.template_id,
      updatedAt: r.updated_at,
    }));
  });

const updateSchema = z.object({
  key: z.enum(['msa', 'order_form', 'client_authorization', 'payment_authorization']),
  templateId: z.string().trim().max(200).nullable(),
});

export const updatePandadocTemplateFn = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const value = data.templateId && data.templateId.length > 0 ? data.templateId : null;
    const { error } = await context.supabase
      .from('pandadoc_templates')
      .update({ template_id: value, updated_by: context.userId })
      .eq('key', data.key);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
