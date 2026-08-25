-- AGEMA Cement Platform V4
-- Adds delivery and invoice actuals for real-time volume, revenue, inventory,
-- and forecast-versus-actual profit tracking.
-- Run once in Supabase SQL Editor before deploying the V4 application files.

create table if not exists sales_actuals (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references markets(id) on delete cascade,
  cargo_id uuid references cargoes(id) on delete set null,
  customer_id uuid not null references customers(id) on delete restrict,
  delivery_date date not null,
  invoice_date date,
  invoice_number text,
  external_source text not null default 'Manual',
  external_id text,
  volume_nt numeric(14,2) not null,
  sell_price_per_nt numeric(12,2),
  invoice_amount_usd numeric(14,2),
  payment_date date,
  status text not null default 'Invoiced',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_actuals_volume_check check (volume_nt > 0),
  constraint sales_actuals_price_check check (sell_price_per_nt is null or sell_price_per_nt >= 0),
  constraint sales_actuals_invoice_amount_check check (invoice_amount_usd is null or invoice_amount_usd >= 0)
);

create index if not exists idx_sales_actuals_market_date
  on sales_actuals(market_id, delivery_date);

create index if not exists idx_sales_actuals_customer_date
  on sales_actuals(customer_id, delivery_date);

create index if not exists idx_sales_actuals_cargo
  on sales_actuals(cargo_id);

create unique index if not exists idx_sales_actuals_external_unique
  on sales_actuals(market_id, external_source, external_id);

comment on table sales_actuals is
  'Actual cement deliveries and invoice data. These records replace, rather than stack on top of, the weekly forecast as actual weeks close.';

comment on column sales_actuals.external_id is
  'Stable source-system line identifier used to prevent duplicate imports and support future accounting-system synchronization.';
