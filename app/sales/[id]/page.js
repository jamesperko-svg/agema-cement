import Link from 'next/link';
import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAuth } from '../../../lib/auth';
import { db } from '../../../lib/db';
import Shell from '../../_shell';

async function updatePlan(formData){
  'use server'; requireAuth(); const s=db();
  const planId=String(formData.get('plan_id'));
  const customerId=String(formData.get('customer_id'));
  const customerPayload={
    name:String(formData.get('customer_name')).trim(),
    location:String(formData.get('location')||''),
    status:String(formData.get('status')||'Prospect'),
    annual_demand_nt:Number(formData.get('annual_demand_nt')||0),
    default_price_per_nt:Number(formData.get('sell_price_per_nt')||0),
    payment_terms_days:Number(formData.get('payment_terms_days')||0),
    invoice_day:'Monday',
    active:true
  };
  const cr=await s.from('customers').update(customerPayload).eq('id',customerId); if(cr.error)throw cr.error;
  const planPayload={
    start_date:String(formData.get('start_date')),
    end_date:String(formData.get('end_date')||'')||null,
    target_volume_nt:Number(formData.get('target_volume_nt')||0),
    probability_pct:Number(formData.get('probability_pct')||0),
    trucks_per_day:Number(formData.get('trucks_per_day')||0),
    avg_nt_per_truck:Number(formData.get('avg_nt_per_truck')||38),
    operating_days_per_week:Number(formData.get('operating_days_per_week')||5),
    sell_price_per_nt:Number(formData.get('sell_price_per_nt')||0),
    notes:String(formData.get('notes')||''),
    active:formData.get('active')==='on'
  };
  const pr=await s.from('customer_plans').update(planPayload).eq('id',planId); if(pr.error)throw pr.error;
  revalidatePath('/sales'); revalidatePath(`/sales/${planId}`); revalidatePath('/inventory'); revalidatePath('/dashboard');
}

export default async function EditPlan({params}){
  requireAuth(); const s=db();
  const {data:p,error}=await s.from('customer_plans').select('*, customers(*)').eq('id',params.id).maybeSingle();
  if(error)throw error; if(!p)notFound(); const c=p.customers||{};
  return <Shell>
    <div className="top"><div><h1 className="title">Edit Customer Plan</h1><div className="muted">Update annual demand, AGEMA target share, probability, price and physical withdrawal schedule.</div></div><Link href="/sales" className="btn secondary">Back to pipeline</Link></div>
    <form action={updatePlan} className="form section">
      <input type="hidden" name="plan_id" value={p.id}/><input type="hidden" name="customer_id" value={p.customer_id}/>
      <div className="form-grid">
        <div className="field"><label>Customer</label><input name="customer_name" defaultValue={c.name||''} required/></div>
        <div className="field"><label>Location</label><input name="location" defaultValue={c.location||''}/></div>
        <div className="field"><label>Status</label><select name="status" defaultValue={c.status||'Prospect'}><option>Committed</option><option>Active</option><option>Trial</option><option>Quoted</option><option>Prospect</option></select></div>
        <div className="field"><label>Annual customer demand (NT)</label><input name="annual_demand_nt" type="number" step="1" defaultValue={c.annual_demand_nt||0}/></div>
        <div className="field"><label>AGEMA target volume (NT)</label><input name="target_volume_nt" type="number" step="1" defaultValue={p.target_volume_nt||0} required/></div>
        <div className="field"><label>Probability of winning target (%)</label><input name="probability_pct" type="number" min="0" max="100" step="1" defaultValue={p.probability_pct??100} required/></div>
        <div className="field"><label>Sell price ($/NT)</label><input name="sell_price_per_nt" type="number" step="0.01" defaultValue={p.sell_price_per_nt||c.default_price_per_nt||0} required/></div>
        <div className="field"><label>Payment terms (days)</label><input name="payment_terms_days" type="number" step="1" defaultValue={c.payment_terms_days||0}/></div>
        <div className="field"><label>Start date</label><input name="start_date" type="date" defaultValue={p.start_date} required/></div>
        <div className="field"><label>End date</label><input name="end_date" type="date" defaultValue={p.end_date||''}/></div>
        <div className="field"><label>Trucks / day</label><input name="trucks_per_day" type="number" step="0.1" defaultValue={p.trucks_per_day||0}/></div>
        <div className="field"><label>Average NT / truck</label><input name="avg_nt_per_truck" type="number" step="0.1" defaultValue={p.avg_nt_per_truck||38}/></div>
        <div className="field"><label>Operating days / week</label><input name="operating_days_per_week" type="number" step="1" defaultValue={p.operating_days_per_week||5}/></div>
        <div className="field wide"><label>Notes</label><input name="notes" defaultValue={p.notes||''}/></div>
        <div className="field"><label className="check"><input name="active" type="checkbox" defaultChecked={p.active!==false}/> Plan active</label></div>
      </div>
      <div style={{marginTop:16}}><button className="btn">Save changes</button></div>
    </form>
  </Shell>
}
