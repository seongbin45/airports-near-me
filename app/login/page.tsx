import LoginForm from './LoginForm';

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const { error } = await searchParams;
  return <LoginForm linkError={error === 'link'} devPassword={process.env.NODE_ENV !== 'production'} />;
}
