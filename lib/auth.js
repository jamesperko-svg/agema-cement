import crypto from 'crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export function expectedToken() {
  const secret = process.env.AGEMA_SESSION_SECRET || '';
  return crypto.createHash('sha256').update(`agema:${secret}`).digest('hex');
}

export function isAuthenticated() {
  const value = cookies().get('agema_session')?.value;
  return Boolean(value && value === expectedToken());
}

export function requireAuth() {
  if (!isAuthenticated()) redirect('/login');
}
