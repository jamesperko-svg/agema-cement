-- AGEMA Cement Platform V3.3
-- Real-time customer delivery/invoice actuals.
-- Run once in Supabase SQL Editor before deploying the V3.3 patch.

create table if not exists sales_actuals (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references markets(id) on delete cascade,
  cargo_id uuid not null references cargoes(id) on delete restrict,
  customer_id uuid not null references customers(id) on delete restrict,
  delivery_date date not null,
  invoice_date date,
  invoice_number text,
  delivered_nt numeric(14,3) not null check (delivered_nt > 0),
  unit_price_per_nt numeric(12,4) not null check (unit_price_per_nt >= 0),
  invoice_amount_usd numeric(14,2) check (invoice_amount_usd is null or invoice_amount_usd >= 0),
  payment_terms_days integer check (payment_terms_days is null or payment_terms_days >= 0),
  source_system text not null default 'Manual',
  external_key text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sales_actuals_market_date on sales_actuals(market_id, delivery_date);
create index if not exists idx_sales_actuals_cargo_date on sales_actuals(cargo_id, delivery_date);
create index if not exists idx_sales_actuals_customer_date on sales_actuals(customer_id, delivery_date);

-- Allows a future invoice connector to upsert safely without double counting.
create unique index if not exists idx_sales_actuals_external_key
  on sales_actuals(market_id, source_system, external_key)
  where external_key is not null and btrim(external_key) <> '';

create or replace function agema_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_sales_actuals_updated_at on sales_actuals;
create trigger trg_sales_actuals_updated_at
before update on sales_actuals
for each row execute function agema_touch_updated_at();

create or replace view sales_actuals_weekly as
select
  market_id,
  cargo_id,
  customer_id,
  date_trunc('week', delivery_date::timestamp)::date as week_start,
  sum(delivered_nt)::numeric(14,3) as delivered_nt,
  sum(coalesce(invoice_amount_usd, delivered_nt * unit_price_per_nt))::numeric(16,2) as revenue_usd,
  count(*)::integer as delivery_count
from sales_actuals
group by market_id, cargo_id, customer_id, date_trunc('week', delivery_date::timestamp)::date;
