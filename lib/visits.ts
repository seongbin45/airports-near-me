// 대화에서 만든 여정(trips)을 방문 기록(visits)으로 넘기는 판단.
//
// 자동 승격은 하지 않는다. 날짜가 지났다고 그냥 옮기면 취소한 여정도 기록으로 남고,
// 그 가짜 기록이 이유 대조(reasonCrossCheck)와 지난 방문 칩("제주 · 지난 2회")의 근거가 된다.
// 지난 여정은 "확인 대기"로 보여주고, 사용자가 확인했을 때만 visits에 들어간다.

export interface TripRow {
  id: number;
  dest_city: string;
  trip_date: string;
  reason: string;
  /** 추천이 성립한 여정만 확인 대상이다 (편을 고르지 못한 여정은 공항도 없다) */
  chosen_origin: string | null;
  chosen_flight_no?: string | null;
  visit_dismissed_at?: string | null;
}

export interface VisitRow {
  dest_city: string;
  visited_on: string;
}

/** 방문 기록으로 아직 넘기지 않은 지난 여정. 같은 날 같은 목적지가 여러 건이면 최신 한 건만. */
export function pendingFromTrips(trips: TripRow[], visits: VisitRow[], today: string): TripRow[] {
  const recorded = new Set(visits.map(v => key(v.dest_city, v.visited_on)));
  const seen = new Set<string>();
  const out: TripRow[] = [];
  // 최신 여정부터. 같은 날짜면 나중에 만든 여정(id가 큰 쪽)을 대표로 쓴다
  for (const t of [...trips].sort((a, b) => b.trip_date.localeCompare(a.trip_date) || b.id - a.id)) {
    if (t.trip_date >= today) continue;      // 오늘·미래 여정은 아직 다녀온 게 아니다
    if (!t.chosen_origin) continue;          // 추천이 성립하지 않은 여정
    if (t.visit_dismissed_at) continue;      // 사용자가 "안 갔어요"로 지운 여정
    const k = key(t.dest_city, t.trip_date);
    if (recorded.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

const key = (dest: string, day: string) => `${dest}|${day.slice(0, 10)}`;

/** 확인할 수 없는 여정이면 이유 문장, 확인 가능하면 null */
export function confirmableError(trip: TripRow, today: string): string | null {
  if (trip.trip_date >= today) return '아직 날짜가 지나지 않은 여정이에요.';
  if (!trip.chosen_origin) return '공항을 고르지 못한 여정이라 기록으로 남길 수 없어요.';
  return null;
}

/**
 * 여정 → 방문 기록 행. 값은 DB의 여정 행에서만 가져온다 (클라이언트가 보낸 목적지·날짜·공항을 믿지 않는다).
 * reason을 따로 주면 그 값을 쓴다 (같은 여정이라도 실제 이유가 다를 수 있다). 호출한 쪽이 checkReason으로 검사한다.
 */
export function visitFromTrip(trip: TripRow, reason?: string | null) {
  return {
    trip_id: trip.id,
    dest_city: trip.dest_city,
    visited_on: trip.trip_date,
    reason: reason?.trim() || trip.reason,
    from_airport: trip.chosen_origin,
    source: 'trip' as const,
  };
}
