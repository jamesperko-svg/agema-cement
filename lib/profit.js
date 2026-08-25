import { db, loadSalesPipeline, calculateModel, MT_TO_NT } from './db';

const DAY_MS = 86400000;
const MAX_WEEKS = 156;

function atNoon(value) {
  if (value instanceof Date) {
    const copy = new Date(value);
    copy.setHours(12, 0, 0, 0);
    return copy;
  }
  const text = String(value || '');
  return new Date(text.length === 10 ? `${text}T12:00:00` : text);
}
function addDays(value, days) {
  const date = atNoon(value);
  date.setDate(date.getDate() + Number(days || 0));
  return date;
}
function monday(value) {
  const date = atNoon(value);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}
function key(value) {
  const date = monday(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function isMissingTable(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === '42P01' || code === 'PGRST205' || message.includes('sales_actuals');
}

export async function loadProfitData() {
  const data = await loadSalesPipeline();
  const result = await db()
    .from('sales_actuals')
    .select('*, customers(*)')
    .eq('market_id', data.market.id)
    .order('delivery_date', { ascending: true })
    .order('created_at', { ascending: true });

  if (result.error) {
    if (!isMissingTable(result.error)) throw result.error;
    return { ...data, salesActuals: [], salesActualsReady: false };
  }
  return { ...data, salesActuals: result.data || [], salesActualsReady: true };
}

function planActive(plan, weekStart) {
  if (plan.active === false) return false;
  if (weekStart < monday(plan.start_date)) return false;
  if (plan.forecast_ongoing !== false) return true;
  const end = plan.end_date ? atNoon(plan.end_date) : atNoon('2099-12-31');
  return end >= weekStart;
}
function scenarioFactor(plan, mode) {
  const status = String(plan.customers?.status || '').toLowerCase();
  if (mode === 'firm') return status === 'committed' || status === 'active' ? 1 : 0;
  if (mode === 'expected') return Number(plan.probability_pct ?? 100) / 100;
  return 1;
}
function planDetails(data, weekStart, mode) {
  return (data.customerPlans || []).flatMap(plan => {
    if (!planActive(plan, weekStart)) return [];
    const factor = scenarioFactor(plan, mode);
    const volume = Number(plan.trucks_per_day || 0)
      * Number(plan.avg_nt_per_truck || 0)
      * Number(plan.operating_days_per_week || 0)
      * factor;
    if (volume <= 0) return [];
    const customer = plan.customers || {};
    return [{
      customer_id: plan.customer_id,
      customer: customer.name || 'Customer',
      planned_nt: volume,
      unit_price_per_nt: Number(plan.sell_price_per_nt ?? customer.default_price_per_nt ?? 0),
      payment_terms_days: Number(customer.payment_terms_days || 0)
    }];
  });
}
function groupActuals(rows) {
  const map = new Map();
  for (const row of rows) {
    const week = key(row.delivery_date);
    if (!map.has(week)) map.set(week, []);
    map.get(week).push(row);
  }
  return map;
}
function residualize(details, actualRows) {
  const actualByCustomer = new Map();
  for (const row of actualRows) {
    const customer = String(row.customer_id);
    actualByCustomer.set(customer, (actualByCustomer.get(customer) || 0) + Number(row.delivered_nt || 0));
  }
  return details.map(detail => {
    const customer = String(detail.customer_id);
    const available = actualByCustomer.get(customer) || 0;
    const replaced = Math.min(available, detail.planned_nt);
    actualByCustomer.set(customer, Math.max(0, available - replaced));
    return { ...detail, forecast_nt: Math.max(0, detail.planned_nt - replaced) };
  });
}
function actualRevenue(row) {
  if (row.invoice_amount_usd !== null && row.invoice_amount_usd !== undefined) return Number(row.invoice_amount_usd || 0);
  return Number(row.delivered_nt || 0) * Number(row.unit_price_per_nt || 0);
}
function actualMetrics(rows, annualRate, dayBasis) {
  let volumeNT = 0;
  let revenueUSD = 0;
  let financeUSD = 0;
  for (const row of rows) {
    const volume = Number(row.delivered_nt || 0);
    const revenue = actualRevenue(row);
    const terms = Number(row.payment_terms_days ?? row.customers?.payment_terms_days ?? 0);
    const delivery = atNoon(row.delivery_date);
    const invoice = atNoon(row.invoice_date || row.delivery_date);
    const paid = addDays(invoice, terms);
    const days = Math.max(0, Math.round((paid - delivery) / DAY_MS));
    volumeNT += volume;
    revenueUSD += revenue;
    financeUSD += revenue * annualRate * days / dayBasis;
  }
  return { volumeNT, revenueUSD, financeUSD };
}
function forecastMetrics(details, inventoryNT, weekStart, annualRate, dayBasis) {
  const requested = details.reduce((sum, detail) => sum + Number(detail.forecast_nt ?? detail.planned_nt ?? 0), 0);
  const volumeNT = Math.min(Math.max(0, inventoryNT), requested);
  const scale = requested > 0 ? volumeNT / requested : 0;
  let revenueUSD = 0;
  let financeUSD = 0;
  for (const detail of details) {
    const volume = Number(detail.forecast_nt ?? detail.planned_nt ?? 0) * scale;
    const revenue = volume * Number(detail.unit_price_per_nt || 0);
    const financeDays = Number(detail.payment_terms_days || 0) + 5;
    revenueUSD += revenue;
    financeUSD += revenue * annualRate * financeDays / dayBasis;
  }
  return { volumeNT, revenueUSD, financeUSD };
}
function summary(volumeNT, revenueUSD, baseCostPerNT, financeUSD, storageUSD) {
  const baseCostUSD = volumeNT * baseCostPerNT;
  const totalCostUSD = baseCostUSD + financeUSD + storageUSD;
  const profitUSD = revenueUSD - totalCostUSD;
  return {
    volumeNT,
    revenueUSD,
    baseCostUSD,
    financeUSD,
    storageUSD,
    totalCostUSD,
    profitUSD,
    averageSellPricePerNT: volumeNT ? revenueUSD / volumeNT : 0,
    totalCostPerNT: volumeNT ? totalCostUSD / volumeNT : 0,
    marginPerNT: volumeNT ? profitUSD / volumeNT : 0
  };
}

function buildPlan(data, mode, economics, arrivalWeek) {
  let inventory = economics.qty;
  let volume = 0;
  let revenue = 0;
  let finance = 0;
  let storage = 0;
  const weeks = [];

  for (let index = 0; index < MAX_WEEKS; index += 1) {
    const weekStart = addDays(arrivalWeek, index * 7);
    const details = planDetails(data, weekStart, mode).map(detail => ({ ...detail, forecast_nt: detail.planned_nt }));
    const sold = forecastMetrics(details, inventory, weekStart, economics.annualRate, economics.dayBasis);
    const beginning = inventory;
    inventory = Math.max(0, inventory - sold.volumeNT);
    const weekStorage = ((beginning + inventory) / 2) * economics.storageRateNTWeek;
    const weekProfit = sold.revenueUSD - sold.volumeNT * economics.baseCostPerNT - sold.financeUSD - weekStorage;
    volume += sold.volumeNT;
    revenue += sold.revenueUSD;
    finance += sold.financeUSD;
    storage += weekStorage;
    weeks.push({
      weekStart,
      plannedNT: sold.volumeNT,
      revenueUSD: sold.revenueUSD,
      profitUSD: weekProfit,
      endingInventoryNT: inventory
    });
    if (inventory <= 0.001) break;
    if (index >= 51 && volume <= 0.001) break;
  }

  return {
    ...summary(volume, revenue, economics.baseCostPerNT, finance, storage),
    unsoldInventoryNT: inventory,
    unsoldInventoryCostExposureUSD: inventory * economics.baseCostPerNT,
    weeks
  };
}

function buildHybrid(data, mode, economics, plan, arrivalWeek, today) {
  const currentWeek = monday(today);
  const actualRows = (data.salesActuals || []).filter(row => atNoon(row.delivery_date) <= today);
  const actualByWeek = groupActuals(actualRows);
  let inventory = economics.qty;
  let actualVolume = 0;
  let actualRevenueUSD = 0;
  let actualFinanceUSD = 0;
  let actualStorageUSD = 0;
  let forecastVolume = 0;
  let forecastRevenueUSD = 0;
  let forecastFinanceUSD = 0;
  let forecastStorageUSD = 0;
  const weeks = [];
  const planMap = new Map(plan.weeks.map(week => [key(week.weekStart), week]));

  for (let index = 0; index < MAX_WEEKS; index += 1) {
    const weekStart = addDays(arrivalWeek, index * 7);
    const weekKey = key(weekStart);
    const rows = actualByWeek.get(weekKey) || [];
    const actual = actualMetrics(rows, economics.annualRate, economics.dayBasis);
    const beginning = inventory;
    const afterActual = Math.max(0, beginning - actual.volumeNT);

    const canForecast = weekStart >= currentWeek;
    const originalDetails = canForecast ? planDetails(data, weekStart, mode) : [];
    const remainingDetails = canForecast ? residualize(originalDetails, rows) : [];
    const forecast = forecastMetrics(remainingDetails, afterActual, weekStart, economics.annualRate, economics.dayBasis);
    inventory = Math.max(0, afterActual - forecast.volumeNT);

    let incurredStorage = 0;
    let futureStorage = 0;
    if (weekStart < currentWeek) {
      incurredStorage = ((beginning + afterActual) / 2) * economics.storageRateNTWeek;
    } else if (weekKey === key(currentWeek)) {
      const elapsedDays = Math.floor((today - weekStart) / DAY_MS) + 1;
      const elapsed = clamp(elapsedDays / 7, 0, 1);
      incurredStorage = ((beginning + afterActual) / 2) * economics.storageRateNTWeek * elapsed;
      futureStorage = ((afterActual + inventory) / 2) * economics.storageRateNTWeek * (1 - elapsed);
    } else {
      futureStorage = ((beginning + inventory) / 2) * economics.storageRateNTWeek;
    }

    const actualProfit = actual.revenueUSD - actual.volumeNT * economics.baseCostPerNT - actual.financeUSD - incurredStorage;
    const forecastProfit = forecast.revenueUSD - forecast.volumeNT * economics.baseCostPerNT - forecast.financeUSD - futureStorage;
    const planned = planMap.get(weekKey);

    actualVolume += actual.volumeNT;
    actualRevenueUSD += actual.revenueUSD;
    actualFinanceUSD += actual.financeUSD;
    actualStorageUSD += incurredStorage;
    forecastVolume += forecast.volumeNT;
    forecastRevenueUSD += forecast.revenueUSD;
    forecastFinanceUSD += forecast.financeUSD;
    forecastStorageUSD += futureStorage;

    weeks.push({
      week: index + 1,
      weekStart,
      plannedNT: Number(planned?.plannedNT || 0),
      actualNT: actual.volumeNT,
      forecastRemainingNT: forecast.volumeNT,
      projectedTotalNT: actual.volumeNT + forecast.volumeNT,
      actualRevenueUSD: actual.revenueUSD,
      projectedProfitUSD: actualProfit + forecastProfit,
      endingInventoryNT: inventory
    });
    if (inventory <= 0.001 && weekStart >= currentWeek) break;
    if (index >= 51 && weekStart >= currentWeek && actualVolume + forecastVolume <= 0.001) break;
  }

  const actual = summary(actualVolume, actualRevenueUSD, economics.baseCostPerNT, actualFinanceUSD, actualStorageUSD);
  const remaining = summary(forecastVolume, forecastRevenueUSD, economics.baseCostPerNT, forecastFinanceUSD, forecastStorageUSD);
  const projected = summary(
    actualVolume + forecastVolume,
    actualRevenueUSD + forecastRevenueUSD,
    economics.baseCostPerNT,
    actualFinanceUSD + forecastFinanceUSD,
    actualStorageUSD + forecastStorageUSD
  );
  return {
    actual,
    remaining,
    projected: {
      ...projected,
      unsoldInventoryNT: inventory,
      unsoldInventoryCostExposureUSD: inventory * economics.baseCostPerNT
    },
    variance: {
      projectedProfitUSD: projected.profitUSD - plan.profitUSD,
      projectedRevenueUSD: projected.revenueUSD - plan.revenueUSD
    },
    weeks
  };
}

export function calculateProfitModel(data) {
  const base = calculateModel(data);
  const today = atNoon(new Date());
  const arrivalWeek = monday(data.cargo?.expected_arrival_date || today);
  const storageRateNTWeek = (Number(base.storageRateMTMonth || 0) / MT_TO_NT) / 4.33;
  const economics = {
    qty: Number(data.cargo?.saleable_nt || 0),
    baseCostPerNT: Number(base.base || 0),
    annualRate: Number(base.annual || 0),
    dayBasis: Number(data.finance?.day_count_basis || 360),
    storageRateNTWeek
  };

  function build(mode) {
    const plan = buildPlan(data, mode, economics, arrivalWeek);
    return { mode, plan, ...buildHybrid(data, mode, economics, plan, arrivalWeek, today) };
  }

  const firm = build('firm');
  const expected = build('expected');
  const upside = build('upside');
  const actualDeliveredNT = expected.actual.volumeNT;
  return {
    actualsReady: data.salesActualsReady !== false,
    cargoQtyNT: economics.qty,
    actualDeliveredNT,
    currentInventoryNT: Math.max(0, economics.qty - actualDeliveredNT),
    baseCostPerNT: economics.baseCostPerNT,
    storageRateNTWeek,
    borrowingRatePct: Number(base.sofr || 0) + Number(base.spread || 0),
    sofrPct: Number(base.sofr || 0),
    sofrDate: base.sofrDate,
    firm,
    expected,
    upside
  };
}
