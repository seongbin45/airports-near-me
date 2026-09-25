import 'server-only';
import { MODE_LABEL, type Recommendation } from '../recommend';
import { fmtDur } from '../time';
import type { TripInput } from '../server/trip';
import { completeWithFallback, configuredProviders, type ChainResult } from './providers';

const SYSTEM = `당신은 "공항 찾기" 서비스의 안내 문장을 쓰는 역할입니다.
- 아래 DATA에 있는 값만 사용하세요. DATA에 없는 편명, 시각, 공항, 요금, 날씨, 교통 상황은 절대 쓰지 마세요.
- 편명과 시각(HH:MM)은 DATA에 적힌 그대로 옮겨 쓰세요.
- 질문에 DATA로 답할 수 없으면 "이 정보는 DB에 없어 답할 수 없어요."라고만 답하세요.
- 한국어 존댓말(해요체)로 2~3문장, 목록이나 마크다운 없이 쓰세요.
- 반드시 JSON 객체 하나로만 답하세요: {"text": 문장, "used_flight_nos": [문장에 쓴 편명을 DATA 표기 그대로]}`;

export type AiKind = 'summary' | 'question';

/** 쓸 수 있는 AI 제공자가 하나라도 있나 */
export function hasAiKey() {
  return configuredProviders().length > 0;
}

function dataBlock(t: TripInput, reason: string, rec: Recommendation) {
  // 요금은 넘기지 않는다 — 검증기가 금액을 값으로 대조하지 않으므로 AI 문장에 나오면 전부 차단한다
  return JSON.stringify({
    목적지: t.dest, 날짜: t.date, 출발가능시각: t.departure, 이동수단: MODE_LABEL[t.mode], 방문이유: reason,
    공항별추천_총소요순: rec.rows.map(r => ({
      공항: r.airportName, 공항까지: fmtDur(r.accessMin), 편명: r.flightNo, 출발: r.dep, 도착: r.arr,
      공항도착여유: fmtDur(r.slackMin), 총소요: fmtDur(r.totalMin),
    })),
    노선없는공항: rec.noRoute,
    시간내탈편없는공항: rec.noFlightInTime,
  });
}

/**
 * 사용자가 버튼을 눌렀을 때만 서버 라우트에서 호출된다. 도구(tools)는 주지 않는다 — AI가 스스로 무언가를 조회하거나 실행할 수 없다.
 * 제공자 예비 체계(providers.ts)를 거쳐 JSON 답을 받고, 호출한 쪽에서 verifyAgainstDb로 검사한 뒤에만 사용자에게 보인다.
 */
export function writeWithAi(kind: AiKind, t: TripInput, reason: string, rec: Recommendation, question?: string): Promise<ChainResult> {
  const ask = kind === 'summary'
    ? '이 추천 결과를 요약해 주세요. 가장 빠른 공항과 편, 도착 시각, 총소요를 먼저 말하고, 다음 선택지를 한 문장으로 덧붙이세요.'
    : `사용자 질문: ${question}`;
  return completeWithFallback(SYSTEM, `DATA:\n${dataBlock(t, reason, rec)}\n\n${ask}`);
}
