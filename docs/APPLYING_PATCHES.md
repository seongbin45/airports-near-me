# 패치 적용 방법

2026-09-26 작성. Windows PowerShell 기준이며, 명령은 레포 루트(`Airports_near_me`)에서 실행한다.
여기 적은 실패 문구는 실제로 재현해서 확인한 것이다(8장).

## 1. 패치가 무엇인가

이 레포에 변경을 넣는 방법 중 하나다. `git format-patch`로 만든 **표준 git 패치 파일**이고,
파일 하나에 **커밋 하나 이상**이 들어 있다(패치 14는 커밋 2개, 나머지는 1개).

- 파일 이름: `airports-near-me-NN-이름.patch` — **NN이 적용 순서다.** 반드시 번호 순서대로 넣는다.
- 바이너리 파일은 들어 있지 않다(이미지·폰트 등은 별도로 받아야 한다).
- **적용해도 작성자가 바뀌지 않는다.** 커밋한 사람(작성자)은 패치를 만든 쪽으로 남고,
  레포에 넣은 사람(커미터)이 당신 계정으로 기록된다. `git log`에 두 이름이 다르게 보이는 게 정상이다.

## 2. 준비

### 2.1 패치 파일 받기

채팅의 파일 카드에서 내려받는다. **어디에 두든 상관없다.** 레포 루트에 두면 `.gitignore`의
`/*.patch` 규칙이 커밋을 막아 주므로 실수로 커밋될 일이 없다(7장에서 확인 방법).

### 2.2 작업 트리를 깨끗하게

```powershell
git status --short
```

**아무것도 출력되지 않아야 한다.** 뭔가 나오면 먼저 정리한다.

```powershell
git add -A; git commit -m "작업 중인 변경"   # 커밋할 변경이면
# 또는
git stash push -m wip                        # 잠시 치워둘 변경이면
```

깨끗하지 않으면 패치 적용이 중간에 실패하고, 그때 내 변경과 패치 내용이 뒤섞인다.

### 2.3 기준선 확인

```powershell
git log --oneline -1
```

패치가 기대하는 최신 커밋이어야 한다. 모르면 그냥 진행하고, 실패하면 8장의 표를 본다.

```powershell
git fetch origin main          # 원격 최신 상태를 가져와 둔다
git log --oneline -1 origin/main
```

## 3. 절차 (매번 이 순서)

### 3-1. 미리 검사 — 쓰기 없음

```powershell
git apply --check .\airports-near-me-16-예시.patch
```

- **아무것도 출력되지 않으면** 적용 가능하다. 다음 단계로.
- 무언가 출력되면 **적용되지 않는다.** 그대로 진행해도 실패한다. 8장의 표로 원인을 찾는다.
- 이 단계는 파일을 건드리지 않으므로 안심하고 여러 번 돌려도 된다.

### 3-2. 적용

```powershell
git am .\airports-near-me-16-예시.patch
```

정상 출력:

```
Applying: <커밋 제목>
```

### 3-3. 확인

```powershell
git log --oneline -3            # 방금 적용한 커밋이 맨 위에 있는가
git show --stat HEAD            # 어떤 파일이 몇 줄 바뀌었는가
```

여기서 **패치 파일 자체가 커밋에 들어 있지 않은지** 확인한다. `git show --stat HEAD`의 파일 목록에
`.patch`가 보이면 그건 잘못된 것이다(7장).

### 3-4. 검증 — 코드 패치면 필수

```powershell
npm test
npm run build
```

- `npm test`는 **통과 개수**를 본다. 이 문서 작성 시점 기준 171개다. 패치마다 늘어난다.
- `npm run build`는 `✓ Compiled successfully`가 나와야 한다.
- 테스트 개수가 줄었거나 실패가 나오면 **그 상태로 push하지 않는다.**

### 3-5. DB 반영 — 마이그레이션이 들어 있는 패치만

패치가 `supabase/migrations/*.sql`을 추가하면 그때 실행한다. 문서·코드만 바뀐 패치는
"up to date"로 끝나는 게 정상이다.

```powershell
supabase db push
```

- `Remote database is up to date.` → 새 마이그레이션 없음(정상)
- `Applying migration ...` → 실제로 적용됨. 이때는 3-6까지 하고 앱도 한 번 열어 본다.

### 3-6. 반영 (push 또는 PR)

**보호 규칙을 켜기 전**: `git push origin main`으로 끝난다.

**보호 규칙을 켠 뒤**(PR 필수 + CI 통과 필수): main 직접 push가 거부된다.
브랜치를 만들어 PR로 넣는다.

```powershell
git switch -c docs/patch-17            # 브랜치 이름은 자유
git commit -m "..."                    # (패치를 적용했다면 이미 커밋돼 있다)
git push -u origin docs/patch-17
gh pr create --fill                    # 제목·본문을 커밋에서 채운다
gh pr merge --auto --squash           # CI 통과하면 자동 머지 (설정: allow_auto_merge)
```

- `--auto`는 **CI가 끝날 때까지 기다렸다가** 머지한다. 창을 닫아도 된다.
- 바로 머지하려면 CI 통과를 확인한 뒤 `gh pr merge --squash`. 검사가 안 끝났으면 거부된다.
- **`git am`으로 받은 패치는 이미 커밋이므로 새로 커밋할 필요가 없다** — 브랜치에 push만 하면 된다.
- e2e 워크플로는 **필수 검사가 아니므로** 실패해도 머지는 막히지 않는다(처음엔 의도된 상태).

**`--force` / `--force-with-lease`를 main에 쓰지 않는다.** 이유는 6장.

## 4. 한 번에 여러 패치

순서대로 이어서 넣으면 된다. 미리 검사는 한 번만 해도 되지만, 중간에 실패하면 어디까지 들어갔는지
헷갈리므로 **하나 넣고 확인하고 다음 것을 넣는 편이 안전하다.**

```powershell
git am .\airports-near-me-16-예시.patch
git am .\airports-near-me-17-예시.patch
git log --oneline -4
```

## 5. 되돌리기

| 상황 | 명령 | 설명 |
|---|---|---|
| 적용 중 실패해서 멈춤 | `git am --abort` | 적용 전 상태로 완전히 되돌린다. **가장 먼저 이걸 시도한다** |
| 실패한 패치만 건너뛰기 | `git am --skip` | 그 패치를 빼고 다음으로 넘어간다(여러 개를 연속 적용할 때만) |
| 적용은 됐는데 내용이 잘못됨 | `git reset --hard HEAD~1` | 커밋 하나를 통째로 되돌린다. **커밋 안 한 변경도 함께 사라진다** |
| 되돌리기 전에 내 변경 보호 | `git stash push -m wip` | 먼저 치워두고 되돌린 뒤 `git stash pop` |
| **이미 push까지 했다** | `git revert <커밋>` | 되돌리는 새 커밋을 만든다. 이력을 바꾸지 않는다 |

**이미 push한 커밋은 되돌리려고 이력을 고치지 않는다.** `--force`로 지우면 이미 받아간 사람의
저장소가 어긋나고, 그 사람이 다시 push하면 사라진 커밋이 되살아나 충돌한다. 새 커밋으로 정정한다.

## 6. push — 보호 적용 후의 흐름과 force 금지

### 6.0 보호 규칙이 켜진 뒤 (2026-09-27 예정)

- `git push origin main`은 **거부된다.** 브랜치 → PR → CI → 머지 흐름을 쓴다(3-6장).
- 예외: **같은 SHA가 이미 다른 브랜치에서 검사를 통과했다면** main 직접 push가 받아들여진다.
  이건 규칙 위반이 아니다 — 필수 검사는 "CI를 통과하지 않은 커밋"을 막는 장치다.
  그래서 검증 기준은 "직접 push가 거부되나"가 아니라 **"CI 없이 main에 들어간 커밋이 없는가"**다.
- `strict: false`라서 **각각 통과한 두 PR이 순차 머지된 뒤 합쳐서 깨질 수 있다.** 1인 레포라 수용한다.

### 6.1 비상 해제

상태 검사 이름이 보호 규칙의 `contexts`와 어긋나면(워크플로·job 이름을 바꿨을 때)
PR이 영원히 이 상태로 멈춘다:

```
Expected — Waiting for status to be reported
```

**이 상태에서는 소유자도 통과할 수 없다.** 보호 규칙을 지우고 다시 설정한다.

```powershell
gh api -X DELETE repos/seongbin45/airports-near-me/branches/main/protection
# 원인 수정(워크플로/job 이름 또는 contexts) 후 다시 PUT
```

그래서 **워크플로나 job 이름을 바꿀 때는 보호 규칙의 `contexts`도 함께 바꾼다.**

### 6.2 force push

`--force-with-lease`는 **원격 브랜치를 강제로 내 로컬 상태로 맞춘다.** 조건(내가 마지막으로 본
상태에서 원격이 안 움직였는지)을 확인해 주지만, 통과하면 **원격에만 있던 커밋을 지운다.**

이 레포에서는 위험하다:

- 자동 커밋 도구가 **로컬에서** 커밋하고, GitHub 웹 편집이나 다른 기기에서도 커밋이 생길 수 있다.
  둘 다 "원격에만 있는 커밋"이 될 수 있다.
- force push는 조용히 성공한다. 지워진 커밋은 `git reflog`를 뒤져야 찾는다.

### 올바른 절차

```powershell
git push origin main
```

거부되면(`rejected`, `non-fast-forward`):

```powershell
git pull --rebase origin main      # 원격 커밋을 먼저 받고, 내 커밋을 그 위에 올린다
git push origin main
```

`pull --rebase`는 원격 커밋을 지우지 않고 내 커밋을 위에 얹는다. 충돌이 나면 8장의 충돌 항목을 본다.

**예외**: 이력 자체를 고쳐야 할 때(잘못된 커밋을 지워야 하는데 아직 아무도 안 받아갔을 때)만
force를 쓴다. 그때도 먼저 주변에 알린다.

## 7. 패치 파일을 커밋하지 않는다

`.gitignore`에 `/*.patch`가 있어서 **레포 루트**의 패치 파일은 커밋되지 않는다(확인 방법):

```powershell
git check-ignore -v .\airports-near-me-16-예시.patch
# .gitignore:51:/*.patch    .\airports-near-me-16-예시.patch
```

한 줄이라도 출력되면 무시되고 있다는 뜻이다. `git status`에도 나타나지 않는다.

- 규칙은 **루트에만** 적용된다. `docs/` 같은 하위 폴더에 두면 커밋 대상이 된다.
- 과거에 이 규칙이 없어 패치 파일이 레포에 쓸려 들어간 적이 있다(커밋 `3f1f665`, 740줄).
  그래서 규칙을 넣었고, `2358f1f`에서 그 파일을 지웠다.
- 패치 파일은 코드가 아니다. 배포에 필요하지도 않다.

## 8. 실패했을 때

실패하면 git이 `git am --continue` / `--skip` / `--abort` 중 하나를 하라고 안내한다.
**먼저 원인을 확인하고, 대개는 `git am --abort`로 되돌린 뒤 다시 시도한다.**

| 증상 (실제 문구) | 원인 | 조치 |
|---|---|---|
| `error: <파일>: already exists in index` + `Patch failed at 0001` | **이미 적용된 패치를 또 넣으려 함** | `git am --abort` → `git log --oneline`으로 확인 → 다음 패치로 |
| `error: patch failed: <파일>:<줄>` + `patch does not apply` | **베이스가 다르다** — 순서를 건너뛰었거나 이미 들어간 패치 | `git am --abort` → `git log --oneline`으로 어디까지 들어갔는지 확인 |
| `Patch is empty.` / `Already applied` | 내용이 이미 트리에 있다 | `git am --abort` → 확인 |
| `error: <파일>: does not exist in index` | 새 파일 패치인데 경로가 다르다(폴더에서 실행하지 않음) | 레포 루트에서 다시 실행 |
| 충돌 표시(`CONFLICT`) 후 멈춤 | 같은 부분을 양쪽이 고쳤다 | 파일을 열어 표시를 정리 → `git add <파일>` → `git am --continue` (어려우면 `git am --abort`) |
| `--check`는 통과하는데 `am`이 실패 | 줄바꿈(CRLF) 차이 가능성 | `git config --get core.autocrlf` 확인. `true`면 임시로 `git config core.autocrlf false` 후 다시 시도 |
| `.git/rebase-apply`가 남아 다른 명령이 막힘 | 이전 `am`이 중간에 끝났다 | `git am --abort` |
| `fatal: could not read Username for 'https://github.com'` | 자격증명 문제 | `gh auth login` 또는 Git Credential Manager로 로그인 |

## 9. 명령 요약

| 목적 | 명령 |
|---|---|
| 작업 트리 확인 | `git status --short` |
| 기준선 확인 | `git log --oneline -1` |
| 미리 검사(쓰기 없음) | `git apply --check .\<패치>` |
| 적용 | `git am .\<패치>` |
| 적용 확인 | `git show --stat HEAD` |
| 검증 | `npm test` · `npm run build` |
| DB 반영(마이그레이션 패치만) | `supabase db push` |
| 반영(보호 전) | `git push origin main` |
| 반영(보호 후) | `git switch -c <브랜치>` → `git push -u origin <브랜치>` → `gh pr create --fill` → `gh pr merge --auto --squash` |
| 거부됐을 때 | `git pull --rebase origin main` → `git push origin main` |
| 적용 취소 | `git am --abort` |
| 커밋 하나 되돌리기(로컬) | `git stash push -m wip` → `git reset --hard HEAD~1` → `git stash pop` |
| 이미 push한 것 정정 | `git revert <커밋>` |

## 10. 지금까지의 패치 (2026-09-26 기준)

| 번호 | 내용 | 상태 |
|---|---|---|
| 07 | 이동 시간 시각대 (`depart_band`·배치·추천·화면) | 적용됨 (`edce309`) |
| 08 | 추천 결과 → `/me` 방문 기록 링크 | 적용됨 (`52beff4`) |
| 09 | `access-bands` doctor 게이트·화면 문구 정리 | 적용됨 (`49c681e`) |
| 10 | 내 데이터 내보내기 1,000행 절단 수정 | 적용됨 (`21fa1d5`) |
| 11 | 커밋 경계·자동 커밋 도구 대응 문서 | 적용됨 (`b4d79c5`) |
| 12 | 데이터 모델 문서 | 적용됨 (`6a9d11d`) |
| 13 | 시각대 배치 체크리스트 | 적용됨 (`0c6ec8c`) |
| 14 | ODsay 인증 오류 파싱 수정 (커밋 2개) | 적용됨 (`d7eed60`, `fb05842`) |
| 15 | 파이프라인·쿼터 문서 | 적용됨 (`4c52789`) |
| 16 | 패치 적용 방법 문서 | 적용됨 (`4c52789` 다음) |
| 17 | 커밋 경계 정정 + 브랜치/PR 흐름 | 이 패치 |

**17 이후로는 브랜치 보호가 켜지면 main 직접 push 대신 PR 흐름을 쓴다(3-6장).**
새 패치를 받으면 이 표의 다음 번호로 이어서 넣는다.

## main 보호를 켠 뒤 달라지는 것 (2026-09-27)

- **`git push origin main --force-with-lease`는 더 이상 통하지 않습니다.** 보호 규칙이 force push를 거부합니다.
  지금까지처럼 `git commit --amend` 후 force push로 이력을 고치는 방법이 **사라집니다** — 잘못 올린 커밋은
  되돌리는 커밋(`git revert <sha>`)으로 덮습니다. 이미 올라간 커밋을 고쳐 쓰는 것보다 새 커밋을 쌓는 편이
  이 저장소에서 안전합니다(`docs/COMMIT_BOUNDARIES.md`의 `git add .` 습관과 같은 이유).
- **main에 직접 push가 거부됩니다.** 이 세션의 변경은 브랜치 → PR → (CI 통과 후) squash 머지로만 들어갑니다(3-6장).
  예외: 같은 SHA가 이미 다른 브랜치에서 `check`를 통과했으면 직접 push가 받아들여집니다(위반이 아닙니다).
  그래서 검증 기준은 "직접 push가 거부되나"가 아니라 **"CI 없이 main에 들어간 커밋이 없는가"** 입니다.
- **머지 방식이 squash 하나로 좁혀집니다** (`allow_merge_commit=false`, `allow_rebase_merge=false`).
  `strict: false`에서는 검사가 PR head에서 평가되므로, 머지 커밋을 허용하면 **아무도 검사하지 않은 커밋**이
  main에 올라갈 수 있습니다.
- **`git am`으로 받은 패치는 이미 커밋입니다.** 브랜치에 push만 하면 됩니다 — 다시 커밋하지 마세요.
