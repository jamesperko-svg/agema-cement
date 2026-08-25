import { revalidatePath } from 'next/cache';
import { requireAuth } from '../../lib/auth';
import { db, loadSalesPipeline, calculateInventoryForecast } from '../../lib/db';
import Shell from '../_shell';

function num(v){return Number(v||0).toLocaleString(undefined,{maximumFractionDigits:0})}
function date(v){return v?new Date(v).toLocaleDateString():'-'}

async function saveSettings(formData){
  'use server';
  requireAuth();
  const s=db();
  const pieces={
    supplier_preparation_days:Number(formData.get('supplier_preparation_days')||0),
    vessel_nomination_days:Number(formData.get('vessel_nomination_days')||0),
    load_port_days:Number(formData.get('load_port_days')||0),
    sailing_days:Number(formData.get('sailing_days')||0),
    discharge_availability_days:Number(formData.get('discharge_availability_days')||0),
    contingency_days:Number(formData.get('contingency_days')||0)
  };
  const payload={
    market_id:String(formData.get('market_id')),
    ...pieces,
    reorder_lead_days:Object.values(pieces).reduce((s,v)=>s+v,0),
    safety_stock_days:Number(formData.get('safety_stock_days')||0),
    next_cargo_size_nt:Number(formData.get('next_cargo_size_nt')||0),
    updated_at:new Date().toISOString()
  };
  const {error}=await s.from('market_settings').upsert(payload,{onConflict:'market_id'});
  if(error)throw error;
  revalidatePath('/inventory');
  revalidatePath('/dashboard');
}

function CaseCards({label,c}){
  return <>
    <div className="card"><div className="metric-label">{label} weekly demand</div><div className="metric">{num(c.activeWeeklyDemand)} NT</div></div>
    <div className="card"><div className="metric-label">{label} weeks of supply</div><div className="metric">{c.weeksOfSupply?c.weeksOfSupply.toFixed(1):'—'}</div></div>
    <div className="card"><div className="metric-label">{label} stockout</div><div className="metric small">{date(c.stockoutDate)}</div></div>
  </>
}

function CaseSummary({title,c,tone='notice'}){
  return <div className="card">
    <h2>{title}</h2>
    <p><b>Weekly demand:</b> {num(c.activeWeeklyDemand)} NT</p>
    <p><b>Safety stock:</b> {num(c.safetyStockNT)} NT</p>
    <p><b>Projected stockout:</b> {date(c.stockoutDate)}</p>
    <p><b>Target Cargo #2 arrival:</b> {date(c.targetArrivalDate)}</p>
    <p><b>Latest reorder / nomination date:</b> {date(c.reorderDeadline)}</p>
    {c.reorderDeadline
      ? <div className={tone}>Plan to commit Cargo #2 by <b>{date(c.reorderDeadline)}</b>.</div>
      : <div className="notice">No stockout is projected under this case.</div>}
  </div>
}

function ForecastTable({title,c,label}){
  return <div><h2>{title}</h2><div className="table-wrap"><table className="table"><thead><tr><th>Week</th><th>Start</th><th>{label}</th><th>Ending inventory</th><th>Customer detail</th></tr></thead><tbody>
    {c.weeks.slice(0,60).map(w=><tr key={w.week}><td>{w.week}</td><td>{date(w.weekStart)}</td><td>{num(w.planned_nt)}</td><td>{num(w.ending_inventory_nt)}</td><td>{w.details.filter(d=>d.case_nt>0).map(d=>`${d.customer}: ${num(d.case_nt)} NT${d.actual?' actual':d.ongoing?' forecast ongoing':' forecast'}`).join(' | ')||'-'}</td></tr>)}
  </tbody></table></div></div>
}

export default async function Inventory(){
  requireAuth();
  const data=await loadSalesPipeline();
  const f=calculateInventoryForecast(data);
  const settings=data.marketSettings||{};
  const lt=f.leadTimeComponents;
  return <Shell>
    <div className="top"><div><h1 className="title">Toledo Inventory & Reorder Forecast</h1><div className="muted">Actual deliveries replace completed weekly forecasts. Firm = committed/active customers, Expected = probability-adjusted pipeline, and Upside = full planned throughput.</div></div></div>

    <div className="grid">
      <div className="card"><div className="metric-label">Original saleable cargo</div><div className="metric">{num(f.qty)} NT</div></div>
      <div className="card"><div className="metric-label">Actual delivered</div><div className="metric">{num(f.actualDeliveredNT)} NT</div></div>
      <div className="card"><div className="metric-label">Physical inventory now</div><div className={`metric ${f.currentInventoryNT<0?'negative-text':''}`}>{num(f.currentInventoryNT)} NT</div></div>
      <CaseCards label="Firm" c={f.firm}/>
      <CaseCards label="Expected" c={f.expected}/>
      <CaseCards label="Upside" c={f.upside}/>
    </div>

    <form action={saveSettings} className="form section">
      <input type="hidden" name="market_id" value={data.market.id}/>
      <h2>Cargo #2 lead-time assumptions</h2>
      <div className="muted">Each component is editable. Total lead time is calculated automatically and used to determine the latest reorder / vessel nomination date.</div>
      <div className="form-grid" style={{marginTop:14}}>
        <div className="field"><label>Supplier preparation / order / LC (days)</label><input name="supplier_preparation_days" type="number" min="0" defaultValue={settings.supplier_preparation_days??7}/></div>
        <div className="field"><label>Vessel nomination / laycan (days)</label><input name="vessel_nomination_days" type="number" min="0" defaultValue={settings.vessel_nomination_days??7}/></div>
        <div className="field"><label>Port Said loading allowance (days)</label><input name="load_port_days" type="number" min="0" defaultValue={settings.load_port_days??6}/></div>
        <div className="field"><label>Port Said → Toledo sailing (days)</label><input name="sailing_days" type="number" min="0" defaultValue={settings.sailing_days??21}/></div>
        <div className="field"><label>Toledo discharge → available (days)</label><input name="discharge_availability_days" type="number" min="0" defaultValue={settings.discharge_availability_days??7}/></div>
        <div className="field"><label>Contingency (days)</label><input name="contingency_days" type="number" min="0" defaultValue={settings.contingency_days??3}/></div>
        <div className="field"><label>Safety stock (days)</label><input name="safety_stock_days" type="number" min="0" defaultValue={settings.safety_stock_days??7}/></div>
        <div className="field"><label>Next cargo size (NT)</label><input name="next_cargo_size_nt" type="number" step="1" defaultValue={settings.next_cargo_size_nt||20519.24}/></div>
        <div className="card compact"><div className="metric-label">Calculated total lead time</div><div className="metric">{lt.totalDays} days</div></div>
      </div>
      <div style={{marginTop:16}}><button className="btn">Save reorder assumptions</button></div>
    </form>

    <div className="three section">
      <CaseSummary title="Firm case" c={f.firm} tone="notice good"/>
      <CaseSummary title="Expected case" c={f.expected}/>
      <CaseSummary title="Upside case" c={f.upside}/>
    </div>

    <div className="card section">
      <h2>Lead-time bridge</h2>
      <table className="table"><tbody>
        <tr><td>Supplier preparation / order / LC</td><td>{lt.supplierPreparationDays} days</td></tr>
        <tr><td>Vessel nomination / laycan</td><td>{lt.vesselNominationDays} days</td></tr>
        <tr><td>Port Said loading</td><td>{lt.loadPortDays} days</td></tr>
        <tr><td>Sailing</td><td>{lt.sailingDays} days</td></tr>
        <tr><td>Toledo discharge / availability</td><td>{lt.dischargeAvailabilityDays} days</td></tr>
        <tr><td>Contingency</td><td>{lt.contingencyDays} days</td></tr>
        <tr><th>Total procurement / logistics lead time</th><th>{lt.totalDays} days</th></tr>
      </tbody></table>
    </div>

    <div className="section"><ForecastTable title="Firm weekly inventory" c={f.firm} label="Firm demand"/></div>
    <div className="section"><ForecastTable title="Expected weekly inventory" c={f.expected} label="Expected demand"/></div>
    <div className="section"><ForecastTable title="Upside weekly inventory" c={f.upside} label="Upside demand"/></div>
  </Shell>
}
