import { NextResponse } from 'next/server';
import { getUser } from '@/lib/supabase/server';
import { checkReason } from '@/lib/chat/flow';
import { kstToday } from '@/lib/time';
import { candidateError, confirmableError, visitFromCandidate, visitFromTrip, type CandidateRow, type TripRow } from '@/lib/visits';

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

  if (action === 'import_timeline') {
    const raw = Array.isArray(body?.trips) ? body.trips : null;
    if (!raw) return NextResponse.json({ error: '요청이 잘못됐어요.' }, { status: 400 });
    if (raw.length > 200) return NextResponse.json({ error: '한 번에 200건까지만 가져올 수 있어요.' }, { status: 400 });

    // 목적지 도시는 클라이언트가 보낸 문자열을 믿지 않고 공항 코드로 DB에서 찾는다
    const { data: airportRows, error: airportErr } = await supabase.from('airports').select('code, city');
    if (airportErr) return NextResponse.json({ error: airportErr.message }, { status: 500 });
    const cityOf = new Map((airportRows ?? []).map(a => [a.code as string, a.city as string]));

    const oldest = new Date(Date.now() - 5 * 365 * 86400_000).toISOString().slice(0, 10);
    const rows: Record<string, unknown>[] = [];
    let skippedInvalid = 0;

    for (const t of raw) {
      const o = t as Record<string, unknown>;
      const from = typeof o?.from_airport === 'string' ? o.from_airport : '';
      const to = typeof o?.dest_airport === 'string' ? o.dest_airport : '';
      // 한국 내 국내선만 다룬다: 두 공항 코드가 DB에 있고 서로 다르며, 출발일이 상식적인 범위 안이어야 한다
      if (!cityOf.has(from) || !cityOf.has(to) || from === to) { skippedInvalid++; continue; }
      if (typeof o.depart_on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.depart_on) || o.depart_on >= today || o.depart_on < oldest) { skippedInvalid++; continue; }
      rows.push({
        user_id: user.id, dest_city: cityOf.get(to), visited_on: o.depart_on,
        from_airport: from, reason: null, source: 'google_timeline',
        external_key: `${from}|${to}|${o.depart_on}`,
      });
    }
    if (!rows.length) return NextResponse.json({ ok: true, added: 0, skippedExisting: 0, skippedInvalid });

    // 이미 기록이 있는 날짜는 후보로 만들지 않는다
    const { data: existing } = await supabase.from('visits').select('dest_city, visited_on')
      .in('visited_on', [...new Set(rows.map(r => r.visited_on as string))]);
    const recorded = new Set((existing ?? []).map(v => `${v.dest_city}|${v.visited_on}`));
    const fresh = rows.filter(r => !recorded.has(`${r.dest_city}|${r.visited_on}`));
    const skippedExisting = rows.length - fresh.length;
    if (!fresh.length) return NextResponse.json({ ok: true, added: 0, skippedExisting, skippedInvalid });

    // unique (user_id, external_key)로 같은 파일을 두 번 올려도 늘지 않는다
    const { data: inserted, error: insertError } = await supabase
      .from('visit_candidates').upsert(fresh, { onConflict: 'user_id,external_key', ignoreDuplicates: true })
      .select('id, dest_city, visited_on, from_airport');
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
    return NextResponse.json({ ok: true, added: inserted?.length ?? 0, skippedExisting, skippedInvalid, candidates: inserted ?? [] });
  }

  if (action === 'confirm_candidate' || action === 'dismiss_candidate') {
    const candidateId = Number(body?.candidateId);
    if (!Number.isInteger(candidateId)) return NextResponse.json({ error: '요청이 잘못됐어요.' }, { status: 400 });
    const { data: candidate, error } = await supabase.from('visit_candidates')
      .select('id, dest_city, visited_on, from_airport, reason, source, dismissed_at').eq('id', candidateId).single();
    if (error || !candidate) return NextResponse.json({ error: '후보를 찾을 수 없어요.' }, { status: 404 });

    if (action === 'dismiss_candidate') {
      const { error: dErr } = await supabase.from('visit_candidates').update({ dismissed_at: new Date().toISOString() }).eq('id', candidateId);
      if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    const problem = candidateError(candidate as CandidateRow, today);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    const reason = typeof body?.reason === 'string' ? body.reason : null;
    if (reason !== null) {
      const reasonError = checkReason(reason);
      if (reasonError) return NextResponse.json({ error: reasonError }, { status: 400 });
    }

    const { data: visit, error: insertError } = await supabase
      .from('visits').insert(visitFromCandidate(candidate as CandidateRow, reason)).select().single();
    if (insertError && (insertError as { code?: string }).code !== '23505') {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
    // 기록이 됐으면 후보는 지운다 (같은 파일을 다시 올려도 다시 뜨지 않게)
    await supabase.from('visit_candidates').delete().eq('id', candidateId);
    return NextResponse.json({ ok: true, visit, already: !visit });
  }

  return NextResponse.json({ error: '알 수 없는 요청이에요.' }, { status: 400 });
}
