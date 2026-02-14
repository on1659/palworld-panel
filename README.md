# Palworld Server Panel

웹 브라우저에서 팰월드 전용 서버를 관리할 수 있는 패널입니다.

![Node.js](https://img.shields.io/badge/Node.js-18+-green) ![Platform](https://img.shields.io/badge/Platform-Windows-blue) ![License](https://img.shields.io/badge/License-MIT-yellow)

## 주요 기능

- **서버 제어** - 시작 / 정지(공지 후 종료) / 강제 종료 / 재시작
- **설정 편집** - PalWorldSettings.ini를 슬라이더·토글·셀렉트로 편집 (카테고리별 분류)
- **REST API 연동** - 팰월드 서버 REST API를 통한 실시간 플레이어 감지, 공지 전송, 월드 저장
- **접속 통계** - SQLite DB 기반 플레이어별 세션 기록, 일별 통계, 누적 플레이타임
- **접속 시간 알림** - 플레이어가 1시간 이상 접속하면 매 시간 인게임 공지
- **자동 백업** - 서버 가동 중 3시간마다 robocopy 백업, 24시간 지난 백업 자동 삭제
- **비밀번호 인증** - 세션 기반 로그인
- **다크모드 UI** - Tailwind CSS 기반 반응형 디자인

## 프로젝트 구조

```
palworld-panel/
├── server.js          # Express 서버 (API, 설정 파싱, REST API 클라이언트, 백업)
├── views/
│   ├── index.ejs      # 메인 대시보드 (서버 관리, 설정, 통계)
│   └── login.ejs      # 로그인 페이지
├── data/              # 런타임 데이터 (SQLite DB, 플레이어 목록) - gitignore
├── .env               # 환경변수 설정 - gitignore
├── .env.example       # 환경변수 예시
└── package.json
```

## 설치 및 실행

### 1. Node.js 설치

[Node.js 18+](https://nodejs.org/) 설치

### 2. 의존성 설치

```bash
git clone <repo-url>
cd palworld-panel
npm install
```

### 3. 환경변수 설정

```bash
copy .env.example .env
```

`.env` 파일을 열어 서버 경로와 비밀번호를 설정하세요.

### 4. 실행

```bash
npm start
```

`http://localhost:3000` 으로 접속

## 환경변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `PANEL_PASSWORD` | 패널 로그인 비밀번호 | `admin` |
| `PORT` | 패널 웹 포트 | `3000` |
| `SESSION_SECRET` | 세션 시크릿 키 | 자동생성 |
| `PAL_SETTINGS_PATH` | PalWorldSettings.ini 경로 | Steam 기본 경로 |
| `PAL_SERVER_PATH` | PalServer.exe 경로 | Steam 기본 경로 |
| `PAL_SERVER_ARGS` | 서버 실행 인자 | `-log -stdlog -useperfthreads -NoAsyncLoadingThread -UseMultithreadForDS` |
| `PAL_SAVE_PATH` | 세이브 폴더 경로 (백업용) | 미설정 시 백업 비활성 |
| `PAL_BACKUP_ROOT` | 백업 저장 폴더 | 미설정 시 백업 비활성 |
| `PAL_LOG_PATH` | 팰월드 로그 파일 경로 | 서버 경로 기준 자동 설정 |
| `PLAYER_DATA_DIR` | 데이터 저장 폴더 (SQLite DB 등) | `./data` |
| `REST_API_ENABLED` | REST API 플레이어 감지 활성화 | `true` |
| `REST_API_HOST` | REST API 호스트 | `127.0.0.1` |
| `REST_API_PORT` | REST API 포트 | `8212` |
| `REST_API_USERNAME` | REST API 사용자명 | `admin` |
| `REST_API_PASSWORD` | REST API 비밀번호 (=AdminPassword) | `PANEL_PASSWORD` 사용 |
| `REST_API_POLL_INTERVAL` | REST API 폴링 간격 (ms) | `5000` |

## REST API 설정 (권장)

팰월드 서버의 REST API를 활성화하면 실시간 플레이어 감지, 공지 전송, 서버 저장 등의 기능을 사용할 수 있습니다.

### PalWorldSettings.ini 에서 설정

```ini
RESTAPIEnabled=True
RESTAPIPort=8212
AdminPassword="your-admin-password"
```

또는 웹 패널 > 서버 설정 탭에서 직접 변경 가능합니다.

### .env 에서 연결

```env
REST_API_ENABLED=true
REST_API_PORT=8212
REST_API_PASSWORD=your-admin-password
```

설정 변경 후 팰월드 서버를 재시작하면 패널에서 REST API 상태가 초록색으로 표시됩니다.

## 참고

- Windows 전용 (PalServer.exe 프로세스 관리, robocopy 백업)
- 포트 3000이 방화벽에서 허용되어야 외부 접속 가능
- 설정 변경 후 서버 재시작 필요
