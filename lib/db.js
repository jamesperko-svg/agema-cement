import { createClient } from '@supabase/supabase-js';

export function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase environment variables are not configured.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const MT_TO_NT = 1.10231131;
const NYFED_API = 'https://markets.newyorkfed.org/api/rates/secured/sofr/last/1.json';
const NYFED_SOURCE = 'Federal Reserve Bank of New York';

function isoDate(d) { return new Date(d).toISOString().slice(0,10); }

function parseNyFedSofr(payload) {
  const candidates = [
    ...(Array.isArray(payload?.refRates) ? payload.refRates : []),
    ...(Array.isArray(payload?.rates) ? payload.rates : []),
    ...(Array.isArray(payload?.data) ? payload.data : [])
  ];
  const item = candidates.find(x => String(x?.type || x?.rateType || '').toUpperCase() === 'SOFR') || candidates[0];
  const rateDate = item?.effectiveDate || item?.effective_date || item?.date;
  const rate = Number(item?.percentRate ?? item?.rate ?? item?.sofr);
  if (!rateDate || !Number.isFinite(rate)) throw new Error('NY Fed response did not contain a SOFR observation.');
  const normalizedDate = isoDate(rateDate);
  const today = isoDate(new Date());
  if (normalizedDate > today) throw new Error(`NY Fed returned a future SOFR date (${normalizedDate}).`);
  if (rate < 0 || rate > 25) throw new Error(`NY Fed returned an implausible SOFR rate (${rate}).`);
  return { rate_date: normalizedDate, sofr_rate_pct: rate, source: NYFED_SOURCE };
}

export async function syncLatestSofr({ force = false } = {}) {
  const s = db();
  const { data: stored } = await s.from('sofr_rates').select('rate_date,sofr_rate_pct,source').order('rate_date',{ascending:false}).limit(1).maybeSingle();
  try {
    const fetchOptions = force
      ? { cache:'no-store', headers:{'accept':'application/json','user-agent':'AGEMA-Cement-Platform/2.1'} }
      : { next:{revalidate:3600}, headers:{'accept':'application/json','user-agent':'AGEMA-Cement-Platform/2.1'} };
    const r = await fetch(NYFED_API, fetchOptions);
    if (!r.ok) throw new Error(`NY Fed HTTP ${r.status}`);
    const payload = parseNyFedSofr(await r.json());

    const { error: upsertError } = await s.from('sofr_rates').upsert(payload,{onConflict:'rate_date'});
    if (upsertError) throw upsertError;

    // Remove rows dated after the latest official observation. This cleans up the
    // temporary 2026-08-24 test/stale row created during initial AGEMA setup and
    // prevents a future-dated placeholder from outranking the official fixing.
    const { error: cleanupError } = await s.from('sofr_rates').delete().gt('rate_date', payload.rate_date);
    if (cleanupError) throw cleanupError;

    return { updated:true, ...payload };
  } catch (error) {
    return { updated:false, rate_date:stored?.rate_date, sofr_rate_pct:stored?.sofr_rate_pct, error:String(error?.message || error) };
  }
}
export async function loadToledo() {
  await syncLatestSofr();
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

function rateMap(rates) { return Object.fromEntries(rates.map(r => [r.rate_name, Number(r.rate_value)])); }

export function calculateModel(data) {
  const cargo = data.cargo || {};
  const rates = rateMap(data.terminalRates || []);
  const qty = Number(cargo.saleable_nt || 0);
  const material = Number(cargo.material_fob_per_nt || 0);
  const ocean = Number(cargo.ocean_freight_per_nt || 0);
  const demurrage = Number(cargo.demurrage_per_nt || 0);
  const misc = Number(cargo.misc_per_nt || 0);
  const tariff = Number(cargo.tariff_per_nt || 0);
  const variableMTComponents = [
    ['Vessel Discharge', Number(rates['Vessel Discharge'] || 0)],
    ['Handling Into Warehouse', Number(rates['Handling Into Warehouse'] || 0)],
    ['Bazooka Tube Loading', Number(rates['Bazooka Tube Loading'] || 0)],
    ['Port Fee', Number(rates['Port Fee'] || 0)]
  ];
  const variableMT = variableMTComponents.reduce((sum,[,v])=>sum+v,0);
  const variableNT = variableMT / MT_TO_NT;
  const fixedComponents = [
    ['Tarping', Number(rates['Tarping'] || 0)],
    ['Dockage (2 x 12 hrs)', 2 * Number(rates['Dockage'] || 0)],
    ['Lines In Straight Time', Number(rates['Lines In Straight Time'] || 0)],
    ['Lines Out Straight Time', Number(rates['Lines Out Straight Time'] || 0)]
  ];
  const fixed = fixedComponents.reduce((sum,[,v])=>sum+v,0);
  const fixedNT = qty ? fixed / qty : 0;
  const base = material + ocean + demurrage + misc + tariff + variableNT + fixedNT;

  const customer = (data.customers || [])[0] || {};
  const sellPrice = Number(customer.default_price_per_nt || 0);
  const sofr = Number(data.sofr?.sofr_rate_pct || 0);
  const spread = Number(data.finance?.bank_spread_pct || 2);
  const annual = (sofr + spread) / 100;
  const dayBasis = Number(data.finance?.day_count_basis || 360);
  const arrival = cargo.expected_arrival_date ? new Date(`${cargo.expected_arrival_date}T12:00:00`) : new Date();
  const storageRateMTMonth = Number(rates['Warehouse Storage'] || 0);
  const storageRateNTWeek = (storageRateMTMonth / MT_TO_NT) / 4.33;

  let remaining = qty, totalStorage = 0, totalARInterest = 0, totalShipped = 0;
  const weeks = [];
  let cursor = new Date(arrival);
  cursor.setDate(cursor.getDate() - ((cursor.getDay()+6)%7));

  for (let week=0; week<160 && remaining>0.01; week++) {
    const weekStart = new Date(cursor);
    const weekEnd = new Date(cursor); weekEnd.setDate(weekEnd.getDate()+4);
    const active = (data.throughput || []).filter(p => {
      const ps = new Date(`${p.start_date}T12:00:00`), pe = new Date(`${p.end_date}T12:00:00`);
      return ps <= weekEnd && pe >= weekStart;
    });
    const p = active.length ? active[active.length-1] : null;
    const trucks = Number(p?.trucks_per_day || 0), ntTruck = Number(p?.avg_nt_per_truck || 0), days = Number(p?.operating_days_per_week || 0);
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

    weeks.push({ week:week+1, weekStart, shipped, remaining, trucks, ntTruck, days, invoiceDate, paymentDate, arDays, arInterestNT });
    cursor.setDate(cursor.getDate()+7);
    if (!planned && week > 52) break;
  }

  const storageNT = qty ? totalStorage / qty : 0;
  const arFinanceNT = qty ? totalARInterest / qty : 0;
  const modeledCost = base + storageNT + arFinanceNT;
  const marginNT = sellPrice - modeledCost;
  const baseComponents = [
    ['Material FOB', material], ['Ocean freight', ocean], ['Demurrage', demurrage], ['Misc. CS/JSC/Duty', misc], ['Tariff', tariff],
    ...variableMTComponents.map(([name,v])=>[`${name} (${v.toFixed(2)}/MT)`, v/MT_TO_NT]),
    ...fixedComponents.map(([name,v])=>[name, qty ? v/qty : 0])
  ];
  return { rates, qty, variableNT, fixedNT, base, baseComponents, storageNT, arFinanceNT, modeledCost, sellPrice, marginNT, sofr, sofrDate:data.sofr?.rate_date, spread, annual, weeks, totalShipped, remaining, customer, storageRateMTMonth };
}

export async function loadSalesPipeline() {
  const base = await loadToledo();
  const s = db();
  const [plansRes, settingsRes] = await Promise.all([
    s.from('customer_plans').select('*, customers(*)').eq('market_id', base.market.id).order('start_date'),
    s.from('market_settings').select('*').eq('market_id', base.market.id).maybeSingle()
  ]);
  if (plansRes.error) throw plansRes.error;
  if (settingsRes.error) throw settingsRes.error;
  return { ...base, customerPlans: plansRes.data || [], marketSettings: settingsRes.data || {} };
}

function mondayOf(dateLike) {
  const d = new Date(dateLike);
  d.setHours(12,0,0,0);
  d.setDate(d.getDate() - ((d.getDay()+6)%7));
  return d;
}
function addDays(d, n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function activePlanForWeek(plan, weekStart){
  if (!plan.active) return false;
  const start = new Date(`${plan.start_date}T12:00:00`);
  const end = plan.end_date ? new Date(`${plan.end_date}T12:00:00`) : new Date('2099-12-31T12:00:00');
  const weekEnd = addDays(weekStart,4);
  return start <= weekEnd && end >= weekStart;
}

export function calculateInventoryForecast(data) {
  const cargo = data.cargo || {};
  const qty = Number(cargo.saleable_nt || 0);
  const plans = data.customerPlans || [];
  const settings = data.marketSettings || {};
  const start = mondayOf(cargo.expected_arrival_date ? `${cargo.expected_arrival_date}T12:00:00` : new Date());
  let remaining = qty;
  const weeks = [];
  let stockoutDate = null;
  let totalPlanned = 0;
  let totalWeightedTarget = 0;
  let totalTarget = 0;

  for (const p of plans) {
    const target = Number(p.target_volume_nt || 0);
    const prob = Number(p.probability_pct ?? 100) / 100;
    totalTarget += target;
    totalWeightedTarget += target * prob;
  }

  for (let i=0;i<104;i++) {
    const weekStart = addDays(start,i*7);
    const details = [];
    let planned = 0;
    for (const p of plans) {
      if (!activePlanForWeek(p,weekStart)) continue;
      const gross = Number(p.trucks_per_day||0)*Number(p.avg_nt_per_truck||0)*Number(p.operating_days_per_week||0);
      const prob = Number(p.probability_pct ?? 100)/100;
      const weighted = gross*prob;
      planned += weighted;
      details.push({customer:p.customers?.name || 'Customer', gross_nt:gross, probability_pct:Number(p.probability_pct??100), weighted_nt:weighted});
    }
    totalPlanned += planned;
    const shipped = Math.min(remaining, planned);
    remaining = Math.max(0, remaining-shipped);
    weeks.push({week:i+1, weekStart, planned_nt:planned, shipped_nt:shipped, ending_inventory_nt:remaining, details});
    if (remaining <= 0.01 && planned > 0) { stockoutDate = weekStart; break; }
    if (i>26 && planned===0) break;
  }

  const activeWeeklyDemand = weeks.slice(0,Math.min(4,weeks.length)).reduce((s,w)=>s+w.planned_nt,0)/Math.max(1,Math.min(4,weeks.length));
  const safetyDays = Number(settings.safety_stock_days || 7);
  const leadDays = Number(settings.reorder_lead_days || 35);
  const safetyStockNT = activeWeeklyDemand * (safetyDays/7);
  const targetArrivalDate = stockoutDate ? addDays(stockoutDate,-safetyDays) : null;
  const reorderDeadline = targetArrivalDate ? addDays(targetArrivalDate,-leadDays) : null;
  const weeksOfSupply = activeWeeklyDemand > 0 ? qty/activeWeeklyDemand : null;
  return {qty, weeks, remaining, totalTarget, totalWeightedTarget, totalPlanned, activeWeeklyDemand, weeksOfSupply, safetyStockNT, stockoutDate, targetArrivalDate, reorderDeadline, leadDays, safetyDays, nextCargoSizeNT:Number(settings.next_cargo_size_nt||qty)};
}
