-- AGEMA Cement Platform V3.2
-- Adds ongoing-demand forecasting and an itemized Cargo #2 procurement/logistics lead-time bridge.

alter table customer_plans
  add column if not exists forecast_ongoing boolean not null default true;

alter table market_settings
  add column if not exists supplier_preparation_days integer not null default 7,
  add column if not exists vessel_nomination_days integer not null default 7,
  add column if not exists load_port_days integer not null default 6,
  add column if not exists sailing_days integer not null default 21,
  add column if not exists discharge_availability_days integer not null default 7,
  add column if not exists contingency_days integer not null default 3;

-- Existing Toledo plans should continue their weekly demand beyond a temporary plan-end date
-- unless the user explicitly turns this off in the Sales Pipeline edit screen.
update customer_plans p
set forecast_ongoing = true
from markets m
where p.market_id = m.id
  and m.name = 'Toledo';

-- Seed the Toledo lead-time bridge with editable planning assumptions.
-- 7 + 7 + 6 + 21 + 7 + 3 = 51 days total.
update market_settings ms
set supplier_preparation_days = 7,
    vessel_nomination_days = 7,
    load_port_days = 6,
    sailing_days = 21,
    discharge_availability_days = 7,
    contingency_days = 3,
    reorder_lead_days = 51,
    updated_at = now()
from markets m
where ms.market_id = m.id
  and m.name = 'Toledo';
