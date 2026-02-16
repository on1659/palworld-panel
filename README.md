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

## 요구사항

- **Windows 10/11** (PalServer.exe 프로세스 관리, robocopy 백업)
- **Node.js 18+** ([다운로드](https://nodejs.org/))
- **팰월드 전용 서버** (Steam 또는 SteamCMD로 설치)

## 설치 및 실행

### 1. 프로젝트 다운로드

```bash
git clone https://github.com/on1659/palworld-panel.git
cd palworld-panel
```

### 2. 의존성 설치

```bash
npm install
```

`better-sqlite3` (네이티브 모듈)가 포함되어 있어 빌드 도구가 필요할 수 있습니다.
설치 중 에러가 나면 아래를 먼저 실행하세요:

```bash
npm install -g windows-build-tools
```

### 3. 환경변수 설정

```bash
copy .env.example .env
```

`.env` 파일을 메모장으로 열어 아래 항목들을 수정하세요:

```env
# [필수] 패널 로그인 비밀번호 (이 웹 패널 전용. 스팀 비밀번호 아님. 기본값 admin → 반드시 변경)
PANEL_PASSWORD=원하는비밀번호

# [필수] PalServer.exe 경로 (패널에서 서버 시작/정지에 사용)
PAL_SERVER_PATH=스팀에서의 내 팰월드 경로\PalServer\PalServer.exe

# [필수] PalWorldSettings.ini 경로 (설정 편집에 사용)
PAL_SETTINGS_PATH=스팀에서의 내 팰월드 경로\PalServer\Pal\Saved\Config\WindowsServer\PalWorldSettings.ini

# [권장] REST API 비밀번호 (PalWorldSettings.ini의 AdminPassword와 동일하게)
# 미설정 시 PANEL_PASSWORD 값 사용 (팰월드 서버 관리자 비밀번호, 스팀 비밀번호 아님)
REST_API_PASSWORD=원하는관리자비밀번호

# [선택] 백업 활성화 (둘 다 설정해야 작동)
PAL_SAVE_PATH=스팀에서의 내 팰월드 경로\PalServer\Pal\Saved\SaveGames\0\YOUR_WORLD_ID
PAL_BACKUP_ROOT=D:\PalworldBackups
```

> **스팀에서의 내 팰월드 경로** = Steam에 팰월드 서버를 설치한 폴더 경로 (예: `C:\Program Files (x86)\Steam\steamapps\common`)
> `YOUR_WORLD_ID`는 `SaveGames\0\` 폴더 안에 있는 16자리 영숫자 폴더명입니다.
> 예: `SaveGames\0\2F8A3B4C1D5E6F70`

### 4. 실행

```bash
npm start
```

브라우저에서 `http://localhost:3000` 으로 접속하세요.
`.env`에 설정한 `PANEL_PASSWORD`로 로그인합니다.

> **자동 설정:** 패널이 시작되면 PalWorldSettings.ini를 자동으로 확인하고,
> REST API 활성화(`RESTAPIEnabled=True`), 로그 설정(`LogFormatType=Text`) 등
> 패널에 필요한 설정을 자동으로 적용합니다. 수동으로 ini 파일을 편집할 필요가 없습니다.
> 서버가 이미 실행 중이면 재시작 후 적용됩니다.

### 5. (선택) 자동 시작 설정

패널을 Windows 시작 시 자동으로 실행하려면:

```bash
# StartServer.bat 같은 배치 파일을 만들어 시작 프로그램에 등록
cd /d "C:\경로\palworld-panel"
node server.js
```

또는 `pm2`를 사용하면 백그라운드 실행 + 자동 재시작이 가능합니다:

```bash
npm install -g pm2
pm2 start server.js --name palworld-panel
pm2 save
pm2 startup
```

## 데이터 & DB

첫 실행 시 `data/` 폴더가 자동 생성되며, 아래 파일들이 관리됩니다:

```
data/
├── palworld.db          # SQLite DB (플레이어 통계, 세션 기록)
├── player_list.txt      # 접속했던 플레이어 목록 (레거시, DB와 병행)
├── playtime.txt         # 누적 플레이타임 (레거시, DB와 병행)
└── presets/             # 서버 설정 프리셋 (JSON)
```

- **DB는 별도 설치 불필요** - `better-sqlite3`가 내장되어 있어 `npm install`만 하면 됩니다
- 기존에 `playtime.txt`/`player_list.txt`가 있으면 첫 실행 시 DB로 자동 마이그레이션
- 패널 재시작 시 DB에서 플레이어 이름과 접속 기록을 자동 복원
- `data/` 폴더를 백업하면 모든 통계 데이터를 보존할 수 있습니다

## 환경변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `PANEL_PASSWORD` | 패널 로그인 비밀번호 | `admin` |
| `PANEL_ICON` | 헤더·로그인 화면 아이콘 (이모지 1개) | `🎮` |
| `PORT` | 패널 웹 포트 | `3000` |
| `SESSION_SECRET` | 세션 시크릿 키 | 자동생성 |
| `PAL_SETTINGS_PATH` | PalWorldSettings.ini 경로 | 스팀에서의 내 팰월드 경로 기준 |
| `PAL_SERVER_PATH` | PalServer.exe 경로 | 스팀에서의 내 팰월드 경로 기준 |
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

- **아이콘:** 헤더/로그인 큰 아이콘은 `.env`의 `PANEL_ICON`(이모지 1개)으로 변경. 브라우저 탭 아이콘은 `public/favicon.ico` 파일을 넣으면 적용됩니다.

## REST API 설정 (권장)

팰월드 서버의 REST API를 활성화하면 실시간 플레이어 감지, 공지 전송, 서버 저장 등의 기능을 사용할 수 있습니다.

### 자동 적용

패널이 시작될 때 **PalWorldSettings.ini**에 아래 값을 자동으로 넣어 줍니다. ini를 직접 수정할 필요 없이 `.env`만 설정하면 됩니다.

- `RESTAPIEnabled=True`
- `RESTAPIPort=8212` (또는 `.env`의 `REST_API_PORT`)
- `AdminPassword` = `.env`의 `REST_API_PASSWORD` (미설정 시 `PANEL_PASSWORD` 사용)

웹 패널 > 서버 설정 탭에서 수동으로 바꿀 수도 있습니다.

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

**Palback 폴더 (스케줄러 백업):** `Palback/`의 `backup.bat`을 Windows 작업 스케줄러에 등록해 쓰는 경우, `palback_config.cmd.example`을 `palback_config.cmd`로 복사한 뒤 `PAL_SAVE_PATH`·`PAL_BACKUP_ROOT`를 설정하세요. `palback_config.cmd`는 Git에 올리지 마세요.

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

## 로그

패널 화면의 로그 영역에는 서버 시작/정지 등 동작이 최근 50줄까지 표시됩니다.

| 태그 | 설명 |
|------|------|
| `[수동]` | 웹 패널에서 버튼으로 조작 |
| `[자동재시작]` | 매일 오전 6시 자동 재시작 |
| `[공지]` | 종료 전 인게임 공지 전송 |
| `[알림]` | 접속 시간 알림 (매 시간) |
| `[REST-API]` | REST API 통신 |
| `[복원]` | 패널 시작 시 세션 복원 |

- 서버 실행 여부와 관계없이 항상 파일에 기록
- 웹 UI에는 최근 50줄만 표시

## 외부 접속 (ngrok / Cloudflare) (26.02.15 기준)

포트 포워딩 없이 HTTPS 터널로 패널을 열 수 있습니다. 대표적으로 **ngrok**과 **Cloudflare Tunnel(cloudflared)** 두 방식이 있습니다.

| | ngrok | Cloudflare Tunnel |
|---|--------|-------------------|
| **장점** | 설정 간단, 가입 후 바로 사용. **고정 URL** (무료도 동일) | 무료, 계정 세팅하면 **고정 URL** 사용 가능, Cloudflare 보안 기능 활용 |
| **단점** | 최초 접속 시 ngrok 보안/경고 화면이 한 번 뜸 | 초기 계정·도메인(또는 trycloudflare) 설정 필요 |

> 이 프로젝트에서는 **ngrok**을 사용합니다. 설정이 간단하고, 비밀번호 인증만으로도 쓰기 편해서 선택했습니다.

### ngrok 설정 방법

1. [ngrok 가입](https://dashboard.ngrok.com/signup) 후 설치
2. 인증 토큰 설정:
   ```bash
   ngrok config add-authtoken YOUR_AUTH_TOKEN
   ```
3. 패널 포트에 터널 실행:
   ```bash
   ngrok http 3000
   ```
4. 출력된 `https://xxxx.ngrok-free.dev` 주소로 외부 접속

Cloudflare 방식은 [Cloudflare Tunnel(cloudflared)](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) 문서를 참고하세요.

> **참고:** 이 프로젝트에서는 `StartServer.bat`에서 패널과 ngrok 터널을 함께 실행하도록 설정되어 있습니다. 로컬 전용이면 ngrok 없이 `npm start`만으로 충분합니다.

## 개발 계획

- **서버 업데이트 (SteamCMD)**  
  SteamCMD를 이용해 패널에서 원클릭으로 팰월드 서버를 업데이트하는 기능에 대한 개발 계획 문서가 `docs/`에 있습니다. **현재는 계획만 세워둔 상태이며, 아직 구현되지 않았습니다.**  
  → [docs/glistening-twirling-newell.md](docs/glistening-twirling-newell.md)

## 참고

- Windows 전용 (PalServer.exe 프로세스 관리, robocopy 백업)
- 설정 변경 후 서버 재시작 필요
- 패널에서 서버를 시작하면 `detached` 모드로 실행되므로 패널을 종료해도 서버는 계속 실행됨
