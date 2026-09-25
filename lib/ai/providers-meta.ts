// 브라우저에서도 쓰는 AI 제공자 이름 (providers.ts는 서버 전용)
export type ProviderId = 'claude' | 'openai' | 'gemini' | 'xai';

export const PROVIDER_LABEL: Record<ProviderId, string> = { claude: 'Claude', openai: 'OpenAI', gemini: 'Gemini', xai: 'xAI' };
