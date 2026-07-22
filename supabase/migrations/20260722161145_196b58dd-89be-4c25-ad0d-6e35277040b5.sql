-- Clean up duplicated Zippy's contract rows: the three stale IDs pointed at blank-field
-- documents (kc4y9KwUmXBEhpAMrvBF2U, CZs6xmP5ps7cABDbVzoKKC, HaskwwLVr96uwotFwP5UuZ);
-- the newly regenerated docs (eTSQoJRcL2oatKiwSL3Zki, qeaFF3RQ4G37PuMo3gvhmE,
-- CEspeiw4fbkbVBiYoPcRnU) are the correct ones and stay.
DELETE FROM public.client_contracts
 WHERE business_id = 'TRP-U8RZKR'
   AND pandadoc_document_id IN (
     'kc4y9KwUmXBEhpAMrvBF2U',
     'CZs6xmP5ps7cABDbVzoKKC',
     'HaskwwLVr96uwotFwP5UuZ'
   );

-- Add a delete policy so Trophi staff can clean up contract rows through
-- the app (mirrors update policy). Void-and-regenerate uses service_role
-- so this is not strictly required, but keeps the policy set complete.
DROP POLICY IF EXISTS "Trophi deletes contracts" ON public.client_contracts;
CREATE POLICY "Trophi deletes contracts"
  ON public.client_contracts FOR DELETE
  USING (public.is_trophi_staff_for(business_id));