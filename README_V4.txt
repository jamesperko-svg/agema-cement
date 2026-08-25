AGEMA Cement Platform V4 - Forecast vs. Actual Profit Control
============================================================

WHAT V4 ADDS
- A delivery and invoice actuals ledger in Supabase.
- Manual entry of actual truck deliveries and invoice lines.
- Batch CSV import with duplicate protection through external_id.
- Real-time actual delivered volume, entered revenue, physical inventory,
  estimated profit on delivered tons, and customer contribution.
- Firm, Expected, and Upside projected cargo profit scenarios.
- Weekly forecast-versus-actual profit bridge.
- Actual weekly volume replaces the forecast for completed weeks.
- During the current week, actual volume first reduces the planned balance;
  only the unfilled balance remains forecast. Actual and forecast volume are
  therefore not double counted.
- Inventory and reorder forecasts now also use actual deliveries.
- Diagnostics endpoint reports version 4.0, actuals, profit cases, and inventory cases.

PROFIT BASIS
- Actual revenue comes from invoice_amount_usd when entered; otherwise it is
  volume_nt multiplied by the entered or customer-default selling price.
- Delivered-ton cost uses the current modeled landed cost from Cargo Economics.
- Storage is modeled by delivery date using the MidWest monthly storage rate.
- A/R financing is modeled using current SOFR plus the saved bank spread and
  each customer's payment terms or entered payment date.
- Future revenue and profit use the customer-specific sales plan price,
  throughput, probability, dates, and payment terms.
- V4 does not yet replace modeled cargo cost with vendor invoice actuals. It
  provides a live management profit estimate using actual sales and the latest
  operating-cost assumptions.

DEPLOYMENT ORDER
1. In Supabase SQL Editor, run supabase_v4_migration.sql once.
2. Copy all V4 files over the existing git-tracked AGEMA source folder.
   Keep the existing .git folder and Vercel environment variables.
3. From the AGEMA source folder run:

   git add .
   git commit -m "Add V4 forecast versus actual profit control"
   git push

4. Vercel should deploy automatically.
5. Open /api/diagnostics and confirm:
   - ok: true
   - version: 4.0
   - actuals_table_ready: true
6. Open Deliveries & Invoices and enter a test delivery, or import a CSV.
7. Confirm that Executive Dashboard, Profit Control, and Inventory Forecast
   update after the actual is saved.

CSV IMPORT
Required columns:
- customer
- delivery_date
- volume_nt

Recommended columns:
- external_id
- sell_price_per_nt
- invoice_number
- invoice_date
- invoice_amount_usd
- payment_date
- status
- notes

A template is included at:
public/agema_invoice_import_template.csv

Supported status values used in profit calculations:
- Delivered
- Invoiced
- Paid

Rows marked Void are retained in the ledger but excluded from volume, inventory,
revenue, and profit calculations.
