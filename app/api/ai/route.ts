import { NextResponse } from 'next/server';
import { getUser } from '@/lib/supabase/server';
import { isTripInput, loadRecommendation } from '@/lib/server/trip';
import { hasAiKey, writeWithAi, type AiKind } from '@/lib/ai/client';
import { PROVIDER_LABEL } from '@/lib/ai/providers';
import { verifyAgainstDb } from '@/lib/ai/verify';

// AI 호출은 이 라우트 한 곳뿐이고, 화면의 "AI 요약 받기" / "AI에게 보내기" 버튼으로만 불린다.
// 추천 결과는 클라이언트 값을 믿지 않고 DB에서 다시 계산하며, AI 문장은 DB 대조를 통과해야만 돌려준다.
export async function POST(request: Request) {
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요해요.' }, { status: 401 });

  const body = await request.json();
  const kind: AiKind = body?.kind === 'question' ? 'question' : 'summary';
  const question = typeof body?.question === 'string' ? body.question.slice(0, 500) : '';
  if (!isTripInput(body) || typeof body.reason !== 'string' || (kind === 'question' && !question.trim())) {
    return NextResponse.json({ error: '요청이 잘못됐어요.' }, { status: 400 });
  }
  if (!hasAiKey()) return NextResponse.json({ error: '쓸 수 있는 AI 제공자가 없어요(키·모델 미설정). 관리자에게 문의해 주세요.' }, { status: 503 });

  const { data: profile } = await supabase.from('profiles').select('ai_enabled').eq('id', user.id).single();
  if (!profile?.ai_enabled) return NextResponse.json({ error: 'AI 사용이 꺼져 있어요. 내 데이터 → 개인정보에서 켤 수 있어요.' }, { status: 403 });

  const rec = await loadRecommendation(supabase, user.id, body);
  const prompt = kind === 'summary' ? 'AI 요약 받기' : question;

  const out = await writeWithAi(kind, body, body.reason, rec, question);
  const { refused, parseError, provider, model, attempts } = out;
  const text = out.output?.text ?? null;
  const usedFlightNos = out.output?.used_flight_nos ?? [];
  // 모든 제공자가 일시 오류로 실패 (형식 오류·거절이 아님)
  const unavailable = !text && !refused && !parseError;
  const v = text ? verifyAgainstDb(text, { rows: rec.rows, departure: body.departure, dest: body.dest, date: body.date }, usedFlightNos) : null;
  const verified = !!v?.ok;
  await supabase.from('ai_calls').insert({
    trip_id: Number.isInteger(body.tripId) ? body.tripId : null,
    kind, prompt, response: text, verified, provider, model, attempts,
    verify_detail: v?.detail ?? (refused ? { refused: true } : parseError ? { parseError: true } : unavailable ? { unavailable: true } : null),
  });
  if (unavailable) {
    return NextResponse.json({ error: 'AI 제공자 모두 응답하지 않았어요. 잠시 뒤 다시 눌러주세요. 추천 표는 그대로 볼 수 있어요.' }, { status: 502 });
  }

  return NextResponse.json({
    verified,
    text: verified ? text : null,
    detail: v?.detail ?? null,
    refused,
    parseError,
    provider: provider ? `${PROVIDER_LABEL[provider]} ${model}` : null,
  });
}
