import { revalidatePath } from 'next/cache';
import { requireAuth } from '../../lib/auth';
import { db, loadSalesPipeline, calculateInventoryForecast } from '../../lib/db';
import Shell from '../_shell';
function num(v){return Number(v||0).toLocaleString(undefined,{maximumFractionDigits:0})}
function date(v){return v?new Date(v).toLocaleDateString():'—'}
async function saveSettings(formData){'use server';requireAuth();const s=db();const payload={market_id:String(formData.get('market_id')),reorder_lead_days:Number(formData.get('reorder_lead_days')),safety_stock_days:Number(formData.get('safety_stock_days')),next_cargo_size_nt:Number(formData.get('next_cargo_size_nt')),updated_at:new Date().toISOString()};const {error}=await s.from('market_settings').upsert(payload,{onConflict:'market_id'});if(error)throw error;revalidatePath('/inventory');revalidatePath('/dashboard')}
function CaseCards({label,c}){return <><div className="card"><div className="metric-label">{label} weekly demand</div><div className="metric">{num(c.activeWeeklyDemand)} NT</div></div><div className="card"><div className="metric-label">{label} weeks of supply</div><div className="metric">{c.weeksOfSupply?c.weeksOfSupply.toFixed(1):'—'}</div></div><div className="card"><div className="metric-label">{label} stockout</div><div className="metric small">{date(c.stockoutDate)}</div></div></>}
export default async function Inventory(){
  requireAuth(); const data=await loadSalesPipeline(); const f=calculateInventoryForecast(data); const settings=data.marketSettings||{};
  return <Shell>
    <div className="top"><div><h1 className="title">Toledo Inventory & Reorder Forecast</h1><div className="muted">Committed and probability-weighted cases are shown separately. Probability changes sales forecasting; it does not create fractional physical truckloads in the committed case.</div></div></div>
    <div className="grid"><div className="card"><div className="metric-label">Saleable cargo</div><div className="metric">{num(f.qty)} NT</div></div><CaseCards label="Committed" c={f.committed}/><CaseCards label="Weighted" c={f.weighted}/></div>

    <form action={saveSettings} className="form section"><input type="hidden" name="market_id" value={data.market.id}/><h2>Reorder assumptions</h2><div className="form-grid"><div className="field"><label>Total procurement / sailing lead time (days)</label><input name="reorder_lead_days" type="number" defaultValue={settings.reorder_lead_days||35}/></div><div className="field"><label>Safety stock (days)</label><input name="safety_stock_days" type="number" defaultValue={settings.safety_stock_days||7}/></div><div className="field"><label>Next cargo size (NT)</label><input name="next_cargo_size_nt" type="number" step="1" defaultValue={settings.next_cargo_size_nt||20519.24}/></div></div><div style={{marginTop:16}}><button className="btn">Save reorder assumptions</button></div></form>

    <div className="two section">
      <div className="card"><h2>Committed case</h2><p><b>Committed / active target tons:</b> {num(f.totalCommittedTarget)} NT</p><p><b>Safety stock:</b> {num(f.committed.safetyStockNT)} NT</p><p><b>Target Cargo #2 arrival:</b> {date(f.committed.targetArrivalDate)}</p><p><b>Reorder deadline:</b> {date(f.committed.reorderDeadline)}</p>{f.committed.reorderDeadline?<div className="notice good">Based only on customers marked Committed or Active, order / nominate by <b>{date(f.committed.reorderDeadline)}</b>.</div>:<div className="notice">No committed-case stockout is projected.</div>}</div>
      <div className="card"><h2>Probability-weighted case</h2><p><b>Total AGEMA target:</b> {num(f.totalTarget)} NT</p><p><b>Probability-weighted target:</b> {num(f.totalWeightedTarget)} NT</p><p><b>Target Cargo #2 arrival:</b> {date(f.weighted.targetArrivalDate)}</p><p><b>Reorder deadline:</b> {date(f.weighted.reorderDeadline)}</p>{f.weighted.reorderDeadline?<div className="notice">Probability-weighted planning suggests order / nomination by <b>{date(f.weighted.reorderDeadline)}</b>.</div>:<div className="notice">No probability-weighted stockout is projected under current plan dates.</div>}</div>
    </div>

    <div className="two section">
      <div><h2>Committed weekly inventory</h2><div className="table-wrap"><table className="table"><thead><tr><th>Week</th><th>Start</th><th>Planned</th><th>Ending inventory</th><th>Customer detail</th></tr></thead><tbody>{f.committed.weeks.slice(0,52).map(w=><tr key={w.week}><td>{w.week}</td><td>{date(w.weekStart)}</td><td>{num(w.planned_nt)}</td><td>{num(w.ending_inventory_nt)}</td><td>{w.details.filter(d=>d.case_nt>0).map(d=>`${d.customer}: ${num(d.case_nt)} NT`).join(' · ')||'—'}</td></tr>)}</tbody></table></div></div>
      <div><h2>Probability-weighted weekly inventory</h2><div className="table-wrap"><table className="table"><thead><tr><th>Week</th><th>Start</th><th>Weighted demand</th><th>Ending inventory</th><th>Customer detail</th></tr></thead><tbody>{f.weighted.weeks.slice(0,52).map(w=><tr key={w.week}><td>{w.week}</td><td>{date(w.weekStart)}</td><td>{num(w.planned_nt)}</td><td>{num(w.ending_inventory_nt)}</td><td>{w.details.filter(d=>d.case_nt>0).map(d=>`${d.customer}: ${num(d.case_nt)} NT`).join(' · ')||'—'}</td></tr>)}</tbody></table></div></div>
    </div>
  </Shell>
}
