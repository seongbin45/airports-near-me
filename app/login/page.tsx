import LoginForm from './LoginForm';
import { enabledProviders } from '@/lib/auth/providers';

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const { error } = await searchParams;
  const code = typeof error === 'string' ? error : null;
  return (
    <LoginForm
      linkError={code === 'link'}
      errorCode={code && code !== 'link' ? code : null}
      providers={enabledProviders(process.env.NEXT_PUBLIC_OAUTH_PROVIDERS)}
      devPassword={process.env.NODE_ENV !== 'production'}
    />
  );
}
