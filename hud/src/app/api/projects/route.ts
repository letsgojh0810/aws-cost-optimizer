import { NextResponse } from 'next/server';
import { listProjects } from '@/lib/store-client';

export async function GET() {
  const projects = listProjects();
  return NextResponse.json(projects);
}
