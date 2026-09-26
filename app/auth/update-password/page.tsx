import UpdatePasswordForm from './UpdatePasswordForm';

// 비밀번호 재설정 메일의 링크가 도착하는 화면. /auth/* 는 proxy.ts의 공개 경로라
// 세션이 없는 상태로도 열린다(교환은 /auth/callback 에서 이미 끝난 뒤다).
export default function UpdatePasswordPage() {
  return <UpdatePasswordForm />;
}
