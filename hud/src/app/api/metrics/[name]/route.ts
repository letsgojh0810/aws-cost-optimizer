import { NextResponse } from 'next/server';
import { getMetrics } from '@/lib/store-client';

export async function GET(
  request: Request,
  { params }: { params: { name: string } }
) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get('days') ?? '7', 10);
  const metrics = getMetrics(params.name, days);
  return NextResponse.json(metrics);
}
