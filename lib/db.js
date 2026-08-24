import { createClient } from '@supabase/supabase-js';

export function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase environment variables are not configured.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const MT_TO_NT = 1.10231131;

export async function loadToledo() {
  const s = db();
  const { data: market, error: marketError } = await s.from('markets').select('*').eq('name','Toledo').single();
  if (marketError) throw marketError;
  const [cargoRes, customerRes, terminalRes, throughputRes, sofrRes, financeRes] = await Promise.all([
    s.from('cargoes').select('*').eq('market_id', market.id).order('created_at', { ascending: true }).limit(1).maybeSingle(),
    s.from('customers').select('*').eq('market_id', market.id).order('created_at', { ascending: true }),
    s.from('terminal_rates').select('*').eq('market_id', market.id).order('rate_name'),
    s.from('throughput_periods').select('*').eq('market_id', market.id).order('start_date'),
    s.from('latest_sofr').select('*').maybeSingle(),
    s.from('financing_settings').select('*').eq('active', true).limit(1).maybeSingle()
  ]);
  for (const r of [cargoRes, customerRes, terminalRes, throughputRes, sofrRes, financeRes]) if (r.error) throw r.error;
  return { market, cargo: cargoRes.data, customers: customerRes.data || [], terminalRates: terminalRes.data || [], throughput: throughputRes.data || [], sofr: sofrRes.data, finance: financeRes.data };
}

function rateMap(rates) {
  return Object.fromEntries(rates.map(r => [r.rate_name, Number(r.rate_value)]));
}

export function calculateModel(data) {
  const cargo = data.cargo || {};
  const rates = rateMap(data.terminalRates || []);
  const qty = Number(cargo.saleable_nt || 0);
  const variableMT = ['Vessel Discharge','Handling Into Warehouse','Bazooka Tube Loading','Port Fee']
    .reduce((sum, k) => sum + Number(rates[k] || 0), 0);
  const variableNT = variableMT / MT_TO_NT;
  const fixed = Number(rates['Tarping'] || 0) + 2 * Number(rates['Dockage'] || 0) + Number(rates['Lines In Straight Time'] || 0) + Number(rates['Lines Out Straight Time'] || 0);
  const fixedNT = qty ? fixed / qty : 0;
  const base = Number(cargo.material_fob_per_nt || 0) + Number(cargo.ocean_freight_per_nt || 0) + Number(cargo.demurrage_per_nt || 0) + Number(cargo.misc_per_nt || 0) + Number(cargo.tariff_per_nt || 0) + variableNT + fixedNT;

  const customer = (data.customers || [])[0] || {};
  const sellPrice = Number(customer.default_price_per_nt || 0);
  const sofr = Number(data.sofr?.sofr_rate_pct || 0);
  const spread = Number(data.finance?.bank_spread_pct || 2);
  const annual = (sofr + spread) / 100;
  const dayBasis = Number(data.finance?.day_count_basis || 360);
  const arrival = cargo.expected_arrival_date ? new Date(`${cargo.expected_arrival_date}T12:00:00`) : new Date();
  const storageRateMTMonth = Number(rates['Warehouse Storage'] || 0);
  const storageRateNTWeek = (storageRateMTMonth / MT_TO_NT) / 4.33;

  let remaining = qty;
  let totalStorage = 0;
  let totalARInterest = 0;
  let totalShipped = 0;
  const weeks = [];
  let cursor = new Date(arrival);
  cursor.setDate(cursor.getDate() - ((cursor.getDay()+6)%7));

  for (let week=0; week<160 && remaining>0.01; week++) {
    const weekStart = new Date(cursor);
    const weekEnd = new Date(cursor); weekEnd.setDate(weekEnd.getDate()+4);
    let active = (data.throughput || []).filter(p => {
      const s = new Date(`${p.start_date}T12:00:00`), e = new Date(`${p.end_date}T12:00:00`);
      return s <= weekEnd && e >= weekStart;
    });
    const p = active.length ? active[active.length-1] : null;
    const trucks = Number(p?.trucks_per_day || 0);
    const ntTruck = Number(p?.avg_nt_per_truck || 0);
    const days = Number(p?.operating_days_per_week || 0);
    const planned = trucks * ntTruck * days;
    const shipped = Math.min(remaining, planned);
    const invStart = remaining;
    remaining -= shipped;
    const avgInv = (invStart + remaining) / 2;
    totalStorage += storageRateNTWeek * avgInv;
    totalShipped += shipped;

    const invoiceDate = new Date(weekStart); invoiceDate.setDate(invoiceDate.getDate()+7);
    const paymentDate = new Date(invoiceDate); paymentDate.setDate(paymentDate.getDate()+Number(customer.payment_terms_days || 60));
    const avgShip = new Date(weekStart); avgShip.setDate(avgShip.getDate()+2);
    const arDays = Math.max(0, Math.round((paymentDate-avgShip)/86400000));
    const arInterestNT = sellPrice * annual * arDays / dayBasis;
    totalARInterest += arInterestNT * shipped;

    weeks.push({ week: week+1, weekStart, shipped, remaining, trucks, ntTruck, days, invoiceDate, paymentDate, arDays, arInterestNT });
    cursor.setDate(cursor.getDate()+7);
    if (!planned && week > 52) break;
  }

  const storageNT = qty ? totalStorage / qty : 0;
  const arFinanceNT = qty ? totalARInterest / qty : 0;
  const modeledCost = base + storageNT + arFinanceNT;
  const marginNT = sellPrice - modeledCost;
  return { rates, qty, variableNT, fixedNT, base, storageNT, arFinanceNT, modeledCost, sellPrice, marginNT, sofr, spread, annual, weeks, totalShipped, remaining, customer };
}
