import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { syncKacFull, syncTagoHorizon, type JobReport } from '@/lib/server/flight-sync';
import { isoDate } from '@/lib/time';

// 주기 전체 동기화를 HTTP로 실행 (배포 서버에서 수동 실행용). 정기 실행은 GitHub Actions의 scripts/sync.mts가 맡는다.
//   Authorization: Bearer $CRON_SECRET
//   ?job=kac-full | tago-horizon | all (기본 all)   ?dry=1 (한국공항공사만, DB에 쓰지 않음)
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const serviceKey = process.env.DATA_GO_KR_KEY;
  if (!serviceKey) return NextResponse.json({ error: 'DATA_GO_KR_KEY가 설정되지 않았어요.' }, { status: 503 });

  const job = request.nextUrl.searchParams.get('job') ?? 'all';
  const dryRun = request.nextUrl.searchParams.get('dry') === '1';
  const opts = { serviceKey, today: isoDate(new Date()), trigger: 'manual' as const, dryRun };
  try {
    const admin = dryRun ? null : createAdminClient();
    const reports: JobReport[] = [];
    if (job === 'kac-full' || job === 'all') reports.push(await syncKacFull(admin, opts));
    if ((job === 'tago-horizon' || job === 'all') && admin) reports.push(await syncTagoHorizon(admin, opts));
    return NextResponse.json({ reports }, { status: reports.every(r => r.ok) ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
