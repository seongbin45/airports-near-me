import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { pickBestSource, recommend, type AccessTime, type Flight, type Mode, type Recommendation } from '../recommend';
import { dayPlan } from '../day';
import { createAdminClient } from '../supabase/admin';
import { ensureFresh, type EnsureResult } from './flight-sync';
import { weekdayKo } from '../time';

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
export async function loadRecommendation(supabase: SupabaseClient, userId: string, t: TripInput): Promise<Recommendation & { regionMissing: boolean; onDemand: EnsureResult | null; publishedUntil: string | null }> {
  const { data: profile, error } = await supabase.from('profiles').select('region_id').eq('id', userId).single();
  if (error) throw error;

  const [access, destAirports] = await Promise.all([
    supabase.from('access_times').select('airport, minutes, source, airports(name_ko)').eq('region_id', profile.region_id ?? -1).eq('mode', t.mode),
    supabase.from('airports').select('code').eq('city', t.dest),
  ]);
  if (access.error) throw access.error;
  if (destAirports.error) throw destAirports.error;

  // 사용자가 고른 날짜·노선이 DB에 없으면 지금 API로 불러와 저장한 뒤 추천한다 (실패·시간 초과면 DB에 있는 것으로)
  const onDemand = await fillOnDemand(access.data.map(a => a.airport), destAirports.data.map(a => a.code), t.date);

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

  const accessTimes: AccessTime[] = access.data.map(a => ({
    airport: a.airport, minutes: a.minutes, source: a.source,
    airportName: (a.airports as unknown as { name_ko: string } | null)?.name_ko.replace('국제공항', '') ?? a.airport,
  }));
  return { ...recommend(t.departure, accessTimes, pickBestSource(inSeason as Flight[])), regionMissing: !accessTimes.length, onDemand, publishedUntil: until?.valid_to ?? null };
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
