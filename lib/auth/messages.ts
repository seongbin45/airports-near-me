// Supabase Auth가 돌려주는 오류를 화면 문구로 바꾼다.
//
// 원문은 영어다("Invalid login credentials"). 그대로 보여주면 사용자가 무엇을 고쳐야 하는지 알 수 없다.
// 아는 것만 한국어로 바꾸고, 모르는 것은 **원문을 그대로** 보여준다 — 모르는 오류를
// "오류가 발생했어요"로 뭉개면 원인을 추적할 수 없다(이 저장소의 다른 오류 처리와 같은 원칙).

const RULES: { test: RegExp; text: string }[] = [
  { test: /invalid login credentials/i, text: '이메일 또는 비밀번호가 맞지 않아요.' },
  { test: /email not confirmed/i, text: '메일함에서 인증 링크를 먼저 눌러주세요.' },
  { test: /already registered|already been registered|user already exists/i, text: '이미 가입된 이메일이에요. 로그인해 주세요.' },
  { test: /password should be at least/i, text: '비밀번호가 너무 짧아요. 6자 이상으로 정해주세요.' },
  { test: /unable to validate email address|invalid email/i, text: '이메일 주소 형식이 맞지 않아요.' },
  { test: /rate limit|too many requests|for security purposes/i, text: '요청이 너무 잦아요. 잠시 뒤 다시 시도해 주세요.' },
  { test: /signups not allowed|signup is disabled|signups are disabled/i, text: '지금은 새 가입을 받지 않고 있어요.' },
  { test: /provider is not enabled/i, text: '이 로그인 방법이 아직 준비되지 않았어요. 다른 방법을 써주세요.' },
  { test: /auth session missing|session from session_id claim/i, text: '로그인 세션이 없어요. 로그인부터 해주세요.' },
];

/**
 * 콜백·네이버 함수가 붙이는 짧은 코드 — Supabase 원문이 아니라 이 저장소가 만든 값이다.
 * 문자열은 supabase/functions/naver-auth/index.ts 의 실패() 호출과 짝을 이룬다.
 */
const CODES: Record<string, string> = {
  link: '로그인 링크가 만료됐거나 잘못됐어요. 다시 받아주세요.',
  oauth: '소셜 로그인이 끝나지 않았어요. 다시 시도해 주세요.',
  otp_expired: '로그인 링크가 만료됐거나 잘못됐어요. 다시 받아주세요.',
  access_denied: '소셜 로그인을 취소하셨어요.',
  naver_denied: '네이버 로그인을 취소하셨어요.',
  naver_state: '네이버 로그인 요청이 만료됐어요. 다시 시도해 주세요.',
  naver_token: '네이버 인증에 실패했어요. 잠시 뒤 다시 시도해 주세요.',
  naver_no_email: '네이버 계정에서 이메일을 받지 못했어요. 네이버 로그인 설정에서 이메일 제공에 동의해 주세요.',
  naver_create: '계정을 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.',
  naver_link: '로그인 세션을 열지 못했어요. 잠시 뒤 다시 시도해 주세요.',
  account_exists_other_provider: '같은 이메일로 이미 다른 방법으로 가입된 계정이에요. 그 방법으로 로그인해 주세요.',
};

export function authMessage(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const code = CODES[s];
  if (code) return code;
  for (const r of RULES) if (r.test.test(s)) return r.text;
  return s;
}
