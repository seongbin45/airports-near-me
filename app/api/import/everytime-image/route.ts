import { NextResponse } from 'next/server';
import { getUser } from '@/lib/supabase/server';
import { hasAiKey } from '@/lib/ai/client';
import { readTimetableImage } from '@/lib/ai/timetable';
import { checkImageInput, rateLimitError } from '@/lib/everytime/image-input';
import { agreementCounts, crossCheck, normalizeBlocks } from '@/lib/everytime/items';

// 에브리타임 시간표 캡처 → AI 비전 → 수업 후보(미리보기용). 저장은 하지 않는다 — 사용자가 고른 과목만 브라우저에서 저장한다.
// 이미지는 AI 제공자에게 보내 읽고 어디에도 저장하지 않는다. 호출은 ai_calls에 남긴다(호출 제한도 이 행을 센다).
// AI가 읽은 시각은 초안이다: 모든 항목에 needsTimeCheck를 붙여, 사용자가 캡처와 대조해야만 고를 수 있게 한다.
export async function POST(request: Request) {
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요해요.' }, { status: 401 });

  const input = checkImageInput(await request.json().catch(() => null));
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
  if (!hasAiKey()) return NextResponse.json({ error: '쓸 수 있는 AI 제공자가 없어요(키·모델 미설정). 공유 링크 방식이나 직접 입력을 써 주세요.' }, { status: 503 });

  const { data: profile } = await supabase.from('profiles').select('ai_enabled').eq('id', user.id).single();
  if (!profile?.ai_enabled) {
    return NextResponse.json({ error: 'AI 사용이 꺼져 있어 캡처 인식을 쓸 수 없어요. 공유 링크 방식이나 직접 입력을 써 주세요.' }, { status: 403 });
  }

  const count = async (sinceMs: number) => {
    const { count: n, error } = await supabase.from('ai_calls').select('id', { count: 'exact', head: true })
      .eq('kind', 'timetable_image').gte('created_at', new Date(Date.now() - sinceMs).toISOString());
    if (error) throw error;
    return n ?? 0;
  };
  const limited = rateLimitError(await count(60_000), await count(86_400_000));
  if (limited) return NextResponse.json({ error: limited }, { status: 429 });

  // AI가 둘 이상이면 두 AI가 같은 캡처를 따로 읽고 대조한다(crossCheck). 일치해도 [시각 확인]은 여전히 필요하다.
  const { first: out, second } = await readTimetableImage({ mediaType: input.mediaType, base64: input.base64 });
  const { refused, parseError, provider, model, servedModel, usage, attempts } = out;
  const unavailable = !out.output && !refused && !parseError;
  const norm = (a: NonNullable<typeof out.output>) => normalizeBlocks(a.blocks, a.online, { needsTimeCheck: true });
  const r1 = out.output ? norm(out.output) : null;
  const r2 = second?.output ? norm(second.output) : null;
  const r = r1 && { items: crossCheck(r1.items, r2?.items ?? null), skipped: r1.skipped };
  const semester = out.output?.semester || second?.output?.semester || null;
  const engines = [out, ...(second ? [second] : [])].filter(o => o.output).map(o => `${o.provider}:${o.servedModel ?? o.model}`);

  await supabase.from('ai_calls').insert({
    kind: 'timetable_image', prompt: '시간표 캡처 인식',
    response: r ? JSON.stringify({ semester, items: r.items, skipped: r.skipped }) : null,
    verified: !!r?.items.length, provider, model, served_model: servedModel,
    usage: second ? { first: usage, second: second.usage } : usage,
    attempts: second ? [...attempts, ...second.attempts] : attempts,
    verify_detail: r
      ? { timetable: { items: r.items.length, skipped: r.skipped.length, engines, ...agreementCounts(r.items) } }
      : refused ? { refused: true } : parseError ? { parseError: true } : { unavailable: true },
  });

  if (unavailable) return NextResponse.json({ error: 'AI 제공자 모두 응답하지 않았어요. 잠시 뒤 다시 시도해 주세요.' }, { status: 502 });
  if (refused) return NextResponse.json({ error: 'AI가 이 이미지를 읽지 않았어요. 시간표 부분만 다시 캡처해 주세요.' }, { status: 422 });
  if (!r) return NextResponse.json({ error: '시간표를 읽지 못했어요. 시간표 전체가 보이게 다시 캡처해 주세요.' }, { status: 422 });
  if (!r.items.length) {
    return NextResponse.json({ error: '시간표를 찾지 못했어요. 에브리타임 시간표 전체가 보이게 다시 캡처해 주세요.', skipped: r.skipped }, { status: 422 });
  }
  return NextResponse.json({ semester, items: r.items, skipped: r.skipped });
}
