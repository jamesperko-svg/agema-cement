AGEMA Cement Platform V3.3 PATCH
Real-Time Forecast vs. Actual Profit

WHAT THIS ADDS
- New Forecast vs Actual Profit page.
- Manual customer delivery/invoice entry with edit and delete.
- Actual delivered volume replaces the matching customer forecast for that week; it is not double-counted.
- Firm, Expected and Upside profit cases.
- Actual revenue, realized management profit, remaining forecast profit, projected final profit, margin/NT and weekly variance bridge.
- Current inventory on the executive dashboard based on posted actual deliveries.
- Database fields designed for a future accounting/invoice connector using source_system + external_key for duplicate-safe upserts.

DEPLOYMENT
1. In Supabase SQL Editor, run supabase_v3_3_migration.sql once.
2. Unzip this patch.
3. Copy the app and lib folders from the patch over the same folders in your existing V3.2 Git project. Keep your existing .git folder and all files not included in this patch.
4. Also copy supabase_v3_3_migration.sql and README_V3_3.txt into the project root.
5. From Terminal inside the project:
   git add .
   git commit -m "Add real-time forecast versus actual profit"
   git push
6. Vercel deploys automatically.
7. Open Forecast vs Actual Profit in the left menu and post a test delivery.

PROFIT LOGIC
- Past weeks: actual-only.
- Current week: actual volume replaces the matching planned customer volume; only the unshipped forecast balance remains.
- Future weeks: customer plan forecast.
- Realized management profit: actual invoice revenue less modeled landed cost allocated to actual tons, estimated A/R financing and storage accrued through today.
- Remaining forecast profit: forecast revenue less modeled landed cost, A/R financing and projected storage.

This is a management forecast and does not replace GAAP financial statements.
