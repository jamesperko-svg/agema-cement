import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { requireAuth } from '../../lib/auth';
import { db, loadSalesPipeline, calculateModel } from '../../lib/db';
import { calculateProfitForecast } from '../../lib/profit';
import Shell from '../_shell';

function money(value, digits = 2) {
  return Number(value || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: digits });
}

function num(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

async function saveCargo(formData) {
  'use server';
  requireAuth();
  const s = db();
  const id = String(formData.get('id'));
  const payload = {
    saleable_nt: Number(formData.get('saleable_nt')),
    material_fob_per_nt: Number(formData.get('material_fob_per_nt')),
    ocean_freight_per_nt: Number(formData.get('ocean_freight_per_nt')),
    demurrage_per_nt: Number(formData.get('demurrage_per_nt')),
    misc_per_nt: Number(formData.get('misc_per_nt')),
    tariff_per_nt: Number(formData.get('tariff_per_nt')),
    expected_arrival_date: String(formData.get('expected_arrival_date') || '') || null
  };
  const { error } = await s.from('cargoes').update(payload).eq('id', id);
  if (error) throw error;

  const customerId = String(formData.get('customer_id'));
  const { error: customerError } = await s.from('customers').update({
    default_price_per_nt: Number(formData.get('sell_price')),
    payment_terms_days: Number(formData.get('payment_terms_days'))
  }).eq('id', customerId);
  if (customerError) throw customerError;

  revalidatePath('/costs');
  revalidatePath('/dashboard');
  revalidatePath('/profit');
  revalidatePath('/actuals');
  revalidatePath('/throughput');
}

export default async function Costs() {
  requireAuth();
  const data = await loadSalesPipeline();
  const model = calculateModel(data);
  const profit = calculateProfitForecast(data);
  const expected = profit.expected;
  const cargo = data.cargo;
  const customer = data.customers[0] || {};
  const projectedCostPerNT = expected.projectedVolumeNT > 0 ? expected.projectedCostUSD / expected.projectedVolumeNT : 0;

  return <Shell>
    <div className="top">
      <div><h1 className="title">Toledo Cargo Economics</h1><div className="muted">Edit landed-cost assumptions here. V4 immediately applies them to actual delivered tons and all three profit forecasts.</div></div>
      <Link href="/profit" className="btn secondary">Open Profit Control</Link>
    </div>

    <form action={saveCargo} className="form section">
      <input type="hidden" name="id" value={cargo.id}/>
      <input type="hidden" name="customer_id" value={customer.id || ''}/>
      <div className="form-grid">
        {[
          ['saleable_nt', 'Saleable cargo (NT)', cargo.saleable_nt],
          ['material_fob_per_nt', 'Material FOB ($/NT)', cargo.material_fob_per_nt],
          ['ocean_freight_per_nt', 'Ocean freight ($/NT)', cargo.ocean_freight_per_nt],
          ['demurrage_per_nt', 'Demurrage ($/NT)', cargo.demurrage_per_nt],
          ['misc_per_nt', 'Misc. CS/JSC/Duty ($/NT)', cargo.misc_per_nt],
          ['tariff_per_nt', 'Tariff ($/NT)', cargo.tariff_per_nt],
          ['sell_price', 'Available reference sell price ($/NT)', customer.default_price_per_nt || 160],
          ['payment_terms_days', 'Available payment terms (days)', customer.payment_terms_days || 60]
        ].map(([name, label, value]) => <div className="field" key={name}><label>{label}</label><input name={name} type="number" step={name === 'payment_terms_days' ? '1' : '0.01'} defaultValue={value ?? 0}/></div>)}
        <div className="field"><label>Cargo available at Toledo</label><input name="expected_arrival_date" type="date" defaultValue={cargo.expected_arrival_date || ''}/></div>
      </div>
      <div style={{ marginTop: 16 }}><button className="btn">Save Toledo assumptions</button></div>
    </form>

    <div className="two section">
      <div className="card">
        <h2>Audited base cost bridge</h2>
        <table className="table"><tbody>
          {model.baseComponents.map(([label, value]) => <tr key={label}><td>{label}</td><td>{money(value)}/NT</td></tr>)}
          <tr><th>Base cargo + terminal</th><th>{money(model.base)}/NT</th></tr>
        </tbody></table>
      </div>

      <div className="card">
        <h2>V4 expected cargo cost</h2>
        <table className="table"><tbody>
          <tr><td>Projected sold volume</td><td>{num(expected.projectedVolumeNT)} NT</td></tr>
          <tr><td>Allocated landed cost</td><td>{money(profit.actual.baseCostUSD + expected.forecastBaseCostUSD, 0)}</td></tr>
          <tr><td>Time-based storage</td><td>{money(profit.actual.storageCostUSD + expected.forecastStorageCostUSD, 0)}</td></tr>
          <tr><td>SOFR-based A/R financing</td><td>{money(profit.actual.financeCostExpectedUSD + expected.forecastFinanceCostUSD, 0)}</td></tr>
          <tr><th>Projected total cost</th><th>{money(expected.projectedCostUSD, 0)}</th></tr>
          <tr><th>Projected cost / sold NT</th><th>{money(projectedCostPerNT)}/NT</th></tr>
        </tbody></table>
        <p className="muted">The expected cost changes as actual delivery dates, customer prices, payment dates, and remaining forecast timing change.</p>
      </div>
    </div>

    <div className="two section">
      <div className="card">
        <h2>Storage & financing rates</h2>
        <table className="table"><tbody>
          <tr><td>MidWest storage</td><td>{money(model.storageRateMTMonth)}/MT/month</td></tr>
          <tr><td>SOFR</td><td>{model.sofr.toFixed(2)}%</td></tr>
          <tr><td>Bank spread</td><td>{model.spread.toFixed(2)}%</td></tr>
          <tr><th>Borrowing rate</th><th>{(model.sofr + model.spread).toFixed(2)}%</th></tr>
        </tbody></table>
      </div>
      <div className="card">
        <h2>Expected projected result</h2>
        <table className="table"><tbody>
          <tr><td>Projected revenue</td><td>{money(expected.projectedRevenueUSD, 0)}</td></tr>
          <tr><td>Projected average price</td><td>{money(expected.projectedAverageSellPricePerNT)}/NT</td></tr>
          <tr><td>Projected margin</td><td>{money(expected.projectedMarginPerNT)}/NT</td></tr>
          <tr><th>Projected profit</th><th className={expected.projectedProfitUSD >= 0 ? 'positive-text' : 'negative-text'}>{money(expected.projectedProfitUSD, 0)}</th></tr>
          <tr><td>Inventory left after forecast</td><td>{num(expected.endingInventoryNT)} NT</td></tr>
        </tbody></table>
      </div>
    </div>
  </Shell>;
}
