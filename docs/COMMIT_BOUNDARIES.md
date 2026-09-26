# 커밋 경계 — `git add .` 습관과 이력 관리

2026-09-26 작성, **2026-09-27 정정**. 이 레포에서 실제로 일어난 일을 근거로 쓴다.

## 0. 정정 — 자동 커밋 도구는 없었다

이 문서는 처음에 "작업 트리를 통째로 커밋하는 자동 도구가 붙어 있다"고 **단정**하고,
그 도구를 찾는 진단 절차(훅·에디터 설정·reflog)까지 적었다. **그 진단은 틀렸다.**
작성자가 터미널 이력으로 확인해 주었다:

```
$ git add .
$ git commit -m "Update on changes"
 5 files changed, 906 insertions(+), 6 deletions(-)
 create mode 100644 airports-near-me-fixes.patch
 ...
$ git add .
$ git commit -m "map-API fallback module: error classification plus the chain itself."
 19 files changed, 1658 insertions(+), 156 deletions(-)
 create mode 100644 airports-near-me-05-access-times.patch
```

즉 `3f1f665`(19개 파일·패치 파일 740줄 포함)와 `31852c7`은 **사람이 `git add .`로 직접 커밋한 것**이다.
메시지가 어시스턴트의 진행 문장이었던 것은 그 문장을 그대로 옮겨 썼기 때문이다.
Orca는 무관하다 — 그 hook(`claude-hook.cmd`)은 에이전트 상태 중계이고(`agentStatusHooksEnabled: true`),
Source Control AI 설정은 커밋 **메시지 생성**용이다.

남는 교훈은 도구가 아니라 **`git add .` 습관**이다. 두 커밋 모두 그 습관의 결과다.

## 1. `git add .`가 실제로 쓸어담은 것

| 커밋 | 쓸려 들어간 것 | 결과 |
|---|---|---|
| `3f1f665` | `airports-near-me-05-access-times.patch` (740줄) | 패치 파일이 레포에 커밋됨 → `2358f1f`에서 삭제 + `.gitignore`에 `/*.patch` 추가 |
| `31852c7` | **이미 DB에 적용된 마이그레이션 파일 수정** | 내용은 옳았지만 파일과 DB가 어긋나는 경로가 열림(4장) |

또한 `3f1f665`는 메시지 한 줄에 **관심사가 다른 19개 파일**이 들어갔다. 이력만 봐서는
어떤 변경이 왜 들어갔는지 알 수 없다. (작성자 이력에는 패치 파일을 빼려고 `git reset --soft HEAD^`를
두 번 반복한 기록이 남아 있다 — 그때는 루트 `/*.patch` 규칙이 없었다.)

## 2. 지금 `git add .`가 쓸어담을 수 있는 것 (2026-09-27 확인)

무시되는 것: `node_modules`, `.next`, `.env*`(`.env.example` 제외), `*.tsbuildinfo`, `next-env.d.ts`,
`/e2e-shots`, `/reference/`, **루트 `/*.patch`**, 그리고 `supabase/.gitignore`가 `supabase/.temp`와
`.branches`를 막는다(`git check-ignore`로 확인 — `supabase/.temp/project-ref`가 여기 해당).

**그래도 파일을 지정해서 커밋한다.** ignore 규칙이 커버하지 않는 것들이 남아 있다 —
새로 만든 산출물, `design/` 시안, 임시 스크립트, 실험 파일.

```bash
git status --porcelain        # 비어 있으면 안전한 상태
git check-ignore -v <파일>     # 무시되는지 확인하고 싶을 때
```

## 3. 권장 습관

```bash
git status --short            # 무엇이 바뀌었나 (필수)
git add <파일들>              # 또는 git add -p 로 헝크 단위
git diff --cached --stat      # 스테이징된 것만 다시 확인
git commit -m "..."           # 메시지에는 '왜'를 쓴다
```

- **한 커밋에 한 가지 관심사.** 여러 관심사가 섞이면 `git add -p`로 나눈다.
- 실험 코드는 작업 트리에 두지 않는다 — `git stash push -m wip` 또는 별도 브랜치.
- `next dev`는 `AGENTS.md`를 다시 쓴다(그 파일 안에 그렇게 적혀 있다). 내 작업과 섞지 않는다.
- push 방식은 `docs/APPLYING_PATCHES.md`를 따른다(브랜치 보호 적용 후에는 main 직접 push가 막힌다).

## 4. 적용된 마이그레이션은 고치지 않는다

`31852c7`이 이 경로를 열었다. 스키마를 바꿀 일이 있으면 **새 타임스탬프 파일을 추가**한다.
적용된 파일을 고치면 파일과 실제 DB가 어긋나고, 어느 쪽이 맞는지 알 수 없게 된다.
2026-09-27 테스트 전용 프로젝트를 만들면서 **이 차이가 처음 드러난다** — 그때 나오는 차이는
"마이그레이션 이력이 불완전하다"는 증거이므로, 항목마다 판정해 필요하면 새 마이그레이션을 추가한다.

## 5. 섞였을 때 복구

- **push 전**: `git reset --soft HEAD^` — 커밋만 풀리고 변경은 **인덱스에 그대로 남는다**
  (2026-09-26 검증: 수정 파일은 `M`, 새 파일은 `A`). 일부만 빼려면 `git restore --staged <파일>`.
  그대로 다시 나눠 커밋하면 된다.
- **push 후**: 나누지 않는다. 이력을 고치려면 강제 push가 필요하고, 이미 받아간 사람의 저장소가
  어긋난다. 새 커밋으로 정정한다(`git revert <sha>` 또는 설명 커밋).

## 6. 이력 판독 — 커밋 출처 구분

`git am`으로 들어온 패치는 **작성자와 커미터가 다르다**(작성자 = 패치를 만든 쪽, 커미터 = 적용한 사람).
그래서 "내가 만들지 않은 커밋"을 구분할 수 있다:

```bash
git log --format='%h|%an <%ae>|%cn <%ce>|%s' -12
```

| 출처 | 작성자 | 커미터 |
|---|---|---|
| 직접 커밋 | 로컬 계정 | 로컬 계정 |
| 패치 적용(`git am`) | 패치 작성자 | 적용한 사람 |
| 다른 플랫폼 에이전트 | `genspark_dev@genspark.ai` | 로컬 계정 |

**이 표는 출처 구분용이지 품질 판정용이 아니다.** 이 문서가 처음에 쓴 지문
("작성자=커미터=로컬 계정 + 본문 0줄 = 자동 커밋")은 **사람이 짧게 커밋한 것도 잡는다** —
실제로 `46e3ec7`(Create Next App 기본 커밋)과 `c2a9466`이 걸렸다. 지문으로 판정하지 말고
**커밋 내용과 메시지가 맞는지**를 본다.

## 7. 브랜치 보호와의 관계

브랜치 보호(PR 필수 + CI 통과 필수)는 `git add .` 문제와 **다른 것**을 푼다 —
검증되지 않은 커밋이 main에 들어가는 것을 막는다. 부수 효과로 `git push origin main`이
거부된다(같은 SHA가 이미 검사를 통과한 경우는 예외). 패치·커밋을 넣는 흐름은
`docs/APPLYING_PATCHES.md` 3-6장을 따른다.
