import Link from 'next/link';
import { requireAuth } from '../../lib/auth';
import { calculateInventoryForecast } from '../../lib/db';
import { loadProfitData, calculateProfitModel } from '../../lib/profit';
import Shell from '../_shell';

function money(value, digits = 0) {
  return Number(value || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function num(value) { return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 }); }
function date(value) { return value ? new Date(value).toLocaleDateString() : '—'; }
function tone(value) { return Number(value || 0) < 0 ? 'metric negative' : 'metric'; }

function Scenario({ title, profitCase, inventoryCase }) {
  return <div className="card">
    <h2>{title}</h2>
    <p><b>Projected profit:</b> <span className={profitCase.projected.profitUSD < 0 ? 'negative' : ''}>{money(profitCase.projected.profitUSD)}</span></p>
    <p><b>Projected margin:</b> {money(profitCase.projected.marginPerNT, 2)}/NT</p>
    <p><b>Forecast sales remaining:</b> {num(profitCase.remaining.volumeNT)} NT</p>
    <p><b>Projected unsold inventory:</b> {num(profitCase.projected.unsoldInventoryNT)} NT</p>
    <p><b>Stockout:</b> {date(inventoryCase.stockoutDate)}</p>
    <p><b>Latest reorder date:</b> {date(inventoryCase.reorderDeadline)}</p>
  </div>;
}

export default async function Dashboard() {
  requireAuth();
  const data = await loadProfitData();
  const inventory = calculateInventoryForecast(data);
  const profit = calculateProfitModel(data);
  const expected = profit.expected;
  const annualDemand = data.customerPlans.reduce((sum, plan) => sum + Number(plan.customers?.annual_demand_nt || 0), 0);

  return <Shell>
    <div className="top">
      <div><h1 className="title">Toledo Executive Dashboard</h1><div className="muted">Live actual profit + customer forecast + inventory and Cargo #2 signals</div></div>
      <Link href="/profit" className="btn">Open profit detail</Link>
    </div>

    {!profit.actualsReady && <div className="notice warn section">Run <b>supabase_v3_3_migration.sql</b> to activate actual-invoice tracking. Forecast calculations remain available.</div>}

    <div className="grid section">
      <div className="card"><div className="metric-label">Actual delivered</div><div className="metric">{num(expected.actual.volumeNT)} NT</div></div>
      <div className="card"><div className="metric-label">Actual revenue</div><div className="metric">{money(expected.actual.revenueUSD)}</div></div>
      <div className="card"><div className="metric-label">Realized profit to date</div><div className={tone(expected.actual.profitUSD)}>{money(expected.actual.profitUSD)}</div></div>
      <div className="card"><div className="metric-label">Expected profit remaining</div><div className={tone(expected.remaining.profitUSD)}>{money(expected.remaining.profitUSD)}</div></div>
      <div className="card"><div className="metric-label">Expected final profit</div><div className={tone(expected.projected.profitUSD)}>{money(expected.projected.profitUSD)}</div></div>
      <div className="card"><div className="metric-label">Expected margin / NT</div><div className={tone(expected.projected.marginPerNT)}>{money(expected.projected.marginPerNT, 2)}</div></div>
    </div>

    <div className="three section">
      <Scenario title="Firm case" profitCase={profit.firm} inventoryCase={inventory.firm}/>
      <Scenario title="Expected case" profitCase={profit.expected} inventoryCase={inventory.expected}/>
      <Scenario title="Upside case" profitCase={profit.upside} inventoryCase={inventory.upside}/>
    </div>

    <div className="grid section">
      <div className="card"><div className="metric-label">Current inventory</div><div className="metric">{num(profit.currentInventoryNT)} NT</div></div>
      <div className="card"><div className="metric-label">Expected weekly demand</div><div className="metric">{num(inventory.expected.activeWeeklyDemand)} NT</div></div>
      <div className="card"><div className="metric-label">Expected weeks of supply</div><div className="metric">{inventory.expected.activeWeeklyDemand ? (profit.currentInventoryNT / inventory.expected.activeWeeklyDemand).toFixed(1) : '—'}</div></div>
      <div className="card"><div className="metric-label">AGEMA target pipeline</div><div className="metric">{num(inventory.totalTarget)} NT</div></div>
      <div className="card"><div className="metric-label">Probability-weighted target</div><div className="metric">{num(inventory.totalWeightedTarget)} NT</div></div>
      <div className="card"><div className="metric-label">Cargo #2 lead time</div><div className="metric">{inventory.leadTimeComponents.totalDays} d</div></div>
    </div>

    <div className="two section">
      <div className="card"><h2>Sales & inventory coverage</h2><p><b>Annual customer demand:</b> {num(annualDemand)} NT</p><p><b>AGEMA target:</b> {num(inventory.totalTarget)} NT</p><p><b>Probability-weighted target:</b> {num(inventory.totalWeightedTarget)} NT</p><p><b>Original saleable cargo:</b> {num(profit.cargoQtyNT)} NT</p><p><b>Actual delivered:</b> {num(profit.actualDeliveredNT)} NT</p><p><b>Current inventory:</b> {num(profit.currentInventoryNT)} NT</p></div>
      <div className="card"><h2>Expected economics</h2><table className="table"><tbody><tr><td>Base cargo + Toledo terminal</td><td>{money(profit.baseCostPerNT, 2)}/NT</td></tr><tr><td>Projected total cost</td><td>{money(expected.projected.totalCostPerNT, 2)}/NT</td></tr><tr><td>Projected average sell price</td><td>{money(expected.projected.averageSellPricePerNT, 2)}/NT</td></tr><tr><th>Projected margin</th><th>{money(expected.projected.marginPerNT, 2)}/NT</th></tr></tbody></table><p><b>SOFR:</b> {profit.sofrPct.toFixed(2)}% ({profit.sofrDate || '—'})</p><p><b>Bank rate:</b> {profit.borrowingRatePct.toFixed(2)}%</p></div>
    </div>

    {inventory.expected.reorderDeadline && <div className="notice section">Expected case: target Cargo #2 in Toledo by <b>{date(inventory.expected.targetArrivalDate)}</b>; latest modeled order / nomination date is <b>{date(inventory.expected.reorderDeadline)}</b>.</div>}
    <div className="notice section">Actual rows replace matching weekly forecast volume rather than being added on top. Realized profit uses actual revenue, modeled landed cost, estimated A/R financing, and accrued storage.</div>
  </Shell>;
}
