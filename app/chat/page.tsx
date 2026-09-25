import { redirect } from 'next/navigation';
import { getUser } from '@/lib/supabase/server';
import ChatScreen from '@/components/chat/ChatScreen';

export default async function ChatPage() {
  const { supabase, user } = await getUser();
  if (!user) redirect('/login');

  const [profile, visits, flightDests, airports] = await Promise.all([
    supabase.from('profiles').select('display_name, user_type, onboarding_done, ai_enabled, country, countries(name_ko), regions(full_name)').eq('id', user.id).single(),
    supabase.from('visits').select('dest_city, visited_on, reason, from_airport').order('visited_on', { ascending: false }),
    supabase.from('flight_schedules').select('dest'),
    supabase.from('airports').select('code, name_ko, city'),
  ]);
  if (!profile.data?.onboarding_done) redirect('/onboarding');

  // 목적지 후보 = 운항 스케줄 DB에 편이 있는 도시
  const destCodes = new Set((flightDests.data ?? []).map(f => f.dest));
  const destinations = [...new Set((airports.data ?? []).filter(a => destCodes.has(a.code)).map(a => a.city))];
  const p = profile.data as unknown as {
    display_name: string | null; user_type: string | null; ai_enabled: boolean; countries: { name_ko: string } | null; regions: { full_name: string } | null;
  };

  return (
    <ChatScreen
      name={p.display_name}
      userType={p.user_type}
      aiEnabled={p.ai_enabled}
      country={p.countries?.name_ko ?? '대한민국'}
      home={p.regions?.full_name ?? null}
      visits={visits.data ?? []}
      destinations={destinations}
      airports={(airports.data ?? []).map(a => ({ code: a.code, name: a.name_ko.replace('국제공항', '') }))}
    />
  );
}
