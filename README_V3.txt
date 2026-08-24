AGEMA Cement Platform V3 — Toledo Sales Pipeline + Inventory Forecast

1) In Supabase SQL Editor, run supabase_v3_migration.sql once.
2) Replace/update the app files in your Git-tracked agema_vercel_v1 folder with this package.
3) Commit and push:
   git add .
   git commit -m "Add Toledo sales pipeline and inventory forecast"
   git push
4) Vercel should deploy main automatically.

V3 adds:
- Customer-level sales plans (probability, target tons, price, truck throughput, dates)
- Multi-customer weekly terminal withdrawal forecast
- Probability-weighted pipeline
- Stockout forecast and reorder deadline
- Editable Toledo reorder lead time, safety-stock days, and next-cargo size
- Executive dashboard sales/inventory signals

Existing V2 pages and Supabase data remain in place.
