-- 通路結算批號（與 ERP 通路訂單頁一致）；Portal 僅讀取批號文字。

CREATE TABLE IF NOT EXISTS public.channel_settlement_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  batch_code text NOT NULL,
  date_basis text NOT NULL CHECK (date_basis IN ('order_date', 'expected_delivery')),
  period_start date,
  period_end date,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT channel_settlement_batches_channel_code_unique UNIQUE (channel_id, batch_code)
);

COMMENT ON TABLE public.channel_settlement_batches IS '通路結算／對帳批號';

CREATE INDEX IF NOT EXISTS idx_channel_settlement_batches_channel
  ON public.channel_settlement_batches (channel_id, created_at DESC);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS channel_settlement_batch_id uuid REFERENCES public.channel_settlement_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_channel_settlement_batch_id
  ON public.orders (channel_settlement_batch_id)
  WHERE channel_settlement_batch_id IS NOT NULL;
