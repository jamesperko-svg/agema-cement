import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAuth } from '../../lib/auth';
import { db, loadSalesPipeline } from '../../lib/db';
import { calculateProfitForecast } from '../../lib/profit';
import Shell from '../_shell';

function money(value) {
  return Number(value || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

function num(value, digits = 0) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function date(value) {
  return value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString() : '-';
}

function nullableNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(String(value).replace(/[$,]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function parseCsv(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some(cell => String(cell).trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  row.push(field.replace(/\r$/, ''));
  if (row.some(cell => String(cell).trim() !== '')) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function rowValue(row, aliases) {
  for (const alias of aliases) {
    if (row[alias] !== undefined && String(row[alias]).trim() !== '') return String(row[alias]).trim();
  }
  return '';
}

async function addActual(formData) {
  'use server';
  requireAuth();
  const s = db();
  const customerId = String(formData.get('customer_id') || '');
  const { data: customer, error: customerError } = await s
    .from('customers')
    .select('default_price_per_nt')
    .eq('id', customerId)
    .single();
  if (customerError) throw customerError;

  const enteredPrice = nullableNumber(formData.get('sell_price_per_nt'));
  const payload = {
    market_id: String(formData.get('market_id')),
    cargo_id: String(formData.get('cargo_id') || '') || null,
    customer_id: customerId,
    delivery_date: String(formData.get('delivery_date')),
    invoice_date: String(formData.get('invoice_date') || '') || null,
    invoice_number: String(formData.get('invoice_number') || '').trim() || null,
    external_source: 'Manual',
    external_id: String(formData.get('external_id') || '').trim() || null,
    volume_nt: Number(formData.get('volume_nt')),
    sell_price_per_nt: enteredPrice ?? nullableNumber(customer?.default_price_per_nt),
    invoice_amount_usd: nullableNumber(formData.get('invoice_amount_usd')),
    payment_date: String(formData.get('payment_date') || '') || null,
    status: String(formData.get('status') || 'Invoiced'),
    notes: String(formData.get('notes') || '').trim() || null,
    updated_at: new Date().toISOString()
  };

  const { error } = await s.from('sales_actuals').insert(payload);
  if (error) throw error;
  revalidatePath('/actuals');
  revalidatePath('/profit');
  revalidatePath('/dashboard');
  redirect('/actuals?added=1');
}

async function deleteActual(formData) {
  'use server';
  requireAuth();
  const s = db();
  const { error } = await s.from('sales_actuals').delete().eq('id', String(formData.get('id')));
  if (error) throw error;
  revalidatePath('/actuals');
  revalidatePath('/profit');
  revalidatePath('/dashboard');
  redirect('/actuals?deleted=1');
}

async function importActuals(formData) {
  'use server';
  requireAuth();
  let text = String(formData.get('csv_text') || '').trim();
  const file = formData.get('csv_file');
  if (!text && file && typeof file.text === 'function' && Number(file.size || 0) > 0) text = await file.text();
  if (!text) throw new Error('Choose a CSV file or paste CSV text.');

  const parsed = parseCsv(text);
  if (parsed.length < 2) throw new Error('The CSV must contain a header row and at least one data row.');
  const headers = parsed[0].map(normalizeHeader);
  const rawRows = parsed.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));

  const s = db();
  const marketId = String(formData.get('market_id'));
  const cargoId = String(formData.get('cargo_id') || '') || null;
  const { data: customers, error: customerError } = await s
    .from('customers')
    .select('id,name,default_price_per_nt')
    .eq('market_id', marketId);
  if (customerError) throw customerError;

  const byId = new Map((customers || []).map(customer => [String(customer.id), customer]));
  const byName = new Map((customers || []).map(customer => [String(customer.name || '').trim().toLowerCase(), customer]));
  const payloads = [];

  rawRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const customerIdInput = rowValue(row, ['customer_id']);
    const customerNameInput = rowValue(row, ['customer', 'customer_name', 'account', 'account_name']);
    const customer = byId.get(customerIdInput) || byName.get(customerNameInput.toLowerCase());
    if (!customer) throw new Error(`CSV row ${rowNumber}: customer was not found in the AGEMA Sales Pipeline.`);

    const deliveryDate = normalizeDate(rowValue(row, ['delivery_date', 'ship_date', 'date']));
    const volumeNT = nullableNumber(rowValue(row, ['volume_nt', 'quantity_nt', 'net_tons', 'tons', 'quantity']));
    if (!deliveryDate) throw new Error(`CSV row ${rowNumber}: delivery_date is missing or invalid.`);
    if (!(volumeNT > 0)) throw new Error(`CSV row ${rowNumber}: volume_nt must be greater than zero.`);

    const invoiceNumber = rowValue(row, ['invoice_number', 'invoice_no', 'invoice']);
    const lineNumber = rowValue(row, ['line_number', 'line_no', 'line']);
    let externalId = rowValue(row, ['external_id', 'source_id', 'record_id']);
    if (!externalId && invoiceNumber) externalId = `${invoiceNumber}|${lineNumber || deliveryDate}|${customer.id}`;

    payloads.push({
      market_id: marketId,
      cargo_id: cargoId,
      customer_id: customer.id,
      delivery_date: deliveryDate,
      invoice_date: normalizeDate(rowValue(row, ['invoice_date'])) || null,
      invoice_number: invoiceNumber || null,
      external_source: rowValue(row, ['external_source', 'source']) || 'CSV',
      external_id: externalId || null,
      volume_nt: volumeNT,
      sell_price_per_nt: nullableNumber(rowValue(row, ['sell_price_per_nt', 'price_per_nt', 'unit_price', 'price'])) ?? nullableNumber(customer.default_price_per_nt),
      invoice_amount_usd: nullableNumber(rowValue(row, ['invoice_amount_usd', 'invoice_amount', 'amount_usd', 'amount'])),
      payment_date: normalizeDate(rowValue(row, ['payment_date', 'paid_date'])) || null,
      status: rowValue(row, ['status']) || 'Invoiced',
      notes: rowValue(row, ['notes', 'memo']) || null,
      updated_at: new Date().toISOString()
    });
  });

  const withExternalId = payloads.filter(row => row.external_id);
  const withoutExternalId = payloads.filter(row => !row.external_id);
  if (withExternalId.length) {
    const { error } = await s.from('sales_actuals').upsert(withExternalId, { onConflict: 'market_id,external_source,external_id' });
    if (error) throw error;
  }
  if (withoutExternalId.length) {
    const { error } = await s.from('sales_actuals').insert(withoutExternalId);
    if (error) throw error;
  }

  revalidatePath('/actuals');
  revalidatePath('/profit');
  revalidatePath('/dashboard');
  redirect(`/actuals?imported=${payloads.length}`);
}

export default async function Actuals({ searchParams }) {
  requireAuth();
  const data = await loadSalesPipeline();
  const profit = calculateProfitForecast(data);
  const actual = profit.actual;
  const modeledById = new Map(actual.records.map(record => [String(record.id), record]));
  const records = [...(data.salesActuals || [])].sort((a, b) => {
    const ad = new Date(`${String(a.delivery_date).slice(0, 10)}T12:00:00`);
    const bd = new Date(`${String(b.delivery_date).slice(0, 10)}T12:00:00`);
    return bd - ad || String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
  const firstCustomer = data.customers[0] || {};

  return <Shell>
    <div className="top">
      <div>
        <h1 className="title">Deliveries & Invoices</h1>
        <div className="muted">Enter actual truck deliveries manually or import invoice lines by CSV. Each actual week replaces the same week's forecast in the profit model.</div>
      </div>
      <Link href="/profit" className="btn secondary">Open Profit Control</Link>
    </div>

    {!data.salesActualsTableReady && <div className="notice warning section">Run <b>supabase_v4_migration.sql</b> in Supabase before entering delivery actuals.</div>}
    {searchParams?.added && <div className="notice good section">Delivery actual added.</div>}
    {searchParams?.deleted && <div className="notice section">Delivery actual deleted.</div>}
    {searchParams?.imported && <div className="notice good section">Imported or updated {num(searchParams.imported)} CSV rows.</div>}

    <div className="grid section">
      <div className="card"><div className="metric-label">Actual records</div><div className="metric">{num(actual.recordCount)}</div></div>
      <div className="card"><div className="metric-label">Delivered volume</div><div className="metric">{num(actual.volumeNT)} NT</div></div>
      <div className="card"><div className="metric-label">Entered revenue</div><div className="metric">{money(actual.revenueUSD)}</div></div>
      <div className="card"><div className="metric-label">Average sell price</div><div className="metric">{money(actual.averageSellPricePerNT)}</div></div>
      <div className="card"><div className="metric-label">Current physical inventory</div><div className="metric">{num(actual.currentInventoryNT)} NT</div></div>
      <div className="card"><div className="metric-label">Latest delivery</div><div className="metric small">{actual.lastDeliveryDate ? actual.lastDeliveryDate.toLocaleDateString() : '-'}</div></div>
    </div>

    <form action={addActual} className="form section">
      <input type="hidden" name="market_id" value={data.market.id}/>
      <input type="hidden" name="cargo_id" value={data.cargo?.id || ''}/>
      <h2>Add delivery / invoice line</h2>
      <div className="form-grid">
        <div className="field"><label>Customer</label><select name="customer_id" defaultValue={firstCustomer.id || ''} required>{data.customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></div>
        <div className="field"><label>Delivery date</label><input name="delivery_date" type="date" required/></div>
        <div className="field"><label>Volume (NT)</label><input name="volume_nt" type="number" min="0.01" step="0.01" required/></div>
        <div className="field"><label>Sell price ($/NT)</label><input name="sell_price_per_nt" type="number" min="0" step="0.01" placeholder="Uses customer default if blank"/></div>
        <div className="field"><label>Invoice amount ($)</label><input name="invoice_amount_usd" type="number" min="0" step="0.01" placeholder="Optional override"/></div>
        <div className="field"><label>Status</label><select name="status" defaultValue="Invoiced"><option>Delivered</option><option>Invoiced</option><option>Paid</option><option>Void</option></select></div>
        <div className="field"><label>Invoice number</label><input name="invoice_number"/></div>
        <div className="field"><label>Invoice date</label><input name="invoice_date" type="date"/></div>
        <div className="field"><label>Payment date</label><input name="payment_date" type="date"/></div>
        <div className="field"><label>External record ID</label><input name="external_id" placeholder="Optional accounting-system ID"/></div>
        <div className="field wide"><label>Notes</label><input name="notes"/></div>
      </div>
      <div style={{ marginTop: 16 }}><button className="btn" disabled={!data.salesActualsTableReady}>Save actual</button></div>
    </form>

    <form action={importActuals} className="form section" encType="multipart/form-data">
      <h2>Batch invoice import</h2>
      <input type="hidden" name="market_id" value={data.market.id}/>
      <input type="hidden" name="cargo_id" value={data.cargo?.id || ''}/>
      <p className="muted">Required columns: customer, delivery_date, and volume_nt. Reusing the same external_id updates a row instead of duplicating it.</p>
      <div className="two">
        <div className="field"><label>CSV file</label><input name="csv_file" type="file" accept=".csv,text/csv"/></div>
        <div className="card compact"><b><a className="text-link" href="/agema_invoice_import_template.csv">CSV import template</a></b><div className="muted" style={{ marginTop: 6 }}>Supported optional fields include price, invoice amount, payment date, status, external ID, and notes.</div></div>
      </div>
      <div className="field section"><label>Or paste CSV text</label><textarea name="csv_text" rows="7" placeholder="external_id,customer,delivery_date,volume_nt,sell_price_per_nt,..."/></div>
      <button className="btn" disabled={!data.salesActualsTableReady}>Import CSV</button>
    </form>

    <div className="section">
      <h2>Entered actuals</h2>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Delivery</th><th>Customer</th><th>Invoice</th><th>Status</th><th>Volume</th><th>Price</th><th>Revenue</th><th>Modeled profit</th><th>Source</th><th></th></tr></thead>
        <tbody>
          {records.map(record => {
            const modeled = modeledById.get(String(record.id));
            const quantity = Number(record.volume_nt || 0);
            const enteredRevenue = record.invoice_amount_usd !== null && record.invoice_amount_usd !== ''
              ? Number(record.invoice_amount_usd || 0)
              : quantity * Number(record.sell_price_per_nt || record.customers?.default_price_per_nt || 0);
            const enteredPrice = quantity > 0 ? enteredRevenue / quantity : Number(record.sell_price_per_nt || 0);
            return <tr key={record.id}>
              <td>{date(record.delivery_date)}</td>
              <td><b>{record.customers?.name || modeled?.customerName || 'Customer'}</b></td>
              <td>{record.invoice_number || '-'}</td>
              <td>{record.status}</td>
              <td>{num(quantity, 2)} NT</td>
              <td>{money(modeled?.unitPrice ?? enteredPrice)}</td>
              <td>{money(modeled?.revenueUSD ?? enteredRevenue)}</td>
              <td className={modeled ? (modeled.profitExpectedUSD >= 0 ? 'positive-text' : 'negative-text') : 'muted'}>{modeled ? money(modeled.profitExpectedUSD) : 'Excluded'}</td>
              <td>{record.external_source || 'Manual'}</td>
              <td><form action={deleteActual}><input type="hidden" name="id" value={record.id}/><button className="btn secondary tiny">Delete</button></form></td>
            </tr>;
          })}
          {!records.length && <tr><td colSpan="10" className="muted">No actual delivery or invoice records have been entered yet.</td></tr>}
        </tbody>
      </table></div>
    </div>
  </Shell>;
}
