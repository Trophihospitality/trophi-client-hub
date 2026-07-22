
ALTER TABLE public.client_contracts
  ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS location_ids TEXT[],
  ADD COLUMN IF NOT EXISTS document_name TEXT,
  ADD COLUMN IF NOT EXISTS file_size BIGINT;

-- Backfill location_ids from existing metadata for rows we already have
UPDATE public.client_contracts
  SET location_ids = ARRAY(SELECT jsonb_array_elements_text(metadata->'location_ids'))
  WHERE location_ids IS NULL
    AND jsonb_typeof(metadata->'location_ids') = 'array';
