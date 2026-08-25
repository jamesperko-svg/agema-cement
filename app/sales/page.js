import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { requireAuth } from '../../lib/auth';
import { db, loadSalesPipeline } from '../../lib/db';
import Shell from '../_shell';

function money(v){return `$${Number(v||0).toFixed(2)}`}
function num(v){return Number(v||0).toLocaleString(undefined,{maximumFractionDigits:0})}

async function addCustomerPlan(formData){
  'use server'; requireAuth(); const s=db();
  const market_id=String(formData.get('market_id'));
  const customerName=String(formData.get('customer_name')).trim();
  let {data:customer,error}=await s.from('customers').select('*').eq('name',customerName).maybeSingle();
  if(error) throw error;
  const customerPayload={
    name:customerName,
    market_id,
    location:String(formData.get('location')||'Toledo area, OH'),
    status:String(formData.get('status')||'Prospect'),
    annual_demand_nt:Number(formData.get('annual_demand_nt')||0),
    default_price_per_nt:Number(formData.get('sell_price_per_nt')||0),
    payment_terms_days:Number(formData.get('payment_terms_days')||30),
    invoice_day:'Monday',
    active:true
  };
  if(!customer){
    const r=await s.from('customers').insert(customerPayload).select('*').single(); if(r.error)throw r.error; customer=r.data;
  } else {
    const r=await s.from('customers').update(customerPayload).eq('id',customer.id).select('*').single(); if(r.error)throw r.error; customer=r.data;
  }
  const plan={
    market_id,
    customer_id:customer.id,
    start_date:String(formData.get('start_date')),
    end_date:String(formData.get('end_date')||'')||null,
    target_volume_nt:Number(formData.get('target_volume_nt')||0),
    probability_pct:Number(formData.get('probability_pct')||0),
    trucks_per_day:Number(formData.get('trucks_per_day')||0),
    avg_nt_per_truck:Number(formData.get('avg_nt_per_truck')||38),
    operating_days_per_week:Number(formData.get('operating_days_per_week')||5),
    sell_price_per_nt:Number(formData.get('sell_price_per_nt')||0),
    notes:String(formData.get('notes')||''),
    forecast_ongoing:formData.get('forecast_ongoing')==='on',
    active:true
  };
  const pr=await s.from('customer_plans').insert(plan); if(pr.error) throw pr.error;
  revalidatePath('/sales'); revalidatePath('/inventory'); revalidatePath('/dashboard'); revalidatePath('/profit'); revalidatePath('/actuals');
}

async function deletePlan(formData){
  'use server'; requireAuth(); const s=db();
  const {error}=await s.from('customer_plans').delete().eq('id',String(formData.get('id')));
  if(error)throw error;
  revalidatePath('/sales'); revalidatePath('/inventory'); revalidatePath('/dashboard'); revalidatePath('/profit'); revalidatePath('/actuals');
}

export default async function Sales(){
  requireAuth(); const data=await loadSalesPipeline();
  const uniqueCustomers=new Map(); data.customerPlans.forEach(p=>{if(p.customers?.id)uniqueCustomers.set(String(p.customers.id),p.customers)});
  const annualDemand=Array.from(uniqueCustomers.values()).reduce((s,c)=>s+Number(c.annual_demand_nt||0),0);
  const totalTarget=data.customerPlans.reduce((s,p)=>s+Number(p.target_volume_nt||0),0);
  const weighted=data.customerPlans.reduce((s,p)=>s+Number(p.target_volume_nt||0)*Number(p.probability_pct??100)/100,0);
  return <Shell>
    <div className="top"><div><h1 className="title">Toledo Sales Pipeline</h1><div className="muted">Annual customer demand, AGEMA target share, pricing, probability and physical throughput are tracked separately.</div></div></div>
    <div className="grid">
      <div className="card"><div className="metric-label">Customers / plans</div><div className="metric">{data.customerPlans.length}</div></div>
      <div className="card"><div className="metric-label">Annual customer demand</div><div className="metric">{num(annualDemand)} NT</div></div>
      <div className="card"><div className="metric-label">AGEMA target pipeline</div><div className="metric">{num(totalTarget)} NT</div></div>
      <div className="card"><div className="metric-label">Probability-weighted target</div><div className="metric">{num(weighted)} NT</div></div>
    </div>

    <form action={addCustomerPlan} className="form section">
      <input type="hidden" name="market_id" value={data.market.id}/><h2>Add customer / sales plan</h2>
      <div className="form-grid">
        <div className="field"><label>Customer</label><input name="customer_name" required/></div>
        <div className="field"><label>Location</label><input name="location" defaultValue="Toledo area, OH"/></div>
        <div className="field"><label>Status</label><select name="status" defaultValue="Prospect"><option>Committed</option><option>Active</option><option>Trial</option><option>Quoted</option><option>Prospect</option></select></div>
        <div className="field"><label>Annual customer demand (NT)</label><input name="annual_demand_nt" type="number" step="1"/></div>
        <div className="field"><label>AGEMA target volume (NT)</label><input name="target_volume_nt" type="number" step="1" required/></div>
        <div className="field"><label>Probability of winning target (%)</label><input name="probability_pct" type="number" min="0" max="100" step="1" defaultValue="50" required/></div>
        <div className="field"><label>Sell price ($/NT)</label><input name="sell_price_per_nt" type="number" step="0.01" required/></div>
        <div className="field"><label>Payment terms (days)</label><input name="payment_terms_days" type="number" step="1" defaultValue="30"/></div>
        <div className="field"><label>Start date</label><input name="start_date" type="date" required/></div>
        <div className="field"><label>End date</label><input name="end_date" type="date"/></div>
        <div className="field"><label>Trucks / day</label><input name="trucks_per_day" type="number" step="0.1" defaultValue="0" required/></div>
        <div className="field"><label>Average NT / truck</label><input name="avg_nt_per_truck" type="number" step="0.1" defaultValue="38" required/></div>
        <div className="field"><label>Operating days / week</label><input name="operating_days_per_week" type="number" step="1" defaultValue="5" required/></div>
        <div className="field wide"><label>Notes</label><input name="notes"/></div>
        <div className="field wide"><label className="check"><input name="forecast_ongoing" type="checkbox" defaultChecked/> Continue weekly demand beyond plan end for reorder forecasting</label></div>
      </div>
      <div style={{marginTop:16}}><button className="btn">Save customer plan</button></div>
    </form>

    <div className="section"><h2>Pipeline</h2><div className="table-wrap"><table className="table"><thead><tr><th>Customer</th><th>Status</th><th>Annual Demand</th><th>AGEMA Target</th><th>Prob.</th><th>Weighted Target</th><th>Price</th><th>Terms</th><th>Throughput</th><th>Dates</th><th>Forecast</th><th></th></tr></thead><tbody>
      {data.customerPlans.map(p=>{const c=p.customers||{};const weekly=Number(p.trucks_per_day||0)*Number(p.avg_nt_per_truck||0)*Number(p.operating_days_per_week||0);return <tr key={p.id}>
        <td><b>{c.name}</b><div className="muted">{c.location}</div></td><td>{c.status}</td><td>{num(c.annual_demand_nt)} NT</td><td>{num(p.target_volume_nt)} NT</td><td>{Number(p.probability_pct).toFixed(0)}%</td><td>{num(Number(p.target_volume_nt||0)*Number(p.probability_pct||0)/100)} NT</td><td>{money(p.sell_price_per_nt||c.default_price_per_nt)}</td><td>{c.payment_terms_days||0} d</td><td>{num(weekly)} NT/wk</td><td>{p.start_date} → {p.end_date||'open'}</td><td>{p.forecast_ongoing!==false?'Ongoing':'Ends with plan'}</td><td className="actions"><Link className="btn tiny" href={`/sales/${p.id}`}>Edit</Link><form action={deletePlan}><input type="hidden" name="id" value={p.id}/><button className="btn secondary tiny">Delete</button></form></td>
      </tr>})}
    </tbody></table></div></div>
  </Shell>
}
