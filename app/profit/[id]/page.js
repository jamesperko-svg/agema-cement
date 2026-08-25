import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAuth } from '../../../lib/auth';
import { db } from '../../../lib/db';
import Shell from '../../_shell';

async function updateActual(formData) {
  'use server';
  requireAuth();
  const id = String(formData.get('id'));
  const deliveredNT = Number(formData.get('delivered_nt'));
  const unitPrice = Number(formData.get('unit_price_per_nt'));
  if (!(deliveredNT > 0)) throw new Error('Delivered net tons must be greater than zero.');
  if (!(unitPrice >= 0)) throw new Error('Unit price must be zero or greater.');
  const invoiceAmount = String(formData.get('invoice_amount_usd') || '').trim();
  const terms = String(formData.get('payment_terms_days') || '').trim();
  const externalKey = String(formData.get('external_key') || '').trim();
  const { error } = await db().from('sales_actuals').update({
    customer_id: String(formData.get('customer_id')),
    delivery_date: String(formData.get('delivery_date')),
    invoice_date: String(formData.get('invoice_date') || '') || null,
    invoice_number: String(formData.get('invoice_number') || '').trim() || null,
    delivered_nt: deliveredNT,
    unit_price_per_nt: unitPrice,
    invoice_amount_usd: invoiceAmount === '' ? null : Number(invoiceAmount),
    payment_terms_days: terms === '' ? null : Number(terms),
    external_key: externalKey || null,
    notes: String(formData.get('notes') || '').trim() || null
  }).eq('id', id);
  if (error) throw error;
  revalidatePath('/profit'); revalidatePath('/dashboard'); revalidatePath('/inventory');
  redirect('/profit');
}

export default async function EditActual({ params }) {
  requireAuth();
  const s = db();
  const { data: actual, error } = await s.from('sales_actuals').select('*, customers(*)').eq('id', params.id).maybeSingle();
  if (error) throw error;
  if (!actual) notFound();
  const { data: customers, error: customerError } = await s.from('customers').select('*').eq('market_id', actual.market_id).order('created_at');
  if (customerError) throw customerError;

  return <Shell>
    <div className="top"><div><h1 className="title">Edit Actual Delivery</h1><div className="muted">Saving recalculates dashboard profit immediately.</div></div><Link href="/profit" className="btn secondary">Back to profit</Link></div>
    <form action={updateActual} className="form section"><input type="hidden" name="id" value={actual.id}/><div className="form-grid">
      <div className="field"><label>Customer</label><select name="customer_id" defaultValue={actual.customer_id} required>{(customers || []).map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></div>
      <div className="field"><label>Delivery date</label><input name="delivery_date" type="date" defaultValue={actual.delivery_date} required/></div>
      <div className="field"><label>Invoice date</label><input name="invoice_date" type="date" defaultValue={actual.invoice_date || ''}/></div>
      <div className="field"><label>Invoice / delivery number</label><input name="invoice_number" defaultValue={actual.invoice_number || ''}/></div>
      <div className="field"><label>Delivered volume (NT)</label><input name="delivered_nt" type="number" min="0.001" step="0.001" defaultValue={actual.delivered_nt} required/></div>
      <div className="field"><label>Unit price ($/NT)</label><input name="unit_price_per_nt" type="number" min="0" step="0.01" defaultValue={actual.unit_price_per_nt} required/></div>
      <div className="field"><label>Invoice amount ($, optional override)</label><input name="invoice_amount_usd" type="number" min="0" step="0.01" defaultValue={actual.invoice_amount_usd ?? ''}/></div>
      <div className="field"><label>Payment terms snapshot (days)</label><input name="payment_terms_days" type="number" min="0" step="1" defaultValue={actual.payment_terms_days ?? actual.customers?.payment_terms_days ?? 0}/></div>
      <div className="field"><label>External Import Key</label><input name="external_key" defaultValue={actual.external_key || ''}/></div>
      <div className="field wide"><label>Notes</label><input name="notes" defaultValue={actual.notes || ''}/></div>
    </div><div style={{marginTop:16}}><button className="btn">Save actual delivery</button></div></form>
  </Shell>;
}
