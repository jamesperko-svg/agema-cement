import { NextResponse } from 'next/server';
import { loadSalesPipeline, calculateModel, calculateInventoryForecast } from '../../../lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await loadSalesPipeline();
    const model = calculateModel(data);
    const forecast = calculateInventoryForecast(data);
    const cleanCase = c => ({
      weekly_demand_nt:Number(c.activeWeeklyDemand||0),
      weeks_of_supply:c.weeksOfSupply,
      stockout_date:c.stockoutDate,
      target_cargo_2_arrival:c.targetArrivalDate,
      reorder_deadline:c.reorderDeadline,
      lead_days:Number(c.leadDays||0),
      safety_days:Number(c.safetyDays||0)
    });
    return NextResponse.json({
      ok:true,
      generated_at:new Date().toISOString(),
      market:'Toledo',
      cargo:{saleable_nt:Number(data.cargo?.saleable_nt||0)},
      economics:{
        base_cost_per_nt:Number(model.base||0),
        storage_per_nt:Number(model.storageNT||0),
        ar_financing_per_nt:Number(model.arFinanceNT||0),
        modeled_cost_per_nt:Number(model.modeledCost||0),
        sell_price_per_nt:Number(model.sellPrice||0),
        margin_per_nt:Number(model.marginNT||0)
      },
      financing:{sofr_date:model.sofrDate||null,sofr_pct:Number(model.sofr||0),bank_spread_pct:Number(model.spread||0),borrowing_rate_pct:(Number(model.sofr||0)+Number(model.spread||0))},
      pipeline:{
        target_nt:Number(forecast.totalTarget||0),
        expected_target_nt:Number(forecast.totalWeightedTarget||0),
        firm_target_nt:Number(forecast.totalCommittedTarget||0),
        plans:(data.customerPlans||[]).map(p=>({customer:p.customers?.name,status:p.customers?.status,target_nt:Number(p.target_volume_nt||0),probability_pct:Number(p.probability_pct||0),weekly_throughput_nt:Number(p.trucks_per_day||0)*Number(p.avg_nt_per_truck||0)*Number(p.operating_days_per_week||0),forecast_ongoing:p.forecast_ongoing!==false}))
      },
      lead_time:forecast.leadTimeComponents,
      cases:{firm:cleanCase(forecast.firm),expected:cleanCase(forecast.expected),upside:cleanCase(forecast.upside)}
    },{headers:{'Cache-Control':'no-store, max-age=0'}});
  } catch (error) {
    return NextResponse.json({ok:false,error:error?.message||'Diagnostics failed'},{status:500});
  }
}
