import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeEqual(a: string, b: string) {
  const ba = Uint8Array.from(Buffer.from(a, 'hex'));
  const bb = Uint8Array.from(Buffer.from(b, 'hex'));
  if (ba.byteLength !== bb.byteLength) return false;
  try {
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function verifySignature(secret: string, rawBody: string, ts: string, sig: string) {
  // Per Resend: HMAC SHA256 of `${timestamp}.${rawBody}` (hex)
  const payload = `${ts}.${rawBody}`;
  const digest = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return safeEqual(digest, sig);
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_INBOUND_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Missing RESEND_INBOUND_SECRET' }, { status: 500 });
  }

  const ts = req.headers.get('resend-timestamp') || '';
  const sig = req.headers.get('resend-signature') || '';

  const raw = await req.text();

  if (!ts || !sig || !verifySignature(secret, raw, ts, sig)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const events = Array.isArray(payload) ? payload : [payload];

  // TODO: handle events as needed
  // console.log('Resend inbound events', events);

  return NextResponse.json({ received: events.length });
}

export function GET() {
  return NextResponse.json({ ok: true });
}
