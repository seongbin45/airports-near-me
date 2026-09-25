import { NextResponse } from 'next/server';
import { getUser } from '@/lib/supabase/server';
import { isTripInput, loadRecommendation } from '@/lib/server/trip';

// 추천 계산 + trips 기록. 입력은 목적지·날짜·출발 시각·이동수단·방문 이유.
export async function POST(request: Request) {
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요해요.' }, { status: 401 });
  const body = await request.json();
  if (!isTripInput(body) || typeof body.reason !== 'string') return NextResponse.json({ error: '요청이 잘못됐어요.' }, { status: 400 });

  const rec = await loadRecommendation(supabase, user.id, body);
  // 결과 화면에서 이동수단만 바꿔 다시 볼 때는 새 여정으로 기록하지 않는다
  if (body.save === false) return NextResponse.json({ ...rec, tripId: null });
  const { data: trip, error } = await supabase.from('trips').insert({
    dest_city: body.dest, trip_date: body.date, reason: body.reason, earliest_departure: body.departure, mode: body.mode,
    chosen_flight_id: rec.rows[0]?.flightId ?? null,
    // 스케줄 동기화로 편 행이 지워져도 기록이 남도록 값 자체도 저장
    chosen_flight_no: rec.rows[0]?.flightNo ?? null,
    chosen_origin: rec.rows[0]?.airport ?? null,
    chosen_dep: rec.rows[0]?.dep ?? null,
    chosen_arr: rec.rows[0]?.arr ?? null,
  }).select('id').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...rec, tripId: trip.id });
}
