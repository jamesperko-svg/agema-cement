AGEMA Cement Platform V3.1

What changed:
- Annual customer demand is kept separate from AGEMA target volume.
- Existing customer plans can be edited from Sales Pipeline.
- Adds explicit Committed status.
- Inventory forecast now shows two cases:
  1) Committed case: only customers marked Committed or Active create physical withdrawals.
  2) Probability-weighted case: all active plans are weighted by win probability for planning.
- Pre-start zero weeks no longer dilute the displayed weekly demand.
- V3.1 migration corrects the originally seeded Available Ready Mix AGEMA target from 48,000 NT to 13,680 NT while keeping annual demand at 48,000 NT.

Deployment:
1. Run supabase_v3_1_migration.sql once in Supabase SQL Editor.
2. Copy V3.1 files over the existing git-tracked AGEMA folder. Do not delete the .git directory.
3. git add .
4. git commit -m "Refine Toledo pipeline and inventory cases"
5. git push
6. Vercel will deploy automatically.
