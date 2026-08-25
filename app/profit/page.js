import Link from 'next/link';
import { requireAuth } from '../../lib/auth';
import { loadSalesPipeline } from '../../lib/db';
import { calculateProfitForecast } from '../../lib/profit';
import Shell from '../_shell';

function money(value, digits = 0) {
  return Number(value || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: digits });
}

function money2(value) {
  return money(value, 2);
}

function num(value, digits = 0) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function date(value) {
  if (!value) return '-';
  const d = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString();
}

function ProfitValue({ value }) {
  return <span className={Number(value || 0) >= 0 ? 'positive-text' : 'negative-text'}>{money(value)}</span>;
}

function ScenarioCard({ scenario }) {
  const profitLabel = scenario.isFullySold ? 'Projected cargo profit' : 'Profit on modeled sales';
  return <div className="card scenario-card">
    <div className="scenario-heading"><h2>{scenario.label} case</h2><span className={scenario.isFullySold ? 'pill good-pill' : 'pill warning-pill'}>{scenario.isFullySold ? 'Cargo sold out' : `${num(scenario.endingInventoryNT)} NT unsold`}</span></div>
    <div className="metric-label">{profitLabel}</div>
    <div className={`metric ${scenario.projectedProfitUSD >= 0 ? 'positive-text' : 'negative-text'}`}>{money(scenario.projectedProfitUSD)}</div>
    <div className="mini-grid">
      <div><span>Projected volume</span><b>{num(scenario.projectedVolumeNT)} NT</b></div>
      <div><span>Margin / NT</span><b>{money2(scenario.projectedMarginPerNT)}</b></div>
      <div><span>Average price</span><b>{money2(scenario.projectedAverageSellPricePerNT)}</b></div>
      <div><span>Sellout date</span><b>{date(scenario.selloutDate)}</b></div>
    </div>
  </div>;
}

export default async function ProfitControl() {
  requireAuth();
  const data = await loadSalesPipeline();
  const profit = calculateProfitForecast(data);
  const actual = profit.actual;
  const expected = profit.expected;
  const activeWeeks = expected.weeks.filter(week => week.actualVolumeNT > 0 || week.forecastVolumeNT > 0);

  return <Shell>
    <div className="top">
      <div>
        <h1 className="title">Forecast vs. Actual Profit Control</h1>
        <div className="muted">Actual delivery and invoice lines replace completed weekly forecasts. The current week uses entered actuals plus only the unfilled balance of the weekly plan, preventing double counting.</div>
      </div>
      <Link href="/actuals" className="btn">Add Deliveries / Invoices</Link>
    </div>

    {!data.salesActualsTableReady && <div className="notice warning section">Run <b>supabase_v4_migration.sql</b> in Supabase to activate the actual-delivery ledger.</div>}
    <div className="notice section">Profit on delivered tons uses actual entered volume and revenue, plus the current modeled landed cost, time-based MidWest storage, and SOFR-based A/R financing. Future profit uses customer-specific forecast price, throughput, probability, and payment terms.</div>

    <div className="grid section">
      <div className="card"><div className="metric-label">Actual delivered</div><div className="metric">{num(actual.volumeNT)} NT</div></div>
      <div className="card"><div className="metric-label">Physical inventory now</div><div className={`metric ${actual.currentInventoryNT < 0 ? 'negative-text' : ''}`}>{num(actual.currentInventoryNT)} NT</div></div>
      <div className="card"><div className="metric-label">Actual entered revenue</div><div className="metric">{money(actual.revenueUSD)}</div></div>
      <div className="card"><div className="metric-label">Profit on delivered tons</div><div className={`metric ${actual.profitExpectedUSD >= 0 ? 'positive-text' : 'negative-text'}`}>{money(actual.profitExpectedUSD)}</div></div>
      <div className="card"><div className="metric-label">Expected projected profit</div><div className={`metric ${expected.projectedProfitUSD >= 0 ? 'positive-text' : 'negative-text'}`}>{money(expected.projectedProfitUSD)}</div></div>
      <div className="card"><div className="metric-label">Expected margin / NT</div><div className={`metric ${expected.projectedMarginPerNT >= 0 ? 'positive-text' : 'negative-text'}`}>{money2(expected.projectedMarginPerNT)}</div></div>
    </div>

    {actual.inventoryOverdrawNT > 0 && <div className="notice danger section">Entered deliveries exceed the current saleable cargo quantity by <b>{num(actual.inventoryOverdrawNT)} NT</b>. Check the cargo quantity or imported invoice lines.</div>}
    {!actual.recordCount && <div className="notice section">No actual deliveries have been entered. All projected profit currently comes from the sales forecast.</div>}

    <div className="three section">
      <ScenarioCard scenario={profit.firm}/>
      <ScenarioCard scenario={profit.expected}/>
      <ScenarioCard scenario={profit.upside}/>
    </div>

    <div className="two section">
      <div className="card">
        <h2>Delivered tons - current profit estimate</h2>
        <table className="table"><tbody>
          <tr><td>Entered revenue</td><td>{money(actual.revenueUSD)}</td></tr>
          <tr><td>Modeled landed cost allocated to deliveries</td><td>{money(actual.baseCostUSD)}</td></tr>
          <tr><td>Storage through delivery dates</td><td>{money(actual.storageCostUSD)}</td></tr>
          <tr><td>Expected A/R financing through payment</td><td>{money(actual.financeCostExpectedUSD)}</td></tr>
          <tr><th>Estimated profit on delivered tons</th><th><ProfitValue value={actual.profitExpectedUSD}/></th></tr>
          <tr><td>Average actual sell price</td><td>{money2(actual.averageSellPricePerNT)}/NT</td></tr>
          <tr><td>Average actual margin</td><td>{money2(actual.marginPerNT)}/NT</td></tr>
        </tbody></table>
      </div>

      <div className="card">
        <h2>Expected remaining forecast</h2>
        <table className="table"><tbody>
          <tr><td>Forecast remaining volume</td><td>{num(expected.forecastVolumeNT)} NT</td></tr>
          <tr><td>Forecast revenue</td><td>{money(expected.forecastRevenueUSD)}</td></tr>
          <tr><td>Forecast landed cost</td><td>{money(expected.forecastBaseCostUSD)}</td></tr>
          <tr><td>Forecast storage</td><td>{money(expected.forecastStorageCostUSD)}</td></tr>
          <tr><td>Forecast A/R financing</td><td>{money(expected.forecastFinanceCostUSD)}</td></tr>
          <tr><th>Forecast remaining profit</th><th><ProfitValue value={expected.forecastProfitUSD}/></th></tr>
          <tr><td>Inventory left after forecast</td><td>{num(expected.endingInventoryNT)} NT</td></tr>
          <tr><td>Unmodeled inventory value</td><td>{money(expected.inventoryValueRemainingUSD)}</td></tr>
        </tbody></table>
      </div>
    </div>

    <div className="section">
      <div className="section-heading"><div><h2>Expected weekly profit bridge</h2><div className="muted">Past weeks show actuals only. In the current week, actual tons displace planned tons before the remaining forecast is calculated.</div></div></div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Week</th><th>Actual NT</th><th>Forecast NT</th><th>Total NT</th><th>Revenue</th><th>Cost</th><th>Profit</th><th>Ending inventory</th><th>Customer detail</th></tr></thead>
        <tbody>
          {activeWeeks.slice(0, 100).map(week => <tr key={week.weekStart.toISOString()} className={week.isCurrentWeek ? 'current-row' : ''}>
            <td>{date(week.weekStart)}{week.isCurrentWeek ? <div className="muted">Current week</div> : null}</td>
            <td>{num(week.actualVolumeNT)} NT</td>
            <td>{num(week.forecastVolumeNT)} NT</td>
            <td><b>{num(week.projectedVolumeNT)} NT</b></td>
            <td>{money(week.projectedRevenueUSD)}</td>
            <td>{money(week.projectedCostUSD)}</td>
            <td className={week.projectedProfitUSD >= 0 ? 'positive-text' : 'negative-text'}>{money(week.projectedProfitUSD)}</td>
            <td>{num(week.endingInventoryNT)} NT</td>
            <td>{[
              ...week.actualDetails.map(item => `${item.customerName}: ${num(item.volumeNT)} actual`),
              ...week.forecastDetails.map(item => `${item.customerName}: ${num(item.volumeNT)} forecast`)
            ].join(' | ') || '-'}</td>
          </tr>)}
          {!activeWeeks.length && <tr><td colSpan="9" className="muted">No actual or forecast weekly sales are currently modeled.</td></tr>}
        </tbody>
      </table></div>
    </div>

    <div className="section">
      <h2>Expected customer contribution</h2>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Customer</th><th>Actual NT</th><th>Forecast NT</th><th>Projected NT</th><th>Projected revenue</th><th>Projected cost</th><th>Projected profit</th><th>Margin / NT</th></tr></thead>
        <tbody>
          {expected.customerSummary.map(customer => <tr key={customer.customerId}>
            <td><b>{customer.customerName}</b></td>
            <td>{num(customer.actualVolumeNT)} NT</td>
            <td>{num(customer.forecastVolumeNT)} NT</td>
            <td>{num(customer.projectedVolumeNT)} NT</td>
            <td>{money(customer.projectedRevenueUSD)}</td>
            <td>{money(customer.projectedCostUSD)}</td>
            <td className={customer.projectedProfitUSD >= 0 ? 'positive-text' : 'negative-text'}>{money(customer.projectedProfitUSD)}</td>
            <td>{money2(customer.projectedVolumeNT > 0 ? customer.projectedProfitUSD / customer.projectedVolumeNT : 0)}</td>
          </tr>)}
          {!expected.customerSummary.length && <tr><td colSpan="8" className="muted">No customer profit contribution is currently modeled.</td></tr>}
        </tbody>
      </table></div>
    </div>

    <div className="card section">
      <h2>Model basis</h2>
      <div className="mini-grid four">
        <div><span>Base landed cost</span><b>{money2(profit.assumptions.baseCostPerNT)}/NT</b></div>
        <div><span>Storage rate</span><b>{money2(profit.assumptions.storageRatePerNTDay)}/NT/day</b></div>
        <div><span>Borrowing rate</span><b>{profit.assumptions.borrowingRatePct.toFixed(2)}%</b></div>
        <div><span>As of</span><b>{date(profit.asOfDate)}</b></div>
      </div>
    </div>
  </Shell>;
}
