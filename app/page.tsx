import { redirect } from 'next/navigation';
import { getUser } from '@/lib/supabase/server';

export default async function Home() {
  const { supabase, user } = await getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase.from('profiles').select('onboarding_done').eq('id', user.id).single();
  redirect(profile?.onboarding_done ? '/chat' : '/onboarding');
}
