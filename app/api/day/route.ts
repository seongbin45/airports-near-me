import { NextResponse, type NextRequest } from 'next/server';
import { getUser } from '@/lib/supabase/server';
import { loadDay } from '@/lib/server/trip';

export async function GET(request: NextRequest) {
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요해요.' }, { status: 401 });
  const date = request.nextUrl.searchParams.get('date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: '날짜 형식이 잘못됐어요.' }, { status: 400 });
  return NextResponse.json(await loadDay(supabase, date));
}
