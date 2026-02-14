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

## 서버 종료 방식

패널에서 서버를 정지하면 접속 중인 플레이어 수에 따라 동작이 달라집니다.

| 상황 | 동작 |
|------|------|
| 접속자 없음 | 확인 후 바로 종료 |
| 접속자 있음 | 종료 확인 모달 표시 → 60초 공지 후 종료 |
| 강제 종료 | 공지 배너에서 "지금 바로 종료" 클릭 시 즉시 종료 |

REST API가 비활성화된 경우 `taskkill`로 프로세스를 직접 종료합니다.

## 자동 백업

`.env`에 `PAL_SAVE_PATH`와 `PAL_BACKUP_ROOT`를 모두 설정하면 자동 백업이 활성화됩니다.

- 서버 가동 중 **3시간마다** 자동 백업 실행
- 백업 전 REST API로 서버 월드 저장 요청 (데이터 손실 방지)
- **24시간 지난 백업** 자동 삭제
- `robocopy`를 사용하므로 Windows에서만 동작
- 수동 백업은 패널의 "백업하기" 버튼으로 가능

백업 폴더 구조:
```
PAL_BACKUP_ROOT/
├── PalServerSave_20260214T120000/
├── PalServerSave_20260214T150000/
└── ...
```

## 접속 통계 & 데이터

플레이어 접속 데이터는 `data/palworld.db` (SQLite)에 저장됩니다.

- **players 테이블** - 플레이어 ID, 이름, 최초/최근 접속 시간
- **sessions 테이블** - 개별 접속 세션 (접속 시간, 퇴장 시간, 플레이 시간)
- 기존 `playtime.txt` 파일이 있으면 첫 실행 시 자동 마이그레이션
- 패널 재시작 시 열린 세션에서 온라인 상태를 복원

통계 대시보드에서 3가지 탭을 확인할 수 있습니다:
- **플레이어 통계** - 누적 플레이타임, 접속 횟수 순위
- **일별 통계** - 최근 30일 고유 접속자, 세션 수
- **최근 세션** - 최근 50개 접속/퇴장 기록

## 설정 편집 카테고리

웹 패널에서 편집 가능한 PalWorldSettings.ini 설정 항목:

| 카테고리 | 설정 예시 |
|----------|-----------|
| 기본설정 | 서버 이름, 비밀번호, 포트, 최대 인원, RCON, REST API |
| 전투 | 팰/플레이어 공격력·방어력, PvP, 사망 페널티 |
| 캡처 | 포획률, 스폰 배율, 미접속 페널티 |
| 경험치/드랍 | 경험치 배율, 알 부화 시간, 채집·적 드랍률 |
| 생존 | 배고픔·스태미나 감소율, HP 자동회복 |
| 길드 | 길드 최대 인원, 거점 수, 배치 팰 수 |
| 기타 | 낮/밤 속도, 건축물 피해, 멀티플레이 설정 |

서버 실행 중에는 REST API에서 현재 적용된 값을 가져오고, 정지 상태에서는 ini 파일에서 읽습니다.

## 참고

- Windows 전용 (PalServer.exe 프로세스 관리, robocopy 백업)
- 포트 3000이 방화벽에서 허용되어야 외부 접속 가능
- 설정 변경 후 서버 재시작 필요
- 패널에서 서버를 시작하면 `detached` 모드로 실행되므로 패널을 종료해도 서버는 계속 실행됨
- REST API 폴링 로그(`/v1/api/players` 등)는 패널 로그에서 자동 필터링됨
