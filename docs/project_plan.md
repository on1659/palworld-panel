# 팰월드 서버 패널 — 프로젝트 분석

## 1. 개요

- **이름**: palworld-panel
- **목적**: 웹 브라우저에서 팰월드(Palworld) 전용 서버를 관리하는 패널
- **플랫폼**: Windows 전용 (PalServer.exe 관리)
- **스택**: Node.js, Express, EJS, Tailwind CSS(CDN), express-session

---

## 2. 프로젝트 구조

```
palworld-panel/
├── server.js          # 단일 진입점 (라우팅, API, 설정 파싱, 서버 제어)
├── package.json
├── README.md
├── .gitignore         # node_modules/, .env
├── views/
│   ├── index.ejs      # 메인 패널 (서버 제어 + 설정 편집)
│   └── login.ejs      # 로그인 페이지
└── docs/
    └── project_plan.md
```

- **public/** 폴더: `server.js`에서 참조하지만 미존재 → 정적 파일 없음(문제 없음)
- **.env.example**: git status상 삭제됨(D) — 복구 또는 README만으로 환경변수 안내 가능

---

## 3. 아키텍처

### 3.1 백엔드 (server.js)

| 구분 | 내용 |
|------|------|
| **미들웨어** | dotenv, express.json/urlencoded, express-session(24h), requireAuth |
| **인증** | 단일 비밀번호(PANEL_PASSWORD), 세션 플래그 `req.session.authenticated` |
| **설정** | `PalWorldSettings.ini` INI 파싱/생성 (OptionSettings= 키=값 목록) |
| **서버 제어** | spawn(PalServer.exe), tasklist/taskkill로 프로세스 확인·종료 |
| **로그** | 메모리 배열 `serverLogs`(최대 50줄), stdout/stderr 수집 |
| **백업** | PAL_SAVE_PATH → PAL_BACKUP_ROOT/PalServerSave_yyyyMMdd_HHmmss, robocopy (Palback 방식). 서버 켜져 있을 때 3시간마다 자동 백업, 24시간 지난 PalServerSave_* 폴더 자동 삭제 |

### 3.2 설정 정의 (SETTING_DEFS)

- **카테고리**: 기본설정, 전투, 캡처, 경험치/드랍, 생존, 길드, 기타
- **타입**: text, number, slider, boolean, select
- **필드**: key, label, desc, category, type, default, min/max/step, options(select용)

약 50개 설정 항목이 정의되어 있으며, INI와 폼/API 간 변환 시 타입 변환(boolean→True/False 등) 처리.

### 3.3 API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | /login, / | 로그인 페이지, 메인(인증 필요) |
| POST | /login, /logout | 로그인 처리, 로그아웃 |
| GET | /api/status | 서버 실행 여부 + 로그 |
| GET | /api/settings | 현재 INI 설정 JSON |
| POST | /api/settings | 설정 일괄 저장 |
| POST | /api/server/start, stop, restart | 서버 시작/정지/재시작 |

---

## 4. 프론트엔드

- **엔진**: EJS (서버 사이드 렌더링)
- **스타일**: Tailwind CSS CDN, 다크 테마(보라/인디고 계열, 그라데이션 배경)
- **기능**:
  - 카테고리 탭으로 설정 그룹 전환
  - 슬라이더/숫자/토글/셀렉트/텍스트 입력
  - 서버 시작·정지·재시작 버튼
  - 실시간 상태 폴링(5초), 로그 영역(접기/펼치기)
  - 설정 저장 후 “재시작 필요” 배너, 토스트 알림

---

## 5. 환경변수

| 변수 | 용도 | 기본값 |
|------|------|--------|
| PANEL_PASSWORD | 패널 로그인 비밀번호 | admin |
| PORT | 패널 포트 | 3000 |
| SESSION_SECRET | 세션 암호화 | palworld-panel-secret |
| PAL_SETTINGS_PATH | PalWorldSettings.ini 경로 | Steam 기본 경로 |
| PAL_SERVER_PATH | PalServer.exe 경로 | Steam 기본 경로 |
| PAL_SERVER_ARGS | 서버 실행 인자 | -useperfthreads -NoAsyncLoadingThread -UseMultithreadForDS |

---

## 6. 강점

- 단일 파일 백엔드로 구조가 단순함
- PalWorldSettings.ini 스키마를 SETTING_DEFS로 중앙 관리
- 카테고리/타입별 UI 자동 생성으로 유지보수 용이
- 비밀번호 + 세션 기반 인증
- 반응형·다크 UI, 토스트·재시작 배너 등 UX 고려

---

## 7. 개선/참고 사항

1. **.env.example**: 삭제 상태이므로 복구하거나 README만으로 환경변수 문서화 유지
2. **보안**: SESSION_SECRET·PANEL_PASSWORD는 프로덕션에서 강한 값 사용 권장
3. **서버 정지**: `stopServer()`에서 taskkill 후 `serverProcess` 정리 — 실제로는 taskkill만으로 종료되는 경우가 많아 process 참조는 보조 수준
4. **로그**: 메모리만 사용 → 재시작 시 소실, 파일 로그나 로그 rotate는 미구현
5. **에러 처리**: 설정 파일 없음/읽기 실패 시 메인 페이지에서 경고 메시지 표시

---

## 8. 의존성 (package.json)

- dotenv ^16.4.5
- ejs ^3.1.10
- express ^4.21.0
- express-session ^1.18.0

devDependencies 없음. 실행: `npm start` → `node server.js`.

---

*분석 일자: 2025-02-13*
