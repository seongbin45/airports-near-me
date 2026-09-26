# 커밋 경계와 자동 커밋 도구

2026-09-26 작성. 이 레포에서 실제로 일어난 일을 근거로 쓴다.

## 1. 관찰된 사실

`origin/main` 이력의 작성자·커미터·본문을 뽑으면 네 종류가 섞여 있다.

| 커밋 종류 | 작성자 | 커미터 | 본문 | 예 |
|---|---|---|---|---|
| 사람/에이전트가 직접 | 로컬 계정 | 로컬 계정 | 있음(여러 줄) | `b470dec`, `be29025`, `99082ad` |
| **자동 커밋 도구** | 로컬 계정 | 로컬 계정 | **없음(0줄)** | `31852c7` "변경사항 반영", `3f1f665` |
| 패치를 `git am`으로 적용 | 패치의 작성자 | 적용한 사람 | 있음 | `edce309`, `52beff4`, `49c681e`, `21fa1d5` |
| 다른 플랫폼 에이전트 | `genspark_dev@genspark.ai` | 로컬 계정 | 있음 | `f25b9de` |

자동 커밋 도구의 지문은 **작성자 = 커미터 = 로컬 계정 + 본문 0줄**이다. 그 커밋이 무엇을 담았는지가 더 결정적이다: `3f1f665`는 메시지가 "map-API fallback module: error classification plus the chain itself." 한 줄인데 실제로는 **19개 파일 1,658줄**을 담았다. 그 안에는 `.env.example`, `ci.yml`, `README.md`, 테스트, 스크립트, 마이그레이션 2개, 그리고 **레포에 쓸려 들어간 패치 파일**(`airports-near-me-05-access-times.patch`, 740줄)까지 들어 있다.

즉 이 도구는 **그 시각 작업 트리에 있던 전부를, 그 시각 에이전트가 마지막으로 하던 말을 메시지로 삼아 커밋한다.** 메시지가 영어인 것은 그 순간 진행 문장이 영어였기 때문이다.

실제로 난 피해 두 가지:

1. 한 커밋에 여러 관심사가 섞여, 어떤 변경이 왜 들어갔는지 이력만으로 알 수 없다(`3f1f665`).
2. **이미 DB에 적용된 마이그레이션 파일이 수정됐다**(`31852c7` → `20260925180000_access_time_bands.sql`). 이번에는 수정 내용이 옳았고 DB도 그 버전과 일치해서 문제가 없었지만, 파일과 DB가 어긋나는 경로가 열려 있다는 뜻이다.

## 2. 어느 도구인지 찾는 방법

아래를 순서대로 확인한다. **워크플로가 커밋하는 경우는 아니다** — `.github/workflows/`의 두 워크플로(`ci.yml`, `sync-flights.yml`)는 `actions/checkout@v5`만 쓰고 `git commit`·`contents: write`가 없다(2026-09-26 확인).

1. 본문이 빈 내 커밋 목록 — 자동 커밋 **후보** (지문과 일치하는 것 전부)
   ```bash
   git log --format='%h|%an|%cn|%s|%b' origin/main | grep -E '\|$'
   ```

   2026-09-26 기준 후보 6개: `31852c7`, `3f1f665`, `117e7cc`("린트·테스트·빌드를 푸시마다 강제하고 운영 규칙을 README에 적는다"), `81c9475`("Update on changes"), `c2a9466`("Completed database connection and basic front-end logic implementation."), `46e3ec7`("Initial commit from Create Next App").

   **이 필터는 후보 목록이지 판정이 아니다.** 본문 없이 짧게 커밋한 사람의 커밋도 걸린다(`46e3ec7`은 Create Next App 기본 커밋이다). 판정 기준은 **메시지와 내용의 불일치**다 — 메시지 한 줄이 설명하지 못하는 여러 관심사가 한 커밋에 들어 있으면 그게 자동 커밋이다(1장의 `3f1f665`·`31852c7`). 나머지 후보 중 `c2a9466`·`81c9475`는 메시지가 에이전트의 진행 문장 형태라 의심스럽지만, 스스로 만든 커밋이면 후보에서 빼면 된다. 이 레포 초기 커밋(`c2a9466`)이 후보에 있다는 건 **최근에 생긴 도구가 아니라는 뜻**이다.
2. 훅: `ls -la .git/hooks | grep -v '\.sample'`, `git config --list --show-origin | grep -i hookspath`
3. **Claude Code 훅(가장 유력)** — 레포 루트에 `CLAUDE.md`가 있고(`@AGENTS.md`), 커밋에 `Co-Authored-By: Claude Opus 5.5` 트레일러가 붙는다. `~/.claude/settings.json`, `~/.claude/settings.local.json`, `.claude/settings.local.json`의 `hooks`에서 `git commit`을 실행하는 항목(`Stop`, `PostToolUse`, `SessionEnd` 등)을 본다
4. 에디터 자동 커밋: VS Code 계열이면 사용자 `settings.json`의 `git.enableSmartCommit`, `git.postCommitCommand`, Auto Commit 계열 확장. `.vscode/settings.json`(추적 안 됨)도 본다
5. `git reflog --date=iso` — 로컬에서 ref가 언제 움직였는지가 남는다. 자동 커밋 시각과 대조할 수 있다

## 3. 멈추는 방법

찾은 것이 훅이면 그 훅 항목을 설정 파일에서 지운다(파일을 지우기 전에 백업). 에디터 설정이면 그 설정을 끈다. 도구가 별도 프로세스(에이전트 CLI 등)라면 그 세션을 끄고, 다시 켤 때 자동 커밋 옵션을 끈 상태로 켠다. 끄기 전까지는 4장 절차로 운용한다.

## 4. 안전한 커밋 경계 절차

원칙: **자동 커밋 도구는 "작업 트리에 남아 있는 것"을 가져간다. 그래서 경계를 지키는 가장 확실한 방법은 내 변경을 작업 트리에 오래 두지 않는 것이다.**

### 4.1 작업 중

- 커밋 직전에 `git status --short`와 `git log -1 --format='%h %s'`로 기준선을 남긴다.
- 한 가지 변경을 끝내면 **즉시** `git add <그 파일들>` + 커밋한다. 같은 파일에 두 관심사가 섞이면 `git add -p`로 나눈다.
- 실험이나 되돌릴 코드는 작업 트리에 두지 않는다: `git stash push -m wip` 또는 별도 브랜치.
- `next dev`를 켜 두면 `AGENTS.md`를 다시 쓴다(그 파일 안에 그렇게 적혀 있다). 이 변경을 내 작업과 섞지 않는다.

### 4.2 push 전 검사 (매번)

```bash
git log --format='%h|%an|%cn|%s|%b' origin/main..HEAD | grep -E '\|$'   # 자동 커밋이 섞였나
git log --oneline origin/main..HEAD                                     # 내가 만든 것만 있나
git show --stat HEAD | tail -20                                         # 한 커밋에 여러 관심사가 섞였나
```

셋 중 하나라도 이상하면 push하지 말고 4.3으로 간다.

### 4.3 섞였을 때 복구

- **아직 push 전이면**: `git reset --soft HEAD~1` — 커밋만 풀리고 변경은 **인덱스에 그대로 남는다**(2026-09-26 검증: 수정 파일은 `M`, 새 파일은 `A`로 인덱스에 보존). 그대로 다시 나눠 커밋하면 된다. `git commit --amend`도 가능하다.
- **이미 push 후면**: 나누지 않는다. 이력을 바꾸려면 강제 push가 필요하고, 이미 받아간 사람의 저장소가 어긋난다. 대신 새 커밋으로 정정한다 — 잘못 들어간 내용을 되돌리거나(`git revert <sha>`), 내용을 설명하는 메시지를 새 커밋으로 남긴다.
- **적용된 마이그레이션 파일은 고치지 않는다**(1장 2번). 스키마를 바꿀 일이 있으면 새 타임스탬프의 파일을 `supabase/migrations/`에 추가하고, 이미 적용된 파일은 건드리지 않는다.

### 4.4 구조적 분리 (권장)

자동 커밋 도구가 다른 작업 디렉터리에서 돈다면, 내 작업을 별도 worktree로 옮기면 도구의 `git add -A`가 내 미커밋 파일을 아예 보지 못한다.

```bash
git worktree add ../anm-work -b agent/work   # 도구는 기존 디렉터리(main), 나는 여기서 작업
git worktree list
```

- 각 worktree는 작업 디렉터리와 인덱스가 따로 있다. 한쪽의 커밋되지 않은 파일은 다른 쪽 `git add -A`에 잡히지 않는다.
- 같은 브랜치를 두 worktree에서 동시에 체크아웃할 수는 없다(검증: `fatal: 'main' is already used by worktree …`). 그래서 도구가 `main`을 쓰고 있으면 나는 다른 브랜치를 쓴다.
- 작업이 끝나면 push해서 공유하고, 도구 쪽에서 머지하거나 PR로 받는다.

### 4.5 체크리스트

- 커밋 전: 기준선 확인 · 한 가지 변경인가 · `add -p`가 필요한가 · 메시지가 "왜"를 담는가
- push 전: 4.2의 세 명령 · 린트/테스트/빌드 · 적용된 마이그레이션 수정 없음
- 사고 후: 4.3의 복구 경로 · 원인(도구·훅)을 문서에 남기기

## 5. PR 필수 규칙과의 관계

브랜치 보호(PR 필수 + CI 통과 필수)는 push 단계에서 이력 오염을 막는 **백스톱**이지 자동 커밋을 막는 장치가 아니다. 자동 커밋은 로컬에서 만들어져 push되므로, 보호 규칙이 있으면 오염된 커밋이 PR에 담겨 보일 뿐이다. 직접적인 조치는 3장(도구 끄기)이다. 다만 PR이 필수면 오염된 커밋이 최소한 사람 눈을 거친다.
