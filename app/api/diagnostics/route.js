import { NextResponse } from 'next/server';
import { loadToledo, calculateModel } from '../../../lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await loadToledo();
    const model = calculateModel(data);

    return NextResponse.json({
      ok: true,
      generated_at: new Date().toISOString(),
      market: 'Toledo',
      cargo: {
        saleable_nt: Number(data.cargo?.saleable_nt || 0),
        material_fob_per_nt: Number(data.cargo?.material_fob_per_nt || 0),
        ocean_freight_per_nt: Number(data.cargo?.ocean_freight_per_nt || 0),
        demurrage_per_nt: Number(data.cargo?.demurrage_per_nt || 0),
        misc_per_nt: Number(data.cargo?.misc_per_nt || 0),
        tariff_per_nt: Number(data.cargo?.tariff_per_nt || 0)
      },
      financing: {
        sofr_date: data.sofr?.rate_date || null,
        sofr_pct: Number(model.sofr || 0),
        bank_spread_pct: Number(model.spread || 0),
        borrowing_rate_pct: Number(model.annual || 0) * 100
      },
      economics: {
        base_cost_per_nt: Number(model.base || 0),
        storage_per_nt: Number(model.storageNT || 0),
        ar_financing_per_nt: Number(model.arFinanceNT || 0),
        modeled_cost_per_nt: Number(model.modeledCost || 0),
        sell_price_per_nt: Number(model.sellPrice || 0),
        margin_per_nt: Number(model.marginNT || 0),
        scheduled_nt: Number(model.totalShipped || 0),
        remaining_nt: Number(model.remaining || 0)
      },
      terminal_rates: (data.terminalRates || []).map(r => ({
        rate_name: r.rate_name,
        rate_value: Number(r.rate_value || 0),
        unit: r.unit,
        conditional: Boolean(r.conditional)
      })),
      throughput: (data.throughput || []).map(p => ({
        start_date: p.start_date,
        end_date: p.end_date,
        trucks_per_day: Number(p.trucks_per_day || 0),
        avg_nt_per_truck: Number(p.avg_nt_per_truck || 0),
        operating_days_per_week: Number(p.operating_days_per_week || 0)
      }))
    }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0'
      }
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Diagnostics failed' },
      { status: 500 }
    );
  }
}
