# 🎮 팰월드 서버 관리 패널

웹 브라우저에서 팰월드 전용 서버를 편하게 관리할 수 있는 패널입니다.

![Node.js](https://img.shields.io/badge/Node.js-18+-green) ![Platform](https://img.shields.io/badge/Platform-Windows-blue)

## ✨ 기능

- **서버 관리** - 시작/정지/재시작, 실시간 상태 모니터링
- **설정 편집** - PalWorldSettings.ini를 슬라이더/토글/입력으로 편리하게 편집
- **카테고리별 분류** - 기본설정, 전투, 캡처, 경험치/드랍, 생존, 길드, 기타
- **실시간 로그** - 서버 로그 최근 50줄 표시
- **비밀번호 보호** - 세션 기반 인증
- **반응형 UI** - 모바일/태블릿 지원
- **다크모드** - 게이밍 느낌의 UI

## 🚀 설치 및 실행

### 1. Node.js 설치
[Node.js 18+](https://nodejs.org/) 을 설치하세요.

### 2. 프로젝트 다운로드 및 설치

```bash
cd palworld-panel
npm install
```

### 3. 환경변수 설정

```bash
copy .env.example .env
```

`.env` 파일을 열어 비밀번호와 경로를 설정하세요:

```env
PANEL_PASSWORD=내비밀번호
PAL_SETTINGS_PATH=C:\경로\PalWorldSettings.ini
PAL_SERVER_PATH=C:\경로\PalServer.exe
```

### 4. 실행

```bash
npm start
```

브라우저에서 `http://localhost:3000` 으로 접속하세요.

## ⚙️ 환경변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `PANEL_PASSWORD` | 패널 로그인 비밀번호 | `admin` |
| `PORT` | 패널 포트 | `3000` |
| `SESSION_SECRET` | 세션 시크릿 키 | 자동생성 |
| `PAL_SETTINGS_PATH` | PalWorldSettings.ini 경로 | Steam 기본 경로 |
| `PAL_SERVER_PATH` | PalServer.exe 경로 | Steam 기본 경로 |
| `PAL_SERVER_ARGS` | 서버 실행 인자 | `-useperfthreads -NoAsyncLoadingThread -UseMultithreadForDS` |

## 📝 참고

- Windows 전용입니다 (PalServer.exe 관리)
- 포트 3000이 방화벽에서 허용되어야 외부 접속 가능
- 설정 변경 후 서버 재시작이 필요합니다
