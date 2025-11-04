import { NextRequest, NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { Agent } from '@/models/agent';
import { LenderMC } from '@/models/lender';
import { Payment } from '@/models/payment';
import Papa from 'papaparse';
import { getCurrentSession } from '@/lib/auth';

const mappingMap = {
  Referral,
  Agent,
  LenderMC,
  Payment
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  if (!['admin', 'manager'].includes(session.user.role)) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const formData = await request.formData();
  const file = formData.get('file');
  const entity = (formData.get('entity') as string) || 'Referral';
  const mapping = JSON.parse((formData.get('mapping') as string) || '{}') as Record<
    string,
    string | null | undefined
  >;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'File missing' }, { status: 400 });
  }

  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, { header: true });
  const rows = parsed.data.filter((row) => Object.keys(row).some((key) => row[key]));

  await connectMongo();

  const Model = mappingMap[entity as keyof typeof mappingMap] as any;
  if (!Model) {
    return NextResponse.json({ error: 'Unknown entity' }, { status: 400 });
  }

  const docs = rows.map((row) => {
    const mapped: Record<string, unknown> = {};
    Object.entries(mapping).forEach(([source, target]) => {
      if (!target) return;
      mapped[target] = row[source as keyof typeof row] ?? null;
    });
    return mapped;
  });

  await Model.insertMany(docs, { ordered: false }).catch(() => undefined);

  return NextResponse.json({ imported: docs.length });
}
