# 팰월드 서버 업데이트 기능 추가

## Context
팰월드 서버에 게임 업데이트가 나왔을 때, 현재 패널에서는 서버를 업데이트할 방법이 없다. SteamCMD를 활용하여 패널 UI에서 원클릭으로 서버를 업데이트할 수 있는 기능을 추가한다.

## 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `.env.example` | `STEAMCMD_PATH` 환경변수 추가 |
| `server.js` | 업데이트 상태변수, `updateServer()` 함수, API 엔드포인트 추가 |
| `views/index.ejs` | 업데이트 버튼, 모달, 배너, JS 함수 추가 |

---

## 1단계: `.env.example` — 환경변수 추가 (L28 뒤)

```ini
# ===== SteamCMD 업데이트 설정 =====
# SteamCMD 실행 파일 경로 (설정 시 업데이트 버튼 활성화)
# STEAMCMD_PATH=C:\steamcmd\steamcmd.exe
```

---

## 2단계: `server.js` — 백엔드 구현

### 2-1. 상수 추가 (L24 `PLAYER_DATA_DIR` 뒤)
```js
const STEAMCMD_PATH = process.env.STEAMCMD_PATH || '';
const PAL_INSTALL_DIR = path.dirname(SERVER_PATH);
```

### 2-2. 상태변수 추가 (L680 `serverLogs` 근처)
```js
let updateProcess = null;
let isUpdating = false;
```

### 2-3. 핵심 함수 추가 (`startServer()` 함수 위, ~L903)

**`isSteamCmdConfigured()`** — SteamCMD 설정 여부 확인

**`updateServer({ autoRestart })`** — 메인 업데이트 로직:
1. 중복 실행/미설정 가드 체크
2. 서버 실행 중이면 → 플레이어에게 공지 전송 → 10초 대기 → 강제 종료 → 최대 40초 대기
3. SteamCMD spawn: `+login anonymous +force_install_dir <PAL_INSTALL_DIR> +app_update 2394010 validate +quit`
4. stdout/stderr를 `addLog('[업데이트] ...')`로 실시간 스트리밍 (기존 `startServer`의 `flushLines` 패턴 재사용)
5. 종료 시: exit code 0이면 성공 로그, `autoRestart`면 3초 후 `startServer()` 호출
6. 즉시 `{ success: true }` 반환 (비동기 진행)

### 2-4. `startServer()` 가드 추가 (L904)
```js
if (isUpdating) {
  addLog('[시작] 업데이트 진행 중이므로 서버를 시작할 수 없습니다.');
  return { success: false, message: '업데이트 진행 중입니다.' };
}
```

### 2-5. `/api/status` 응답 확장 (L1238)
기존 응답에 `updating`, `steamcmdConfigured` 필드 추가:
```js
res.json({
  running: isServerRunning(),
  updating: isUpdating,
  steamcmdConfigured: isSteamCmdConfigured(),
  logs: serverLogs,
  players: getPlayersState()
});
```

### 2-6. API 엔드포인트 추가 (L1390 `backup/now` 뒤)
```
POST /api/server/update  { autoRestart: boolean }
```

---

## 3단계: `views/index.ejs` — 프론트엔드 구현

### 3-1. 업데이트 배너 (L101 `restart-banner` 뒤)
```html
<div id="update-banner" class="hidden fixed top-0 ...bg-cyan-600/95...">
  ⬆️ 서버 업데이트 진행 중... (로그에서 진행 상황을 확인하세요)
</div>
```

### 3-2. 업데이트 버튼 (L136 백업 버튼 뒤)
```html
<button onclick="showUpdateModal()" id="update-btn" style="display:none"
  class="btn-glow px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 ...">
  ⬆️ 업데이트
</button>
```
- `steamcmdConfigured`가 true일 때만 `display` 표시 (status 폴링으로 제어)

### 3-3. 업데이트 확인 모달
기존 `shutdown-modal` 패턴을 따라 구현:
- 서버 실행 중/플레이어 접속 중이면 경고 표시
- "업데이트 후 자동 재시작" 체크박스 (기본 체크)
- "업데이트 시작" / "취소" 버튼

### 3-4. JavaScript 함수
- `showUpdateModal()` — 모달 열기 (현재 서버/플레이어 상태 반영)
- `confirmUpdate()` — `POST /api/server/update` 호출
- `closeUpdateModal()` — 모달 닫기

### 3-5. `refreshStatus()` 수정 (~L673)
```js
// 업데이트 버튼 표시/숨김
const updateBtn = document.getElementById('update-btn');
if (updateBtn) {
  updateBtn.style.display = data.steamcmdConfigured ? '' : 'none';
  updateBtn.disabled = data.updating;
  updateBtn.textContent = data.updating ? '⏳ 업데이트 중...' : '⬆️ 업데이트';
}
// 업데이트 배너 표시/숨김
const updateBanner = document.getElementById('update-banner');
if (updateBanner) {
  updateBanner.classList.toggle('hidden', !data.updating);
}
```

---

## 업데이트 플로우 요약

```
[업데이트 버튼 클릭] → [모달 확인] → POST /api/server/update
  → 서버 실행 중? → 인게임 공지 → 10초 대기 → 강제 종료 → 40초 대기
  → SteamCMD 실행 (stdout → 로그 뷰어 실시간 표시)
  → 완료 시: autoRestart면 3초 후 서버 자동 시작
```

---

## 에러 처리

| 상황 | 처리 |
|------|------|
| STEAMCMD_PATH 미설정 | 버튼 숨김, API 에러 반환 |
| SteamCMD 파일 없음 | API 에러 메시지 |
| 업데이트 중 중복 요청 | "이미 진행 중" 반환 |
| 서버 종료 실패 (40초 초과) | 업데이트 취소, 에러 로그 |
| SteamCMD 비정상 종료 | 에러 로그, 자동재시작 안함 |
| 업데이트 중 서버 시작 시도 | "업데이트 진행 중" 차단 |

---

## 검증 방법

1. `.env`에 `STEAMCMD_PATH` 미설정 → 업데이트 버튼이 보이지 않는지 확인
2. `.env`에 `STEAMCMD_PATH=C:\steamcmd\steamcmd.exe` 설정 → 버튼 표시 확인
3. 서버 정지 상태에서 업데이트 → SteamCMD 실행, 로그 출력 확인
4. 서버 실행 상태에서 업데이트 → 자동 종료 후 업데이트 진행 확인
5. "자동 재시작" 체크 시 → 업데이트 완료 후 서버 자동 시작 확인
6. 업데이트 중 시작/업데이트 버튼 비활성화 확인
