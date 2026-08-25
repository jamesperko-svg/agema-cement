import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { requireAuth } from '../../lib/auth';
import { db } from '../../lib/db';
import { loadProfitData, calculateProfitModel } from '../../lib/profit';
import Shell from '../_shell';

function money(value, digits = 0) { return Number(value || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }); }
function num(value, digits = 0) { return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
function date(value) { if (!value) return '—'; const parsed = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T12:00:00`); return parsed.toLocaleDateString(); }
function tone(value) { return Number(value || 0) < 0 ? 'metric negative' : 'metric'; }

async function addActual(formData) {
  'use server';
  requireAuth();
  const deliveredNT = Number(formData.get('delivered_nt'));
  const unitPrice = Number(formData.get('unit_price_per_nt'));
  if (!(deliveredNT > 0)) throw new Error('Delivered net tons must be greater than zero.');
  if (!(unitPrice >= 0)) throw new Error('Unit price must be zero or greater.');
  const invoiceAmount = String(formData.get('invoice_amount_usd') || '').trim();
  const terms = String(formData.get('payment_terms_days') || '').trim();
  const externalKey = String(formData.get('external_key') || '').trim();
  const { error } = await db().from('sales_actuals').insert({
    market_id: String(formData.get('market_id')),
    cargo_id: String(formData.get('cargo_id')),
    customer_id: String(formData.get('customer_id')),
    delivery_date: String(formData.get('delivery_date')),
    invoice_date: String(formData.get('invoice_date') || '') || null,
    invoice_number: String(formData.get('invoice_number') || '').trim() || null,
    delivered_nt: deliveredNT,
    unit_price_per_nt: unitPrice,
    invoice_amount_usd: invoiceAmount === '' ? null : Number(invoiceAmount),
    payment_terms_days: terms === '' ? null : Number(terms),
    source_system: 'Manual',
    external_key: externalKey || null,
    notes: String(formData.get('notes') || '').trim() || null
  });
  if (error) throw error;
  revalidatePath('/profit'); revalidatePath('/dashboard'); revalidatePath('/inventory');
}
async function deleteActual(formData) {
  'use server';
  requireAuth();
  const { error } = await db().from('sales_actuals').delete().eq('id', String(formData.get('id')));
  if (error) throw error;
  revalidatePath('/profit'); revalidatePath('/dashboard'); revalidatePath('/inventory');
}

function ScenarioCard({ title, item, selected }) {
  return <div className={`card ${selected ? 'selected-card' : ''}`}><div className="metric-label">{title}</div><div className={tone(item.projected.profitUSD)}>{money(item.projected.profitUSD)}</div><div className="muted">{money(item.projected.marginPerNT, 2)}/NT margin</div><div className="muted">{num(item.projected.unsoldInventoryNT)} NT unsold</div></div>;
}

export default async function Profit({ searchParams }) {
  requireAuth();
  const data = await loadProfitData();
  const profit = calculateProfitModel(data);
  const requested = String(searchParams?.scenario || 'expected').toLowerCase();
  const scenario = ['firm', 'expected', 'upside'].includes(requested) ? requested : 'expected';
  const selected = profit[scenario];
  const firstCustomer = data.customers[0] || {};
  const firstPlan = data.customerPlans.find(plan => plan.customer_id === firstCustomer.id) || data.customerPlans[0] || {};
  const defaultPrice = Number(firstPlan.sell_price_per_nt ?? firstCustomer.default_price_per_nt ?? 160);
  const today = new Date().toISOString().slice(0, 10);
  const actualRows = [...(data.salesActuals || [])].sort((a, b) => String(b.delivery_date).localeCompare(String(a.delivery_date)));
  const weeklyRows = selected.weeks.filter(week => week.plannedNT > 0 || week.actualNT > 0 || week.forecastRemainingNT > 0).slice(0, 80);

  return <Shell>
    <div className="top"><div><h1 className="title">Forecast vs. Actual Profit</h1><div className="muted">Actual deliveries replace the matching weekly customer forecast. They are never added on top of it.</div></div></div>
    {!profit.actualsReady && <div className="notice warn section">Run <b>supabase_v3_3_migration.sql</b> before entering actual invoices.</div>}

    <div className="scenario-tabs section"><Link className={`tab ${scenario === 'firm' ? 'active' : ''}`} href="/profit?scenario=firm">Firm</Link><Link className={`tab ${scenario === 'expected' ? 'active' : ''}`} href="/profit?scenario=expected">Expected</Link><Link className={`tab ${scenario === 'upside' ? 'active' : ''}`} href="/profit?scenario=upside">Upside</Link></div>

    <div className="grid section">
      <div className="card"><div className="metric-label">Actual delivered</div><div className="metric">{num(selected.actual.volumeNT)} NT</div></div>
      <div className="card"><div className="metric-label">Actual revenue</div><div className="metric">{money(selected.actual.revenueUSD)}</div></div>
      <div className="card"><div className="metric-label">Realized profit to date</div><div className={tone(selected.actual.profitUSD)}>{money(selected.actual.profitUSD)}</div></div>
      <div className="card"><div className="metric-label">Forecast profit remaining</div><div className={tone(selected.remaining.profitUSD)}>{money(selected.remaining.profitUSD)}</div></div>
      <div className="card"><div className="metric-label">Projected final profit</div><div className={tone(selected.projected.profitUSD)}>{money(selected.projected.profitUSD)}</div></div>
      <div className="card"><div className="metric-label">Projected margin / NT</div><div className={tone(selected.projected.marginPerNT)}>{money(selected.projected.marginPerNT, 2)}</div></div>
    </div>

    <div className="three section"><ScenarioCard title="Firm projected profit" item={profit.firm} selected={scenario === 'firm'}/><ScenarioCard title="Expected projected profit" item={profit.expected} selected={scenario === 'expected'}/><ScenarioCard title="Upside projected profit" item={profit.upside} selected={scenario === 'upside'}/></div>

    <div className="grid section">
      <div className="card"><div className="metric-label">Plan profit before actuals</div><div className={tone(selected.plan.profitUSD)}>{money(selected.plan.profitUSD)}</div></div>
      <div className="card"><div className="metric-label">Projected profit variance</div><div className={tone(selected.variance.projectedProfitUSD)}>{money(selected.variance.projectedProfitUSD)}</div></div>
      <div className="card"><div className="metric-label">Projected revenue</div><div className="metric">{money(selected.projected.revenueUSD)}</div></div>
      <div className="card"><div className="metric-label">Projected total cost / NT</div><div className="metric">{money(selected.projected.totalCostPerNT, 2)}</div></div>
      <div className="card"><div className="metric-label">Projected unsold inventory</div><div className="metric">{num(selected.projected.unsoldInventoryNT)} NT</div></div>
      <div className="card"><div className="metric-label">Unsold cost exposure</div><div className="metric">{money(selected.projected.unsoldInventoryCostExposureUSD)}</div></div>
    </div>

    {profit.actualsReady && <form action={addActual} className="form section">
      <input type="hidden" name="market_id" value={data.market.id}/><input type="hidden" name="cargo_id" value={data.cargo?.id || ''}/>
      <h2>Post actual delivery / invoice</h2><div className="muted">Manual entry works now; External Import Key is reserved for the future automated invoice feed.</div>
      <div className="form-grid" style={{marginTop:14}}>
        <div className="field"><label>Customer</label><select name="customer_id" required defaultValue={firstCustomer.id || ''}>{data.customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></div>
        <div className="field"><label>Delivery date</label><input name="delivery_date" type="date" defaultValue={today} required/></div>
        <div className="field"><label>Invoice date</label><input name="invoice_date" type="date" defaultValue={today}/></div>
        <div className="field"><label>Invoice / delivery number</label><input name="invoice_number"/></div>
        <div className="field"><label>Delivered volume (NT)</label><input name="delivered_nt" type="number" min="0.001" step="0.001" required/></div>
        <div className="field"><label>Unit price ($/NT)</label><input name="unit_price_per_nt" type="number" min="0" step="0.01" defaultValue={defaultPrice} required/></div>
        <div className="field"><label>Invoice amount ($, optional override)</label><input name="invoice_amount_usd" type="number" min="0" step="0.01"/></div>
        <div className="field"><label>Payment terms snapshot (days)</label><input name="payment_terms_days" type="number" min="0" step="1" defaultValue={firstCustomer.payment_terms_days || 0}/></div>
        <div className="field"><label>External Import Key</label><input name="external_key"/></div>
        <div className="field wide"><label>Notes</label><input name="notes"/></div>
      </div><div style={{marginTop:16}}><button className="btn">Post actual delivery</button></div>
    </form>}

    <div className="section"><h2>Posted actual deliveries</h2><div className="table-wrap"><table className="table"><thead><tr><th>Delivery</th><th>Customer</th><th>Invoice</th><th>Volume</th><th>Unit Price</th><th>Revenue</th><th></th></tr></thead><tbody>
      {actualRows.length === 0 && <tr><td colSpan="7" className="muted">No actual deliveries have been posted.</td></tr>}
      {actualRows.map(row => <tr key={row.id}><td>{date(row.delivery_date)}</td><td><b>{row.customers?.name || 'Customer'}</b></td><td>{row.invoice_number || '—'}</td><td>{num(row.delivered_nt, 3)} NT</td><td>{money(row.unit_price_per_nt, 2)}</td><td>{money(row.invoice_amount_usd ?? Number(row.delivered_nt || 0) * Number(row.unit_price_per_nt || 0), 2)}</td><td className="actions"><Link className="btn tiny" href={`/profit/${row.id}`}>Edit</Link><form action={deleteActual}><input type="hidden" name="id" value={row.id}/><button className="btn secondary tiny">Delete</button></form></td></tr>)}
    </tbody></table></div></div>

    <div className="section"><h2>{scenario.charAt(0).toUpperCase() + scenario.slice(1)} weekly profit bridge</h2><div className="table-wrap"><table className="table"><thead><tr><th>Week</th><th>Start</th><th>Plan</th><th>Actual</th><th>Forecast Remaining</th><th>Projected Sales</th><th>Actual Revenue</th><th>Projected Week Profit</th><th>Ending Inventory</th></tr></thead><tbody>
      {weeklyRows.map(row => <tr key={`${row.week}-${row.weekStart.toISOString()}`}><td>{row.week}</td><td>{date(row.weekStart)}</td><td>{num(row.plannedNT)} NT</td><td>{num(row.actualNT)} NT</td><td>{num(row.forecastRemainingNT)} NT</td><td>{num(row.projectedTotalNT)} NT</td><td>{money(row.actualRevenueUSD)}</td><td className={row.projectedProfitUSD < 0 ? 'negative' : ''}>{money(row.projectedProfitUSD)}</td><td>{num(row.endingInventoryNT)} NT</td></tr>)}
    </tbody></table></div></div>

    <div className="notice section"><b>Management-profit logic:</b> actual invoice revenue less modeled landed cost allocated to delivered tons, estimated A/R financing, and storage accrued through today. Remaining profit uses customer-specific prices, payment terms, probability, and weekly volume.</div>
  </Shell>;
}
