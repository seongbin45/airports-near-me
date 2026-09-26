// 캘린더에서 가져오기.
// - .ics 파일: 브라우저에서 읽는다(lib/data/ics.ts). 수업은 class_timetable, 일정은 schedules에 source='ics'로 저장한다.
// - 구글 캘린더 연결(OAuth 읽기 전용): 다음 단계. 저장 시 source='google_calendar'.
// 에브리타임 공유 링크는 읽지 않는다 — 근거는 docs/EVERYTIME.md.
export const ICS_IMPORT_READY = true;
export const GOOGLE_CALENDAR_READY = false;
