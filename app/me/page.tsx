import { redirect } from 'next/navigation';
import { getUser } from '@/lib/supabase/server';
import MyData from '@/components/me/MyData';
import type { VerifyDetail } from '@/lib/ai/verify';

export default async function MePage() {
  const { supabase, user } = await getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase.from('profiles')
    .select('display_name, address, user_type, ai_enabled, region_id, created_at, countries(name_ko), regions(full_name)')
    .eq('id', user.id).single();
  if (!profile) redirect('/login');

  const [classes, events, visits, aiCalls, consent, access] = await Promise.all([
    supabase.from('class_timetable').select('name, days, start_time, end_time'),
    supabase.from('schedules').select('date, description, source'),
    supabase.from('visits').select('id, dest_city, visited_on, reason, from_airport, source, is_sample').order('visited_on', { ascending: false }),
    supabase.from('ai_calls').select('id, kind, prompt, verified, verify_detail, provider, model, created_at, trips(dest_city, trip_date)').order('created_at', { ascending: false }).limit(50),
    supabase.from('location_consents').select('id').is('revoked_at', null).limit(1),
    supabase.from('access_times').select('airport, mode, minutes, is_sample, airports(name_ko)').eq('region_id', profile.region_id ?? -1),
  ]);

  const p = profile as unknown as {
    display_name: string | null; address: string | null; user_type: string | null; ai_enabled: boolean; created_at: string;
    countries: { name_ko: string } | null; regions: { full_name: string } | null;
  };

  return (
    <MyData
      email={user.email ?? ''}
      name={p.display_name}
      joined={p.created_at}
      country={p.countries?.name_ko ?? '-'}
      home={p.regions?.full_name ?? null}
      address={p.address}
      userType={p.user_type}
      aiEnabled={p.ai_enabled}
      classes={classes.data ?? []}
      events={events.data ?? []}
      visits={visits.data ?? []}
      aiCalls={(aiCalls.data ?? []) as unknown as AiCallRow[]}
      hasConsent={!!consent.data?.length}
      access={(access.data ?? []) as unknown as AccessRow[]}
    />
  );
}

export interface AiCallRow {
  id: number; kind: string; prompt: string; verified: boolean; created_at: string; provider: string | null; model: string | null;
  verify_detail: (Partial<VerifyDetail> & { refused?: boolean; parseError?: boolean; unavailable?: boolean }) | null;
  trips: { dest_city: string; trip_date: string } | null;
}

export interface AccessRow { airport: string; mode: 'car' | 'transit'; minutes: number; is_sample: boolean; airports: { name_ko: string } | null }
