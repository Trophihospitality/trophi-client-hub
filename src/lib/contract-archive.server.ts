// ============================================================
// CONTRACT ARCHIVE — server-only.
// Downloads a completed PandaDoc document, uploads the signed PDF
// to the `contracts` storage bucket at
// `{businessId}/contracts/{kind}-{docId}.pdf`, and stamps the
// client_contracts row with executed_at, signed_pdf_path,
// document_name, location_ids, file_size.
// Idempotent: safe to call more than once for the same row.
// ============================================================

import { pandadoc } from '@/lib/pandadoc.server';
import { supabaseAdmin } from '@/integrations/supabase/client.server';

const KIND_LABEL: Record<string, string> = {
  msa: 'Master Services Agreement',
  order_form: 'Order Form',
  client_authorization: 'Client Authorization',
  payment_authorization: 'Payment Authorization',
  bundle: 'Contract Bundle',
};

export interface ArchiveResult {
  storagePath: string;
  size: number;
  executedAt: string;
  reused: boolean;
}

export async function archiveCompletedContract(row: {
  id: string;
  business_id: string;
  kind: string;
  pandadoc_document_id: string | null;
  signed_pdf_path: string | null;
  metadata?: any;
  location_ids?: string[] | null;
}): Promise<ArchiveResult> {
  if (!row.pandadoc_document_id) {
    throw new Error(`Contract ${row.id} has no pandadoc_document_id`);
  }
  const docId = row.pandadoc_document_id;

  // Route by kind:
  //   payment_authorization → `payment` bucket, {bid}/payment/{docId}.pdf
  //   everything else       → `contracts` bucket, {bid}/contracts/{kind}-{docId}.pdf
  const isPayment = row.kind === 'payment_authorization';
  const bucket = isPayment ? 'payment' : 'contracts';
  const folder = isPayment ? 'payment' : 'contracts';
  const fileName = isPayment ? `payment-authorization-${docId}.pdf` : `${row.kind}-${docId}.pdf`;
  const storagePath = `${row.business_id}/${folder}/${fileName}`;

  const { data: existing } = await supabaseAdmin.storage
    .from(bucket)
    .list(`${row.business_id}/${folder}`, { limit: 200 });
  const found = existing?.find((f) => f.name === fileName);
  if (found && row.signed_pdf_path === storagePath) {
    return {
      storagePath,
      size: Number((found as any).metadata?.size ?? 0),
      executedAt: (found as any).updated_at ?? new Date().toISOString(),
      reused: true,
    };
  }

  const details = await pandadoc.getDocument(docId);
  const pdMeta = (details as any).metadata ?? {};
  const fromPd: string[] = Array.isArray(pdMeta.location_ids)
    ? pdMeta.location_ids
    : typeof pdMeta.location_ids === 'string' && pdMeta.location_ids
      ? String(pdMeta.location_ids).split(',').map((s) => s.trim()).filter(Boolean)
      : [];
  const fromRow: string[] = Array.isArray(row.location_ids) ? row.location_ids
    : (Array.isArray(row.metadata?.location_ids) ? row.metadata.location_ids : []);
  const locationIds = fromPd.length ? fromPd : fromRow;
  const documentName = details.name || KIND_LABEL[row.kind] || row.kind;

  const { bytes, contentType } = await pandadoc.downloadDocumentPdf(docId);

  const { error: upErr } = await supabaseAdmin.storage
    .from(bucket)
    .upload(storagePath, bytes, {
      contentType: contentType || 'application/pdf',
      upsert: true,
    });
  if (upErr) throw new Error(`Storage upload failed for ${storagePath}: ${upErr.message}`);

  const executedAt = new Date().toISOString();

  const { error: updErr } = await supabaseAdmin
    .from('client_contracts')
    .update({
      signed_pdf_path: storagePath,
      executed_at: executedAt,
      document_name: documentName,
      location_ids: locationIds.length ? locationIds : null,
      file_size: bytes.byteLength,
      status: 'document.completed',
    })
    .eq('id', row.id);
  if (updErr) throw new Error(`client_contracts update failed for ${row.id}: ${updErr.message}`);

  return { storagePath, size: bytes.byteLength, executedAt, reused: false };
}


export async function archiveAllCompletedForBusiness(businessId: string) {
  const { data: rows, error } = await supabaseAdmin
    .from('client_contracts')
    .select('id, business_id, kind, pandadoc_document_id, signed_pdf_path, status, metadata, location_ids')
    .eq('business_id', businessId)
    .eq('status', 'document.completed');
  if (error) throw error;

  const out: Array<{ kind: string; docId: string | null; result?: ArchiveResult; error?: string }> = [];
  for (const r of rows ?? []) {
    try {
      const result = await archiveCompletedContract(r as any);
      out.push({ kind: r.kind, docId: r.pandadoc_document_id, result });
    } catch (err: any) {
      out.push({ kind: r.kind, docId: r.pandadoc_document_id, error: String(err?.message ?? err) });
    }
  }
  return out;
}
