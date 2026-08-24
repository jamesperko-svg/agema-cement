import { requireAuth } from '../../lib/auth';
import { loadSalesPipeline, calculateModel, calculateInventoryForecast } from '../../lib/db';
import Shell from '../_shell';
function money(v){return `$${Number(v||0).toFixed(2)}`}
function num(v){return Number(v||0).toLocaleString(undefined,{maximumFractionDigits:0})}
function date(v){return v?new Date(v).toLocaleDateString():'—'}

function Scenario({title,c}){
  return <div className="card"><h2>{title}</h2><p><b>Weekly demand:</b> {num(c.activeWeeklyDemand)} NT</p><p><b>Weeks of supply:</b> {c.weeksOfSupply?c.weeksOfSupply.toFixed(1):'—'}</p><p><b>Stockout:</b> {date(c.stockoutDate)}</p><p><b>Cargo #2 target arrival:</b> {date(c.targetArrivalDate)}</p><p><b>Latest reorder date:</b> {date(c.reorderDeadline)}</p></div>
}

export default async function Dashboard(){
  requireAuth();
  const data=await loadSalesPipeline();
  const m=calculateModel(data);
  const f=calculateInventoryForecast(data);
  const annualDemand=data.customerPlans.reduce((s,p)=>s+Number(p.customers?.annual_demand_nt||0),0);
  return <Shell>
    <div className="top"><div><h1 className="title">Toledo Executive Dashboard</h1><div className="muted">Cargo economics + sales pipeline + Firm / Expected / Upside inventory and reorder signals</div></div></div>
    <div className="grid">
      <div className="card"><div className="metric-label">Modeled Cost / NT</div><div className="metric">{money(m.modeledCost)}</div></div>
      <div className="card"><div className="metric-label">Reference Sell Price</div><div className="metric">{money(m.sellPrice)}</div></div>
      <div className="card"><div className="metric-label">Reference Margin / NT</div><div className="metric">{money(m.marginNT)}</div></div>
      <div className="card"><div className="metric-label">AGEMA target pipeline</div><div className="metric">{num(f.totalTarget)} NT</div></div>
      <div className="card"><div className="metric-label">Expected target</div><div className="metric">{num(f.totalWeightedTarget)} NT</div></div>
      <div className="card"><div className="metric-label">Lead time</div><div className="metric">{f.leadTimeComponents.totalDays} d</div></div>
    </div>

    <div className="three section">
      <Scenario title="Firm case" c={f.firm}/>
      <Scenario title="Expected case" c={f.expected}/>
      <Scenario title="Upside case" c={f.upside}/>
    </div>

    <div className="two section">
      <div className="card"><h2>Sales pipeline coverage</h2><p><b>Annual customer demand:</b> {num(annualDemand)} NT</p><p><b>AGEMA target:</b> {num(f.totalTarget)} NT</p><p><b>Probability-weighted target:</b> {num(f.totalWeightedTarget)} NT</p><p><b>Committed / active target:</b> {num(f.totalCommittedTarget)} NT</p><p><b>Current cargo:</b> {num(f.qty)} NT</p><div className="bar"><div style={{width:`${Math.min(100,f.qty?f.totalWeightedTarget/f.qty*100:0)}%`}}/></div></div>
      <div className="card"><h2>Cost & financing</h2><table className="table"><tbody><tr><td>Base cargo + Toledo terminal</td><td>{money(m.base)}/NT</td></tr><tr><td>Dynamic warehouse storage</td><td>{money(m.storageNT)}/NT</td></tr><tr><td>Available A/R financing</td><td>{money(m.arFinanceNT)}/NT</td></tr><tr><th>Modeled total</th><th>{money(m.modeledCost)}/NT</th></tr></tbody></table><p><b>SOFR:</b> {m.sofr.toFixed(2)}% ({m.sofrDate||'—'})</p><p><b>Bank rate:</b> {(m.sofr+m.spread).toFixed(2)}%</p></div>
    </div>

    {f.expected.reorderDeadline && <div className="notice section">Expected case: target Cargo #2 in Toledo by <b>{date(f.expected.targetArrivalDate)}</b>; latest modeled order / nomination date is <b>{date(f.expected.reorderDeadline)}</b>.</div>}
  </Shell>
}
