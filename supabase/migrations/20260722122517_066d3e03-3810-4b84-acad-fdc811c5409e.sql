
-- Clear Zippy's stale contract rows (deleted their PandaDoc docs already)
DELETE FROM public.client_contracts
  WHERE business_id = 'TRP-U8RZKR' AND kind IN ('msa','order_form','client_authorization');

-- Allow the client's admin user to read all three bundle-kind contracts
-- so the portal can render Step 4 signing state.
DROP POLICY IF EXISTS "Trophi + client_admin read contracts" ON public.client_contracts;
CREATE POLICY "Trophi + client_admin read contracts"
  ON public.client_contracts
  FOR SELECT
  TO authenticated
  USING (
    public.is_trophi_staff_for(business_id)
    OR (kind IN ('bundle','msa','order_form','client_authorization')
        AND public.is_client_admin_for(business_id))
  );

-- Optional: log ability for admin to void-and-regenerate (audit trail is done in-app).
