import { NextResponse } from 'next/server';
import { getUser } from '@/lib/supabase/server';
import { checkReason } from '@/lib/chat/flow';
import { kstToday } from '@/lib/time';
import { confirmableError, visitFromTrip, type TripRow } from '@/lib/visits';

// 방문 기록(visits)을 만드는 유일한 경로. 지난 여정(trips)을 사용자가 확인했을 때만 기록으로 넘긴다.
// 목적지·날짜·출발 공항은 요청 본문이 아니라 DB의 여정 행에서 읽는다.
const TRIP_COLS = 'id, dest_city, trip_date, reason, chosen_origin, chosen_flight_no, visit_dismissed_at';

export async function POST(request: Request) {
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요해요.' }, { status: 401 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = body?.action;
  const today = kstToday();

  if (action === 'confirm') {
    const tripId = Number(body?.tripId);
    if (!Number.isInteger(tripId)) return NextResponse.json({ error: '요청이 잘못됐어요.' }, { status: 400 });

    // RLS로 본인 여정만 읽힌다. 남의 여정 id를 보내면 여기서 걸린다.
    const { data: trip, error } = await supabase.from('trips').select(TRIP_COLS).eq('id', tripId).single();
    if (error || !trip) return NextResponse.json({ error: '여정을 찾을 수 없어요.' }, { status: 404 });
    const problem = confirmableError(trip as TripRow, today);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    const reason = typeof body?.reason === 'string' ? body.reason : null;
    if (reason !== null) {
      const reasonError = checkReason(reason);
      if (reasonError) return NextResponse.json({ error: reasonError }, { status: 400 });
    }

    const { data: visit, error: insertError } = await supabase
      .from('visits').insert(visitFromTrip(trip as TripRow, reason)).select().single();
    if (!insertError) return NextResponse.json({ ok: true, visit, already: false });

    // 같은 날 같은 목적지 기록이 이미 있음 (visits_user_dest_day_key). 그 기록을 그대로 돌려준다.
    if ((insertError as { code?: string }).code === '23505') {
      const { data: existing, error: exErr } = await supabase.from('visits')
        .select().eq('dest_city', trip.dest_city).eq('visited_on', trip.trip_date).single();
      if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
      return NextResponse.json({ ok: true, visit: existing, already: true });
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  if (action === 'dismiss') {
    const tripId = Number(body?.tripId);
    if (!Number.isInteger(tripId)) return NextResponse.json({ error: '요청이 잘못됐어요.' }, { status: 400 });
    const { error } = await supabase.from('trips').update({ visit_dismissed_at: new Date().toISOString() }).eq('id', tripId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === 'set_reason') {
    const visitId = Number(body?.visitId);
    const reason = typeof body?.reason === 'string' ? body.reason : '';
    if (!Number.isInteger(visitId)) return NextResponse.json({ error: '요청이 잘못됐어요.' }, { status: 400 });
    const reasonError = checkReason(reason);
    if (reasonError) return NextResponse.json({ error: reasonError }, { status: 400 });
    const { error } = await supabase.from('visits').update({ reason: reason.trim() }).eq('id', visitId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === 'delete') {
    const visitId = Number(body?.visitId);
    if (!Number.isInteger(visitId)) return NextResponse.json({ error: '요청이 잘못됐어요.' }, { status: 400 });
    const { data: visit, error } = await supabase.from('visits').select('id, trip_id').eq('id', visitId).single();
    if (error || !visit) return NextResponse.json({ error: '기록을 찾을 수 없어요.' }, { status: 404 });
    const { error: delError } = await supabase.from('visits').delete().eq('id', visitId);
    if (delError) return NextResponse.json({ error: delError.message }, { status: 500 });
    // 확인해서 만든 기록을 지우면 그 여정도 확인 대기에서 빼야 한다. 안 그러면 지운 기록이 바로 다시 올라온다.
    if (visit.trip_id) await supabase.from('trips').update({ visit_dismissed_at: new Date().toISOString() }).eq('id', visit.trip_id);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: '알 수 없는 요청이에요.' }, { status: 400 });
}
