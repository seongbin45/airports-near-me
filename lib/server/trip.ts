import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { pickBestSource, recommend, type AccessTime, type Flight, type Mode, type Recommendation } from '../recommend';
import { dayPlan } from '../day';
import { createAdminClient } from '../supabase/admin';
import { ensureFresh, type EnsureResult } from './flight-sync';
import { weekdayKo } from '../time';
import { bandFor, bandsForLookup, type Band } from '../data/access-bands';

export interface TripInput {
  dest: string;
  date: string;
  departure: string;
  mode: Mode;
}

const ISO_WEEKDAY: Record<string, number> = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6, 일: 7 };

export function isTripInput(b: unknown): b is TripInput & Record<string, unknown> {
  const x = b as Record<string, unknown>;
  return typeof x?.dest === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(String(x.date))
    && /^\d{2}:\d{2}$/.test(String(x.departure)) && (x.mode === 'car' || x.mode === 'transit');
}

/** 그날 수업·일정과 출발 가능 시각 (RLS로 본인 행만 읽힌다) */
export async function loadDay(supabase: SupabaseClient, date: string) {
  const [classes, schedules] = await Promise.all([
    supabase.from('class_timetable').select('name, days, start_time, end_time'),
    supabase.from('schedules').select('kind, all_day, start_time, end_time, description').eq('date', date),
  ]);
  if (classes.error) throw classes.error;
  if (schedules.error) throw schedules.error;
  return dayPlan(date, classes.data, schedules.data);
}

/** 거주지 기준 공항별 접근 시간 + 목적지행 편 → 추천. 모두 DB 값만 쓴다. */
export async function loadRecommendation(supabase: SupabaseClient, userId: string, t: TripInput): Promise<Recommendation & { regionMissing: boolean; onDemand: EnsureResult | null; publishedUntil: string | null; accessBand: Band }> {
  const { data: profile, error } = await supabase.from('profiles').select('region_id').eq('id', userId).single();
  if (error) throw error;

  // 여정의 날짜·출발 시각이 속한 시각대. 그 시각대 행이 없으면 'any'(호출 시점 실시간)로 물러선다.
  const band = bandFor(t.date, t.departure);
  const [access, destAirports] = await Promise.all([
    supabase.from('access_times').select('airport, minutes, source, depart_band, airports(name_ko, city)')
      .eq('region_id', profile.region_id ?? -1).eq('mode', t.mode).in('depart_band', bandsForLookup(band)),
    supabase.from('airports').select('code').eq('city', t.dest),
  ]);
  if (access.error) throw access.error;
  if (destAirports.error) throw destAirports.error;

  // 같은 공항에 시각대 행과 'any' 행이 함께 오면 시각대 행을 쓴다 (행 순서에 기대지 않는다)
  const byAirport = new Map<string, (typeof access.data)[number]>();
  for (const row of access.data) {
    const cur = byAirport.get(row.airport);
    if (!cur || (row.depart_band === band && cur.depart_band !== band)) byAirport.set(row.airport, row);
  }
  const accessRows = [...byAirport.values()];

  // 사용자가 고른 날짜·노선이 DB에 없으면 지금 API로 불러와 저장한 뒤 추천한다 (실패·시간 초과면 DB에 있는 것으로)
  const onDemand = await fillOnDemand(accessRows.map(a => a.airport), destAirports.data.map(a => a.code), t.date);

  // 공개된 정기 스케줄의 마지막 날 — 그 뒤 날짜는 "아직 공개 전"으로 안내
  const { data: until } = await supabase.from('flight_schedules').select('valid_to')
    .eq('source', '한국공항공사').order('valid_to', { ascending: false }).limit(1).maybeSingle();

  const weekday = ISO_WEEKDAY[weekdayKo(t.date)];
  const flights = await supabase.from('flight_schedules')
    .select('id, flight_no, origin, dep_time, arr_time, is_sample, source, synced_at, economy_fare, valid_from, valid_to')
    .in('dest', destAirports.data.map(a => a.code))
    .contains('days_of_week', [weekday]);
  if (flights.error) throw flights.error;
  const inSeason = flights.data.filter(f => (!f.valid_from || f.valid_from <= t.date) && (!f.valid_to || f.valid_to >= t.date));

  const accessTimes: AccessTime[] = accessRows.map(a => ({
    airport: a.airport, minutes: a.minutes, source: a.source,
    band: a.depart_band as AccessTime['band'], bandMatched: a.depart_band === band,
    airportName: (a.airports as unknown as { name_ko: string; city: string } | null)?.name_ko.replace('국제공항', '') ?? a.airport,
    city: (a.airports as unknown as { name_ko: string; city: string } | null)?.city ?? null,
  }));
  return { ...recommend(t.departure, accessTimes, pickBestSource(inSeason as Flight[])), regionMissing: !accessTimes.length, onDemand, publishedUntil: until?.valid_to ?? null, accessBand: band };
}

async function fillOnDemand(origins: string[], dests: string[], date: string): Promise<EnsureResult | null> {
  const serviceKey = process.env.DATA_GO_KR_KEY;
  if (!serviceKey || !process.env.SUPABASE_SERVICE_ROLE_KEY || !origins.length || !dests.length) return null;
  try {
    return await ensureFresh(createAdminClient(), { serviceKey, origins, dests, date });
  } catch {
    return null;
  }
}
