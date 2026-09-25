import { redirect } from 'next/navigation';
import { getUser } from '@/lib/supabase/server';
import Onboarding from '@/components/onboarding/Onboarding';

export default async function OnboardingPage({ searchParams }: PageProps<'/onboarding'>) {
  const { step } = await searchParams;
  const { supabase, user } = await getUser();
  if (!user) redirect('/login');

  const [profile, countries, regions, classes, events, consent, airports] = await Promise.all([
    supabase.from('profiles').select('display_name, country, region_id, address, user_type, onboarding_step').eq('id', user.id).single(),
    supabase.from('countries').select('code, name_ko, enabled').order('sort'),
    supabase.from('regions').select('id, sido_short, sido, sigungu, gu, full_name').is('valid_to', null).order('id'),
    supabase.from('class_timetable').select('id, name, place, days, start_time, end_time').order('id'),
    supabase.from('schedules').select('id, kind, date, all_day, start_time, end_time, description, source').order('date'),
    supabase.from('location_consents').select('id').is('revoked_at', null).limit(1),
    supabase.from('airports').select('code, name_ko, lat, lng'),
  ]);

  return (
    <Onboarding
      profile={profile.data!}
      // 내 데이터 화면의 "수정" 링크: 이미 지나온 단계로만 돌아갈 수 있다
      startStep={Math.min(Number(step) || Infinity, profile.data!.onboarding_step)}
      countries={countries.data ?? []}
      regions={regions.data ?? []}
      initialClasses={classes.data ?? []}
      initialEvents={events.data ?? []}
      hasConsent={!!consent.data?.length}
      airports={airports.data ?? []}
    />
  );
}
