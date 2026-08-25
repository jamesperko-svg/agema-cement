import { NextResponse } from 'next/server';
import { loadSalesPipeline, calculateModel, calculateInventoryForecast } from '../../../lib/db';
import { calculateProfitForecast } from '../../../lib/profit';

export const dynamic = 'force-dynamic';

function cleanInventoryCase(value) {
  return {
    weekly_demand_nt: Number(value.activeWeeklyDemand || 0),
    weeks_of_supply: value.weeksOfSupply,
    stockout_date: value.stockoutDate,
    target_cargo_2_arrival: value.targetArrivalDate,
    reorder_deadline: value.reorderDeadline,
    lead_days: Number(value.leadDays || 0),
    safety_days: Number(value.safetyDays || 0)
  };
}

function cleanProfitCase(value) {
  return {
    actual_volume_nt: Number(value.actualVolumeNT || 0),
    forecast_volume_nt: Number(value.forecastVolumeNT || 0),
    projected_volume_nt: Number(value.projectedVolumeNT || 0),
    projected_revenue_usd: Number(value.projectedRevenueUSD || 0),
    projected_cost_usd: Number(value.projectedCostUSD || 0),
    projected_profit_usd: Number(value.projectedProfitUSD || 0),
    projected_margin_per_nt: Number(value.projectedMarginPerNT || 0),
    ending_inventory_nt: Number(value.endingInventoryNT || 0),
    sellout_date: value.selloutDate,
    fully_sold: Boolean(value.isFullySold)
  };
}

export async function GET() {
  try {
    const data = await loadSalesPipeline();
    const model = calculateModel(data);
    const forecast = calculateInventoryForecast(data);
    const profit = calculateProfitForecast(data);

    return NextResponse.json({
      ok: true,
      version: '4.0',
      generated_at: new Date().toISOString(),
      market: 'Toledo',
      actuals_table_ready: Boolean(data.salesActualsTableReady),
      cargo: {
        saleable_nt: Number(data.cargo?.saleable_nt || 0),
        expected_arrival_date: data.cargo?.expected_arrival_date || null
      },
      economics: {
        base_cost_per_nt: Number(model.base || 0),
        legacy_storage_per_nt: Number(model.storageNT || 0),
        legacy_ar_financing_per_nt: Number(model.arFinanceNT || 0),
        legacy_modeled_cost_per_nt: Number(model.modeledCost || 0),
        reference_sell_price_per_nt: Number(model.sellPrice || 0),
        reference_margin_per_nt: Number(model.marginNT || 0)
      },
      financing: {
        sofr_date: model.sofrDate || null,
        sofr_pct: Number(model.sofr || 0),
        bank_spread_pct: Number(model.spread || 0),
        borrowing_rate_pct: Number(model.sofr || 0) + Number(model.spread || 0)
      },
      pipeline: {
        target_nt: Number(forecast.totalTarget || 0),
        expected_target_nt: Number(forecast.totalWeightedTarget || 0),
        firm_target_nt: Number(forecast.totalCommittedTarget || 0),
        plans: (data.customerPlans || []).map(plan => ({
          customer: plan.customers?.name,
          status: plan.customers?.status,
          target_nt: Number(plan.target_volume_nt || 0),
          probability_pct: Number(plan.probability_pct || 0),
          weekly_throughput_nt: Number(plan.trucks_per_day || 0) * Number(plan.avg_nt_per_truck || 0) * Number(plan.operating_days_per_week || 0),
          forecast_ongoing: plan.forecast_ongoing !== false
        }))
      },
      actuals: {
        record_count: Number(profit.actual.recordCount || 0),
        delivered_nt: Number(profit.actual.volumeNT || 0),
        current_inventory_nt: Number(profit.actual.currentInventoryNT || 0),
        revenue_usd: Number(profit.actual.revenueUSD || 0),
        modeled_cost_usd: Number(profit.actual.totalCostExpectedUSD || 0),
        modeled_profit_usd: Number(profit.actual.profitExpectedUSD || 0),
        average_sell_price_per_nt: Number(profit.actual.averageSellPricePerNT || 0),
        margin_per_nt: Number(profit.actual.marginPerNT || 0),
        last_delivery_date: profit.actual.lastDeliveryDate
      },
      profit_cases: {
        firm: cleanProfitCase(profit.firm),
        expected: cleanProfitCase(profit.expected),
        upside: cleanProfitCase(profit.upside)
      },
      lead_time: forecast.leadTimeComponents,
      inventory_cases: {
        firm: cleanInventoryCase(forecast.firm),
        expected: cleanInventoryCase(forecast.expected),
        upside: cleanInventoryCase(forecast.upside)
      }
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'Diagnostics failed' }, { status: 500 });
  }
}
