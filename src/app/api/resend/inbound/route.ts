import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  return NextResponse.json({ error: 'Inbound webhook disabled' }, { status: 404 });
}

export function GET() {
  return NextResponse.json({ error: 'Inbound webhook disabled' }, { status: 404 });
}
