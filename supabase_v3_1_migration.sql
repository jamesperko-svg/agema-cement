-- AGEMA Cement Platform V3.1 refinement
-- Separates annual customer demand from AGEMA target volume and corrects
-- the initial Available Ready Mix target that was seeded from annual demand.

-- Preserve annual demand on the customer record. Correct only the originally seeded
-- Available Ready Mix customer plan if it still carries the 48,000 NT annual-demand value.
update customer_plans p
set target_volume_nt = 13680,
    notes = concat(coalesce(p.notes,''), case when coalesce(p.notes,'')='' then '' else ' ' end,
                   'V3.1: AGEMA target reset to current scheduled Toledo throughput; annual demand remains on customer record.')
from customers c
join markets m on m.id = c.market_id
where p.customer_id = c.id
  and m.name = 'Toledo'
  and c.name = 'Available Ready Mix'
  and p.target_volume_nt = 48000;
