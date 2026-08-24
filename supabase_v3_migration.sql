-- AGEMA Cement Platform V3: Sales Pipeline + Inventory Forecast
-- Run once in Supabase SQL Editor.

create table if not exists customer_plans (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references markets(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  start_date date not null,
  end_date date,
  target_volume_nt numeric(14,2),
  probability_pct numeric(6,2) not null default 100,
  trucks_per_day numeric(10,2) not null default 0,
  avg_nt_per_truck numeric(10,2) not null default 38,
  operating_days_per_week numeric(6,2) not null default 5,
  sell_price_per_nt numeric(12,2),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint customer_plans_probability_check check (probability_pct >= 0 and probability_pct <= 100),
  constraint customer_plans_dates_check check (end_date is null or end_date >= start_date)
);

create index if not exists idx_customer_plans_market on customer_plans(market_id);
create index if not exists idx_customer_plans_customer on customer_plans(customer_id);
create index if not exists idx_customer_plans_dates on customer_plans(start_date, end_date);

create table if not exists market_settings (
  market_id uuid primary key references markets(id) on delete cascade,
  reorder_lead_days integer not null default 35,
  safety_stock_days integer not null default 7,
  next_cargo_size_nt numeric(14,2) not null default 20519.24,
  updated_at timestamptz not null default now()
);

insert into market_settings (market_id, reorder_lead_days, safety_stock_days, next_cargo_size_nt)
select id, 35, 7, 20519.24 from markets where name='Toledo'
on conflict (market_id) do nothing;

-- Seed Available Ready-Mix from the existing Toledo planning assumption only if no plan exists.
insert into customer_plans (
  market_id, customer_id, start_date, end_date, target_volume_nt, probability_pct,
  trucks_per_day, avg_nt_per_truck, operating_days_per_week, sell_price_per_nt, notes
)
select
  c.market_id,
  c.id,
  coalesce((select min(start_date) from throughput_periods t where t.customer_id=c.id), current_date),
  coalesce((select max(end_date) from throughput_periods t where t.customer_id=c.id), current_date + interval '180 days'),
  c.annual_demand_nt,
  100,
  coalesce((select trucks_per_day from throughput_periods t where t.customer_id=c.id order by start_date desc limit 1), 4),
  coalesce((select avg_nt_per_truck from throughput_periods t where t.customer_id=c.id order by start_date desc limit 1), 38),
  coalesce((select operating_days_per_week from throughput_periods t where t.customer_id=c.id order by start_date desc limit 1), 5),
  c.default_price_per_nt,
  'Seeded from Toledo V2 operating assumptions.'
from customers c
join markets m on m.id=c.market_id and m.name='Toledo'
where c.name='Available Ready Mix'
and not exists (select 1 from customer_plans p where p.customer_id=c.id);
