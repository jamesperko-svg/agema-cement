import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { expectedToken } from '../../lib/auth';

async function login(formData){
  'use server';
  const pw=String(formData.get('password')||'');
  if(!process.env.AGEMA_APP_PASSWORD || pw!==process.env.AGEMA_APP_PASSWORD) redirect('/login?error=1');
  cookies().set('agema_session',expectedToken(),{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:60*60*24*30});
  redirect('/dashboard');
}
export default function Login({searchParams}){
  return <div className="login"><div className="brand">AGEMA</div><p className="muted">Cement Decision Platform</p><h1>Sign in</h1>{searchParams?.error&&<div className="notice">Incorrect password.</div>}<form action={login}><input name="password" type="password" placeholder="Platform password" autoFocus/><button className="btn" type="submit">Open platform</button></form></div>
}
