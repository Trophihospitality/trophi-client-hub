
ALTER TABLE public.client_contracts DROP CONSTRAINT IF EXISTS client_contracts_kind_check;
ALTER TABLE public.client_contracts ADD CONSTRAINT client_contracts_kind_check
  CHECK (kind IN ('msa','order_form','client_authorization','payment_authorization','bundle'));

ALTER TABLE public.client_contracts DROP CONSTRAINT IF EXISTS client_contracts_status_check;
ALTER TABLE public.client_contracts ADD CONSTRAINT client_contracts_status_check
  CHECK (status IN (
    'not_created','draft','document.draft','sent','document.sent',
    'viewed','document.viewed','completed','document.completed',
    'sent_to_client','client_signed','voided','error'
  ));
