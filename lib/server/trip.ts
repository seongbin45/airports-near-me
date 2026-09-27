import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { pickBestSource, recommend, type AccessTime, type Flight, type Mode, type Recommendation } from '../recommend';
import { dayPlan } from '../day';
import { createAdminClient } from '../supabase/admin';
import { ensureFresh, type EnsureResult } from './flight-sync';
import { weekdayKo } from '../time';
import { accessGaps, bandFor, bandsForLookup, pickBandRows, type Band } from '../data/access-bands';

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
export interface TripRecommendation extends Recommendation {
  /** 거주지에서 어느 공항으로도, 어느 이동수단으로도 이동 시간이 없음 */
  regionMissing: boolean;
  /** 고른 이동수단으로는 이동 시간이 없고 다른 이동수단에는 있는 공항 (이름) */
  noAccess: string[];
  /** 그날 편은 있는데 어느 이동수단으로도 이동 시간이 없는 공항 (이름) */
  noAccessAny: string[];
  onDemand: EnsureResult | null;
  publishedUntil: string | null;
  accessBand: Band;
}

const shortName = (nameKo: string | undefined, code: string) => nameKo?.replace('국제공항', '') ?? code;

export async function loadRecommendation(supabase: SupabaseClient, userId: string, t: TripInput): Promise<TripRecommendation> {
  const { data: profile, error } = await supabase.from('profiles').select('region_id').eq('id', userId).single();
  if (error) throw error;

  // 여정의 날짜·출발 시각이 속한 시각대. 그 시각대 행이 없으면 'any'(호출 시점 실시간)로 물러선다.
  const band = bandFor(t.date, t.departure);
  const otherMode: Mode = t.mode === 'car' ? 'transit' : 'car';
  const [access, otherAccess, destAirports, airportNames] = await Promise.all([
    supabase.from('access_times').select('airport, minutes, source, depart_band, airports(name_ko, city)')
      .eq('region_id', profile.region_id ?? -1).eq('mode', t.mode).in('depart_band', bandsForLookup(band)),
    // 다른 이동수단은 "값이 있는지"만 본다. 같은 시각대 규칙으로 조회해 안내와 추천의 기준을 맞춘다.
    supabase.from('access_times').select('airport, depart_band')
      .eq('region_id', profile.region_id ?? -1).eq('mode', otherMode).in('depart_band', bandsForLookup(band)),
    supabase.from('airports').select('code').eq('city', t.dest),
    supabase.from('airports').select('code, name_ko'),
  ]);
  if (access.error) throw access.error;
  if (otherAccess.error) throw otherAccess.error;
  if (destAirports.error) throw destAirports.error;
  if (airportNames.error) throw airportNames.error;

  // 같은 공항에 시각대 행과 'any' 행이 함께 오면 시각대 행을 쓴다 (행 순서에 기대지 않는다)
  const accessRows = pickBandRows(access.data, band);
  const otherRows = pickBandRows(otherAccess.data, band);

  // 사용자가 고른 날짜·노선이 DB에 없으면 지금 API로 불러와 저장한 뒤 추천한다 (실패·시간 초과면 DB에 있는 것으로)
  // 두 이동수단의 공항을 함께 넘긴다 — 값이 없는 이동수단을 골라도 "어느 공항에 편이 있는지"는 알려야 한다.
  const origins = [...new Set([...accessRows, ...otherRows].map(a => a.airport))];
  const onDemand = await fillOnDemand(origins, destAirports.data.map(a => a.code), t.date);

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
    airportName: shortName((a.airports as unknown as { name_ko: string; city: string } | null)?.name_ko, a.airport),
    city: (a.airports as unknown as { name_ko: string; city: string } | null)?.city ?? null,
  }));
  const gaps = accessGaps({ band, chosen: accessRows, other: otherRows, origins: inSeason.map(f => f.origin as string) });
  const nameOf = new Map(airportNames.data.map(a => [a.code as string, a.name_ko as string]));
  const names = (codes: string[]) => codes.map(c => shortName(nameOf.get(c), c));
  return {
    ...recommend(t.departure, accessTimes, pickBestSource(inSeason as Flight[])),
    regionMissing: !accessRows.length && !otherRows.length,
    noAccess: names(gaps.otherModeOnly),
    noAccessAny: names(gaps.none),
    onDemand, publishedUntil: until?.valid_to ?? null, accessBand: band,
  };
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
