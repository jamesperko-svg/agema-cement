import Link from 'next/link';
export default function Shell({children}){
  return <div className="shell">
    <aside className="side">
      <div className="brand">AGEMA</div><div className="sub">Toledo Cement Platform</div>
      <nav className="nav">
        <Link href="/dashboard">Executive Dashboard</Link>
        <Link href="/profit">Forecast vs Actual Profit</Link>
        <Link href="/sales">Sales Pipeline</Link>
        <Link href="/inventory">Inventory Forecast</Link>
        <Link href="/costs">Cargo Economics</Link>
        <Link href="/throughput">Legacy Throughput</Link>
        <Link href="/finance">SOFR Financing</Link>
      </nav>
    </aside><main className="main">{children}</main>
  </div>
}
