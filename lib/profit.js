import { calculateModel, MT_TO_NT } from './db';

const DAY_MS = 86400000;
const ACTIVE_ACTUAL_STATUSES = new Set(['delivered', 'invoiced', 'paid']);

function toDate(value) {
  if (value instanceof Date) {
    const d = new Date(value);
    d.setHours(12, 0, 0, 0);
    return d;
  }
  if (!value) return null;
  const raw = String(value).slice(0, 10);
  const d = new Date(`${raw}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoDate(value) {
  const d = toDate(value);
  return d ? d.toISOString().slice(0, 10) : null;
}

function addDays(value, days) {
  const d = toDate(value) || new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function mondayOf(value) {
  const d = toDate(value) || toDate(new Date());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function differenceInDays(later, earlier) {
  const a = toDate(later);
  const b = toDate(earlier);
  if (!a || !b) return 0;
  return Math.max(0, Math.round((a.getTime() - b.getTime()) / DAY_MS));
}

function minDate(...values) {
  const dates = values.flat().map(toDate).filter(Boolean);
  if (!dates.length) return null;
  return new Date(Math.min(...dates.map(d => d.getTime())));
}

function maxDate(...values) {
  const dates = values.flat().map(toDate).filter(Boolean);
  if (!dates.length) return null;
  return new Date(Math.max(...dates.map(d => d.getTime())));
}

function validNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isActualRecordIncluded(record, asOfDate) {
  const status = String(record?.status || 'Invoiced').trim().toLowerCase();
  if (!ACTIVE_ACTUAL_STATUSES.has(status)) return false;
  const deliveryDate = toDate(record?.delivery_date);
  return Boolean(deliveryDate && deliveryDate <= asOfDate && validNumber(record?.volume_nt) > 0);
}

function customerById(data) {
  return new Map((data.customers || []).map(customer => [String(customer.id), customer]));
}

function planPriceByCustomer(data) {
  const result = new Map();
  for (const plan of data.customerPlans || []) {
    const id = String(plan.customer_id || plan.customers?.id || '');
    if (!id) continue;
    const customer = plan.customers || {};
    const price = validNumber(plan.sell_price_per_nt, validNumber(customer.default_price_per_nt, 0));
    if (price > 0) result.set(id, price);
  }
  return result;
}

function activePlanForWeek(plan, weekStart) {
  if (plan?.active === false) return false;
  const start = toDate(plan?.start_date);
  if (!start || weekStart < mondayOf(start)) return false;
  if (plan?.forecast_ongoing !== false) return true;
  const end = toDate(plan?.end_date) || toDate('2099-12-31');
  const weekEnd = addDays(weekStart, 4);
  return start <= weekEnd && end >= weekStart;
}

function scenarioFactor(plan, mode) {
  const status = String(plan?.customers?.status || '').trim().toLowerCase();
  if (mode === 'firm') return status === 'committed' || status === 'active' ? 1 : 0;
  if (mode === 'expected') return Math.max(0, Math.min(1, validNumber(plan?.probability_pct, 100) / 100));
  return 1;
}

function buildPlanDemandForWeek(data, weekStart, mode) {
  const demand = new Map();
  for (const plan of data.customerPlans || []) {
    if (!activePlanForWeek(plan, weekStart)) continue;
    const factor = scenarioFactor(plan, mode);
    if (factor <= 0) continue;

    const customer = plan.customers || {};
    const customerId = String(plan.customer_id || customer.id || '');
    if (!customerId) continue;

    const gross = validNumber(plan.trucks_per_day) * validNumber(plan.avg_nt_per_truck) * validNumber(plan.operating_days_per_week);
    const volume = gross * factor;
    if (volume <= 0) continue;

    const price = validNumber(plan.sell_price_per_nt, validNumber(customer.default_price_per_nt));
    const terms = validNumber(customer.payment_terms_days, 0);
    const existing = demand.get(customerId) || {
      customerId,
      customerName: customer.name || 'Customer',
      volumeNT: 0,
      revenueUSD: 0,
      termsVolumeDays: 0,
      planIds: []
    };
    existing.volumeNT += volume;
    existing.revenueUSD += volume * price;
    existing.termsVolumeDays += volume * terms;
    existing.planIds.push(plan.id);
    demand.set(customerId, existing);
  }

  for (const item of demand.values()) {
    item.pricePerNT = item.volumeNT > 0 ? item.revenueUSD / item.volumeNT : 0;
    item.paymentTermsDays = item.volumeNT > 0 ? item.termsVolumeDays / item.volumeNT : 0;
  }
  return demand;
}

function actualRevenue(record, fallbackPrice) {
  const amount = validNumber(record?.invoice_amount_usd, NaN);
  if (Number.isFinite(amount) && amount >= 0 && record?.invoice_amount_usd !== null && record?.invoice_amount_usd !== '') return amount;
  const price = validNumber(record?.sell_price_per_nt, fallbackPrice);
  return validNumber(record?.volume_nt) * price;
}

function computeActuals(data, asOfDate, assumptions) {
  const customers = customerById(data);
  const planPrices = planPriceByCustomer(data);
  const byWeek = new Map();
  const byCustomer = new Map();
  const records = [];

  let volumeNT = 0;
  let revenueUSD = 0;
  let baseCostUSD = 0;
  let storageCostUSD = 0;
  let financeCostExpectedUSD = 0;
  let financeCostAccruedUSD = 0;
  let lastDeliveryDate = null;

  for (const record of data.salesActuals || []) {
    if (!isActualRecordIncluded(record, asOfDate)) continue;

    const customerId = String(record.customer_id || record.customers?.id || '');
    const customer = record.customers || customers.get(customerId) || {};
    const quantity = validNumber(record.volume_nt);
    const fallbackPrice = validNumber(customer.default_price_per_nt, validNumber(planPrices.get(customerId)));
    const revenue = actualRevenue(record, fallbackPrice);
    const unitPrice = quantity > 0 ? revenue / quantity : fallbackPrice;
    const deliveryDate = toDate(record.delivery_date);
    const invoiceDate = toDate(record.invoice_date) || deliveryDate;
    const terms = validNumber(customer.payment_terms_days, 0);
    const expectedPaymentDate = toDate(record.payment_date) || addDays(invoiceDate, terms);
    const paidOrExpectedDate = maxDate(invoiceDate, expectedPaymentDate) || invoiceDate;
    const accruedEndDate = minDate(asOfDate, paidOrExpectedDate) || asOfDate;

    const storageDays = differenceInDays(deliveryDate, assumptions.cargoAvailableDate);
    const expectedFinanceDays = differenceInDays(paidOrExpectedDate, deliveryDate);
    const accruedFinanceDays = differenceInDays(accruedEndDate, deliveryDate);

    const lineBaseCost = quantity * assumptions.baseCostPerNT;
    const lineStorageCost = quantity * assumptions.storageRatePerNTDay * storageDays;
    const lineFinanceExpected = revenue * assumptions.annualBorrowingRate * expectedFinanceDays / assumptions.dayCountBasis;
    const lineFinanceAccrued = revenue * assumptions.annualBorrowingRate * accruedFinanceDays / assumptions.dayCountBasis;
    const lineCostExpected = lineBaseCost + lineStorageCost + lineFinanceExpected;
    const lineProfitExpected = revenue - lineCostExpected;

    const line = {
      ...record,
      customerId,
      customerName: customer.name || 'Customer',
      volumeNT: quantity,
      unitPrice,
      revenueUSD: revenue,
      baseCostUSD: lineBaseCost,
      storageCostUSD: lineStorageCost,
      financeCostExpectedUSD: lineFinanceExpected,
      financeCostAccruedUSD: lineFinanceAccrued,
      totalCostExpectedUSD: lineCostExpected,
      profitExpectedUSD: lineProfitExpected,
      deliveryDate,
      invoiceDate,
      expectedPaymentDate: paidOrExpectedDate,
      storageDays,
      expectedFinanceDays,
      accruedFinanceDays
    };
    records.push(line);

    const weekKey = isoDate(mondayOf(deliveryDate));
    const week = byWeek.get(weekKey) || new Map();
    const weekCustomer = week.get(customerId) || {
      customerId,
      customerName: line.customerName,
      volumeNT: 0,
      revenueUSD: 0,
      baseCostUSD: 0,
      storageCostUSD: 0,
      financeCostExpectedUSD: 0,
      financeCostAccruedUSD: 0,
      recordCount: 0
    };
    weekCustomer.volumeNT += quantity;
    weekCustomer.revenueUSD += revenue;
    weekCustomer.baseCostUSD += lineBaseCost;
    weekCustomer.storageCostUSD += lineStorageCost;
    weekCustomer.financeCostExpectedUSD += lineFinanceExpected;
    weekCustomer.financeCostAccruedUSD += lineFinanceAccrued;
    weekCustomer.recordCount += 1;
    week.set(customerId, weekCustomer);
    byWeek.set(weekKey, week);

    const customerTotal = byCustomer.get(customerId) || {
      customerId,
      customerName: line.customerName,
      actualVolumeNT: 0,
      actualRevenueUSD: 0,
      actualCostUSD: 0,
      actualProfitUSD: 0
    };
    customerTotal.actualVolumeNT += quantity;
    customerTotal.actualRevenueUSD += revenue;
    customerTotal.actualCostUSD += lineCostExpected;
    customerTotal.actualProfitUSD += lineProfitExpected;
    byCustomer.set(customerId, customerTotal);

    volumeNT += quantity;
    revenueUSD += revenue;
    baseCostUSD += lineBaseCost;
    storageCostUSD += lineStorageCost;
    financeCostExpectedUSD += lineFinanceExpected;
    financeCostAccruedUSD += lineFinanceAccrued;
    lastDeliveryDate = maxDate(lastDeliveryDate, deliveryDate);
  }

  const totalCostExpectedUSD = baseCostUSD + storageCostUSD + financeCostExpectedUSD;
  const totalCostAccruedUSD = baseCostUSD + storageCostUSD + financeCostAccruedUSD;

  return {
    records,
    byWeek,
    byCustomer,
    recordCount: records.length,
    volumeNT,
    revenueUSD,
    baseCostUSD,
    storageCostUSD,
    financeCostExpectedUSD,
    financeCostAccruedUSD,
    totalCostExpectedUSD,
    totalCostAccruedUSD,
    profitExpectedUSD: revenueUSD - totalCostExpectedUSD,
    profitAccruedUSD: revenueUSD - totalCostAccruedUSD,
    averageSellPricePerNT: volumeNT > 0 ? revenueUSD / volumeNT : 0,
    marginPerNT: volumeNT > 0 ? (revenueUSD - totalCostExpectedUSD) / volumeNT : 0,
    lastDeliveryDate
  };
}

function mergeCustomerSummary(target, item) {
  const id = String(item.customerId || 'unknown');
  const existing = target.get(id) || {
    customerId: id,
    customerName: item.customerName || 'Customer',
    actualVolumeNT: 0,
    forecastVolumeNT: 0,
    projectedVolumeNT: 0,
    actualRevenueUSD: 0,
    forecastRevenueUSD: 0,
    projectedRevenueUSD: 0,
    actualCostUSD: 0,
    forecastCostUSD: 0,
    projectedCostUSD: 0,
    actualProfitUSD: 0,
    forecastProfitUSD: 0,
    projectedProfitUSD: 0
  };

  for (const field of [
    'actualVolumeNT', 'forecastVolumeNT', 'projectedVolumeNT',
    'actualRevenueUSD', 'forecastRevenueUSD', 'projectedRevenueUSD',
    'actualCostUSD', 'forecastCostUSD', 'projectedCostUSD',
    'actualProfitUSD', 'forecastProfitUSD', 'projectedProfitUSD'
  ]) existing[field] += validNumber(item[field]);

  target.set(id, existing);
}

function buildScenario(data, mode, asOfDate, assumptions, actual) {
  const arrivalWeek = mondayOf(assumptions.cargoAvailableDate);
  const earliestActualWeek = actual.records.length ? mondayOf(minDate(actual.records.map(record => record.deliveryDate))) : null;
  const startWeek = minDate(arrivalWeek, earliestActualWeek) || arrivalWeek;
  const currentWeek = mondayOf(asOfDate);
  const latestActualWeek = actual.lastDeliveryDate ? mondayOf(actual.lastDeliveryDate) : null;
  const requiredThroughWeek = maxDate(currentWeek, latestActualWeek) || currentWeek;
  const maxWeeks = 260;

  let remainingInventoryNT = assumptions.cargoQuantityNT;
  let forecastVolumeNT = 0;
  let forecastRevenueUSD = 0;
  let forecastBaseCostUSD = 0;
  let forecastStorageCostUSD = 0;
  let forecastFinanceCostUSD = 0;
  let overdrawNT = 0;
  let selloutDate = null;
  const weeks = [];
  const customerSummary = new Map();

  for (const customerActual of actual.byCustomer.values()) {
    mergeCustomerSummary(customerSummary, {
      ...customerActual,
      projectedVolumeNT: customerActual.actualVolumeNT,
      projectedRevenueUSD: customerActual.actualRevenueUSD,
      projectedCostUSD: customerActual.actualCostUSD,
      projectedProfitUSD: customerActual.actualProfitUSD
    });
  }

  for (let index = 0; index < maxWeeks; index += 1) {
    const weekStart = addDays(startWeek, index * 7);
    const weekKey = isoDate(weekStart);
    const actualByCustomer = actual.byWeek.get(weekKey) || new Map();
    const plannedByCustomer = buildPlanDemandForWeek(data, weekStart, mode);
    const isPastWeek = weekStart < currentWeek;
    const isCurrentWeek = weekKey === isoDate(currentWeek);

    const beginningInventoryNT = remainingInventoryNT;
    let weekActualVolumeNT = 0;
    let weekActualRevenueUSD = 0;
    let weekActualCostUSD = 0;
    const actualDetails = [];

    for (const actualItem of actualByCustomer.values()) {
      const itemCost = actualItem.baseCostUSD + actualItem.storageCostUSD + actualItem.financeCostExpectedUSD;
      weekActualVolumeNT += actualItem.volumeNT;
      weekActualRevenueUSD += actualItem.revenueUSD;
      weekActualCostUSD += itemCost;
      actualDetails.push({
        customerId: actualItem.customerId,
        customerName: actualItem.customerName,
        volumeNT: actualItem.volumeNT,
        revenueUSD: actualItem.revenueUSD,
        costUSD: itemCost,
        profitUSD: actualItem.revenueUSD - itemCost
      });
    }

    if (weekActualVolumeNT > remainingInventoryNT) overdrawNT += weekActualVolumeNT - remainingInventoryNT;
    remainingInventoryNT = Math.max(0, remainingInventoryNT - weekActualVolumeNT);

    const residualDemand = [];
    if (!isPastWeek) {
      for (const plannedItem of plannedByCustomer.values()) {
        const actualItem = actualByCustomer.get(plannedItem.customerId);
        const actualVolumeForCustomer = validNumber(actualItem?.volumeNT);
        const desiredVolume = isCurrentWeek
          ? Math.max(0, plannedItem.volumeNT - actualVolumeForCustomer)
          : plannedItem.volumeNT;
        if (desiredVolume <= 0) continue;
        residualDemand.push({ ...plannedItem, desiredVolumeNT: desiredVolume });
      }
    }

    const totalDesiredVolumeNT = residualDemand.reduce((sum, item) => sum + item.desiredVolumeNT, 0);
    const availableForForecastNT = Math.max(0, remainingInventoryNT);
    const scale = totalDesiredVolumeNT > 0 ? Math.min(1, availableForForecastNT / totalDesiredVolumeNT) : 0;

    let weekForecastVolumeNT = 0;
    let weekForecastRevenueUSD = 0;
    let weekForecastBaseCostUSD = 0;
    let weekForecastStorageCostUSD = 0;
    let weekForecastFinanceCostUSD = 0;
    const forecastDetails = [];

    for (const plannedItem of residualDemand) {
      const quantity = plannedItem.desiredVolumeNT * scale;
      if (quantity <= 0) continue;

      const price = plannedItem.pricePerNT;
      const terms = plannedItem.paymentTermsDays;
      let deliveryDate = addDays(weekStart, 2);
      if (isCurrentWeek && deliveryDate < asOfDate) deliveryDate = asOfDate;
      const invoiceDate = maxDate(addDays(weekStart, 7), deliveryDate) || deliveryDate;
      const paymentDate = addDays(invoiceDate, terms);
      const storageDays = differenceInDays(deliveryDate, assumptions.cargoAvailableDate);
      const financeDays = differenceInDays(paymentDate, deliveryDate);
      const revenue = quantity * price;
      const baseCost = quantity * assumptions.baseCostPerNT;
      const storageCost = quantity * assumptions.storageRatePerNTDay * storageDays;
      const financeCost = revenue * assumptions.annualBorrowingRate * financeDays / assumptions.dayCountBasis;
      const totalCost = baseCost + storageCost + financeCost;
      const profit = revenue - totalCost;

      weekForecastVolumeNT += quantity;
      weekForecastRevenueUSD += revenue;
      weekForecastBaseCostUSD += baseCost;
      weekForecastStorageCostUSD += storageCost;
      weekForecastFinanceCostUSD += financeCost;
      forecastDetails.push({
        customerId: plannedItem.customerId,
        customerName: plannedItem.customerName,
        volumeNT: quantity,
        pricePerNT: price,
        revenueUSD: revenue,
        baseCostUSD: baseCost,
        storageCostUSD: storageCost,
        financeCostUSD: financeCost,
        costUSD: totalCost,
        profitUSD: profit,
        deliveryDate,
        invoiceDate,
        paymentDate
      });

      mergeCustomerSummary(customerSummary, {
        customerId: plannedItem.customerId,
        customerName: plannedItem.customerName,
        forecastVolumeNT: quantity,
        projectedVolumeNT: quantity,
        forecastRevenueUSD: revenue,
        projectedRevenueUSD: revenue,
        forecastCostUSD: totalCost,
        projectedCostUSD: totalCost,
        forecastProfitUSD: profit,
        projectedProfitUSD: profit
      });
    }

    remainingInventoryNT = Math.max(0, remainingInventoryNT - weekForecastVolumeNT);
    forecastVolumeNT += weekForecastVolumeNT;
    forecastRevenueUSD += weekForecastRevenueUSD;
    forecastBaseCostUSD += weekForecastBaseCostUSD;
    forecastStorageCostUSD += weekForecastStorageCostUSD;
    forecastFinanceCostUSD += weekForecastFinanceCostUSD;

    const weekForecastCostUSD = weekForecastBaseCostUSD + weekForecastStorageCostUSD + weekForecastFinanceCostUSD;
    const weekProjectedVolumeNT = weekActualVolumeNT + weekForecastVolumeNT;
    const weekProjectedRevenueUSD = weekActualRevenueUSD + weekForecastRevenueUSD;
    const weekProjectedCostUSD = weekActualCostUSD + weekForecastCostUSD;
    const weekProjectedProfitUSD = weekProjectedRevenueUSD - weekProjectedCostUSD;

    weeks.push({
      week: index + 1,
      weekStart,
      isPastWeek,
      isCurrentWeek,
      beginningInventoryNT,
      actualVolumeNT: weekActualVolumeNT,
      forecastVolumeNT: weekForecastVolumeNT,
      projectedVolumeNT: weekProjectedVolumeNT,
      actualRevenueUSD: weekActualRevenueUSD,
      forecastRevenueUSD: weekForecastRevenueUSD,
      projectedRevenueUSD: weekProjectedRevenueUSD,
      actualCostUSD: weekActualCostUSD,
      forecastCostUSD: weekForecastCostUSD,
      projectedCostUSD: weekProjectedCostUSD,
      projectedProfitUSD: weekProjectedProfitUSD,
      endingInventoryNT: remainingInventoryNT,
      actualDetails,
      forecastDetails
    });

    if (!selloutDate && beginningInventoryNT > 0 && remainingInventoryNT <= 0.01 && weekProjectedVolumeNT > 0) {
      selloutDate = maxDate(
        actualDetails.map(item => {
          const matching = actual.records.filter(record => isoDate(mondayOf(record.deliveryDate)) === weekKey && record.customerId === item.customerId);
          return maxDate(matching.map(record => record.deliveryDate));
        }),
        forecastDetails.map(item => item.deliveryDate),
        addDays(weekStart, 4)
      );
    }

    if (selloutDate && index > 0 && weekStart >= requiredThroughWeek) break;
  }

  const forecastCostUSD = forecastBaseCostUSD + forecastStorageCostUSD + forecastFinanceCostUSD;
  const forecastProfitUSD = forecastRevenueUSD - forecastCostUSD;
  const projectedVolumeNT = actual.volumeNT + forecastVolumeNT;
  const projectedRevenueUSD = actual.revenueUSD + forecastRevenueUSD;
  const projectedCostUSD = actual.totalCostExpectedUSD + forecastCostUSD;
  const projectedProfitUSD = projectedRevenueUSD - projectedCostUSD;

  return {
    mode,
    label: mode === 'firm' ? 'Firm' : mode === 'expected' ? 'Expected' : 'Upside',
    weeks,
    customerSummary: Array.from(customerSummary.values()).sort((a, b) => b.projectedVolumeNT - a.projectedVolumeNT),
    actualVolumeNT: actual.volumeNT,
    forecastVolumeNT,
    projectedVolumeNT,
    actualRevenueUSD: actual.revenueUSD,
    forecastRevenueUSD,
    projectedRevenueUSD,
    actualCostUSD: actual.totalCostExpectedUSD,
    forecastBaseCostUSD,
    forecastStorageCostUSD,
    forecastFinanceCostUSD,
    forecastCostUSD,
    projectedCostUSD,
    actualProfitUSD: actual.profitExpectedUSD,
    forecastProfitUSD,
    projectedProfitUSD,
    projectedMarginPerNT: projectedVolumeNT > 0 ? projectedProfitUSD / projectedVolumeNT : 0,
    projectedAverageSellPricePerNT: projectedVolumeNT > 0 ? projectedRevenueUSD / projectedVolumeNT : 0,
    endingInventoryNT: Math.max(0, remainingInventoryNT),
    inventoryValueRemainingUSD: Math.max(0, remainingInventoryNT) * assumptions.baseCostPerNT,
    selloutDate,
    overdrawNT,
    isFullySold: remainingInventoryNT <= 0.01,
    activeForecastWeeks: weeks.filter(week => week.forecastVolumeNT > 0).length
  };
}

export function calculateProfitForecast(data, options = {}) {
  const model = calculateModel(data);
  const asOfDate = toDate(options.asOfDate || new Date()) || toDate(new Date());
  const cargoAvailableDate = toDate(data.cargo?.expected_arrival_date) || asOfDate;
  const cargoQuantityNT = validNumber(data.cargo?.saleable_nt);
  const storageRatePerNTDay = (validNumber(model.storageRateMTMonth) / MT_TO_NT) / 30.4375;
  const annualBorrowingRate = validNumber(model.annual);
  const dayCountBasis = Math.max(1, validNumber(data.finance?.day_count_basis, 360));

  const assumptions = {
    cargoAvailableDate,
    cargoQuantityNT,
    baseCostPerNT: validNumber(model.base),
    storageRatePerNTDay,
    annualBorrowingRate,
    dayCountBasis,
    sofrRatePct: validNumber(model.sofr),
    bankSpreadPct: validNumber(model.spread),
    borrowingRatePct: (validNumber(model.sofr) + validNumber(model.spread))
  };

  const actual = computeActuals(data, asOfDate, assumptions);
  actual.currentInventoryNT = cargoQuantityNT - actual.volumeNT;
  actual.currentInventoryValueUSD = Math.max(0, actual.currentInventoryNT) * assumptions.baseCostPerNT;
  actual.inventoryOverdrawNT = Math.max(0, -actual.currentInventoryNT);

  const firm = buildScenario(data, 'firm', asOfDate, assumptions, actual);
  const expected = buildScenario(data, 'expected', asOfDate, assumptions, actual);
  const upside = buildScenario(data, 'upside', asOfDate, assumptions, actual);

  return {
    asOfDate,
    assumptions,
    actual,
    firm,
    expected,
    upside
  };
}
