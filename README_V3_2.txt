AGEMA Cement Platform V3.2 - Toledo Decision Engine

What's new
- Three inventory/reorder cases:
  1. Firm: only customers marked Committed or Active, at full physical throughput.
  2. Expected: all active plans at probability-adjusted throughput.
  3. Upside: all active plans at full physical throughput.
- Customer plan end dates no longer automatically imply the customer stops buying forever.
  Each plan has an editable "Continue weekly demand beyond plan end" forecast flag.
- Pipeline target volume remains a commercial target; it no longer artificially caps ongoing physical demand in the reorder forecast.
- Cargo #2 lead time is itemized and editable:
  supplier preparation/order/LC, vessel nomination/laycan, loading, sailing, Toledo discharge/availability, contingency.
- Inventory page shows a lead-time bridge, three scenario stockout dates, target Cargo #2 arrivals, and latest reorder/nomination dates.
- Executive Dashboard now presents Firm / Expected / Upside reorder signals.
- Read-only diagnostics endpoint restored and expanded for V3.2.

Deployment
1. Copy these files over the existing git-tracked AGEMA source folder.
2. Run supabase_v3_2_migration.sql once in Supabase SQL Editor.
3. git add .
4. git commit -m "Add three-case reorder decision engine"
5. git push
6. Vercel deploys automatically.
