import { describe, expect, it } from 'vitest';
import { E2E_MARKER_NOTE, markerProblem, projectHost, sameProject } from '../server/e2e-guard';

// 이 판정이 틀리면 운영 DB의 계정을 지우게 된다. 그래서 "표식이 없을 때 통과"하는 쪽으로 절대 기울지 않는지 고정한다.
describe('E2E 표식 판정', () => {
  it('표식 값이 맞으면 통과', () => {
    expect(markerProblem(E2E_MARKER_NOTE)).toBeNull();
  });
  it('표식이 없으면(운영) 중단 사유를 돌려준다', () => {
    for (const v of [null, undefined, '', 'other', 0, false]) {
      expect(markerProblem(v), `${JSON.stringify(v)}는 막아야 한다`).not.toBeNull();
    }
  });
  it('비슷하게 생긴 값도 통과시키지 않는다 (공백·대소문자)', () => {
    expect(markerProblem(` ${E2E_MARKER_NOTE}`)).not.toBeNull();
    expect(markerProblem(E2E_MARKER_NOTE.toUpperCase())).not.toBeNull();
  });
  it('중단 사유에 받은 값을 남긴다', () => {
    expect(markerProblem('prod')).toContain('"prod"');
  });
});

// 운영 URL과 같은 프로젝트를 검사하면 안 된다. 이 판정이 틀리면 운영 DB를 덮어쓴다.
describe('운영 프로젝트 판정', () => {
  it('호스트가 같으면 같은 프로젝트다 (대소문자·경로·슬래시 무시)', () => {
    expect(sameProject('https://abc.supabase.co', 'https://abc.supabase.co')).toBe(true);
    expect(sameProject('https://ABC.supabase.co/', 'https://abc.supabase.co')).toBe(true);
    expect(sameProject('https://abc.supabase.co/auth/v1', 'https://abc.supabase.co')).toBe(true);
  });
  it('다른 프로젝트면 막지 않는다', () => {
    expect(sameProject('https://test.supabase.co', 'https://prod.supabase.co')).toBe(false);
    expect(sameProject('https://abc.supabase.co', 'https://abcd.supabase.co')).toBe(false);
  });
  it('판정할 수 없으면 막지 않는다 (판정 불가를 사유로 쓰지 않는다)', () => {
    expect(sameProject(undefined, 'https://abc.supabase.co')).toBe(false);
    expect(sameProject('https://abc.supabase.co', '')).toBe(false);
    expect(sameProject('not a url', 'https://abc.supabase.co')).toBe(false);
    expect(sameProject('abc.supabase.co', 'abc.supabase.co')).toBe(false); // 스킴 없음
  });
  it('projectHost는 http(s)만 호스트로 읽는다', () => {
    expect(projectHost('https://x.supabase.co/')).toBe('x.supabase.co');
    expect(projectHost('javascript:alert(1)')).toBeNull();
    expect(projectHost('')).toBeNull();
    expect(projectHost(null)).toBeNull();
  });
});
