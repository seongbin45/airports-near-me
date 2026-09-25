import { toMin } from '../time';

export interface Span {
  id: number;
  start: string;
  end: string;
}

export interface Lane {
  /** 0부터 시작하는 레인 번호 */
  lane: number;
  /** 이 블록과 겹치는 블록들이 쓰는 레인 수 (폭을 나누는 기준) */
  lanes: number;
}

/** 같은 요일에 겹치는 수업을 나란히 놓기 위한 레인 배치 (프로토타입 주간 그리드 로직). */
export function layoutLanes(spans: Span[]): Map<number, Lane> {
  const list = [...spans].sort((x, y) => toMin(x.start) - toMin(y.start));
  const laneEnd: number[] = [], lane = new Map<number, number>();
  for (const c of list) {
    let i = laneEnd.findIndex(e => e <= toMin(c.start));
    if (i < 0) i = laneEnd.length;
    laneEnd[i] = toMin(c.end);
    lane.set(c.id, i);
  }
  const out = new Map<number, Lane>();
  for (const c of list) {
    const overlapping = list.filter(o => toMin(o.start) < toMin(c.end) && toMin(c.start) < toMin(o.end));
    out.set(c.id, { lane: lane.get(c.id)!, lanes: 1 + Math.max(0, ...overlapping.map(o => lane.get(o.id)!)) });
  }
  return out;
}
