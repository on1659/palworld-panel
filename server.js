require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const http = require('http');
const Database = require('better-sqlite3');
const { spawn, execSync, spawnSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

const DEFAULT_SETTINGS_PATH = String.raw`C:\Program Files (x86)\Steam\steamapps\common\PalServer\Pal\Saved\Config\WindowsServer\PalWorldSettings.ini`;
const DEFAULT_SERVER_PATH = String.raw`C:\Program Files (x86)\Steam\steamapps\common\PalServer\PalServer.exe`;

const SETTINGS_PATH = process.env.PAL_SETTINGS_PATH || DEFAULT_SETTINGS_PATH;
const SERVER_PATH = process.env.PAL_SERVER_PATH || DEFAULT_SERVER_PATH;
const SERVER_ARGS = (process.env.PAL_SERVER_ARGS || '-log -stdlog -useperfthreads -NoAsyncLoadingThread -UseMultithreadForDS').split(' ').filter(Boolean);
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || 'admin';
const PAL_SAVE_PATH = process.env.PAL_SAVE_PATH || '';
const PAL_BACKUP_ROOT = process.env.PAL_BACKUP_ROOT || '';
const PAL_LOG_PATH = process.env.PAL_LOG_PATH || path.join(path.dirname(SERVER_PATH), 'Pal', 'Saved', 'Logs', 'Pal-CRC.log');
const PLAYER_DATA_DIR = process.env.PLAYER_DATA_DIR || path.join(__dirname, 'data');
const PLAYER_LIST_FILE = path.join(PLAYER_DATA_DIR, 'player_list.txt');
const PLAYTIME_FILE = path.join(PLAYER_DATA_DIR, 'playtime.txt');
const PANEL_SERVER_LOG_FILE = path.join(PLAYER_DATA_DIR, 'panel_server_log.txt');
const DB_PATH = path.join(PLAYER_DATA_DIR, 'palworld.db');

// --- SQLite DB 초기화 ---
if (!fs.existsSync(PLAYER_DATA_DIR)) fs.mkdirSync(PLAYER_DATA_DIR, { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL'); // 성능 향상
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    userId TEXT PRIMARY KEY,
    displayName TEXT NOT NULL DEFAULT '',
    firstSeen INTEGER NOT NULL,
    lastSeen INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    displayName TEXT NOT NULL DEFAULT '',
    joinTime INTEGER NOT NULL,
    leaveTime INTEGER,
    durationMinutes REAL,
    FOREIGN KEY (userId) REFERENCES players(userId)
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_userId ON sessions(userId);
  CREATE INDEX IF NOT EXISTS idx_sessions_joinTime ON sessions(joinTime);
`);

// Prepared statements
const dbStmts = {
  upsertPlayer: db.prepare(`
    INSERT INTO players (userId, displayName, firstSeen, lastSeen)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(userId) DO UPDATE SET
      displayName = excluded.displayName,
      lastSeen = excluded.lastSeen
  `),
  openSession: db.prepare(`
    INSERT INTO sessions (userId, displayName, joinTime) VALUES (?, ?, ?)
  `),
  closeSession: db.prepare(`
    UPDATE sessions SET leaveTime = ?, durationMinutes = ?
    WHERE userId = ? AND leaveTime IS NULL
  `),
  getOpenSessions: db.prepare(`
    SELECT * FROM sessions WHERE leaveTime IS NULL
  `),
  hasOpenSession: db.prepare(`
    SELECT id FROM sessions WHERE userId = ? AND leaveTime IS NULL LIMIT 1
  `),
  getPlayerStats: db.prepare(`
    SELECT p.userId, p.displayName, p.firstSeen, p.lastSeen,
           COUNT(s.id) as totalSessions,
           COALESCE(SUM(
             CASE WHEN s.leaveTime IS NOT NULL THEN s.durationMinutes
                  ELSE (? - s.joinTime) / 60000.0
             END
           ), 0) as totalPlaytimeMinutes,
           MAX(CASE WHEN s.leaveTime IS NULL THEN 1 ELSE 0 END) as isOnline
    FROM players p
    LEFT JOIN sessions s ON p.userId = s.userId
    GROUP BY p.userId
    ORDER BY totalPlaytimeMinutes DESC
  `),
  getRecentSessions: db.prepare(`
    SELECT s.*, p.displayName as playerName
    FROM sessions s
    JOIN players p ON s.userId = p.userId
    ORDER BY s.joinTime DESC
    LIMIT ?
  `),
  getDailyStats: db.prepare(`
    SELECT date(joinTime / 1000, 'unixepoch', 'localtime') as day,
           COUNT(DISTINCT userId) as uniquePlayers,
           COUNT(*) as totalSessions,
           COALESCE(SUM(
             CASE WHEN leaveTime IS NOT NULL THEN durationMinutes
                  ELSE (? - joinTime) / 60000.0
             END
           ), 0) as totalMinutes
    FROM sessions
    WHERE joinTime >= ?
    GROUP BY day
    ORDER BY day DESC
  `),
  getPlayerSessions: db.prepare(`
    SELECT * FROM sessions WHERE userId = ? ORDER BY joinTime DESC LIMIT ?
  `)
};

// REST API 설정 (플레이어 접속 감지용)
const REST_API_ENABLED = process.env.REST_API_ENABLED !== 'false';
const REST_API_HOST = process.env.REST_API_HOST || '127.0.0.1';
const REST_API_PORT = process.env.REST_API_PORT || '8212';
const REST_API_USERNAME = process.env.REST_API_USERNAME || 'admin';
const REST_API_PASSWORD = process.env.REST_API_PASSWORD || process.env.PANEL_PASSWORD;
const REST_API_POLL_INTERVAL = parseInt(process.env.REST_API_POLL_INTERVAL || '5000', 10);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'palworld-panel-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// --- Auth middleware ---
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: '인증 필요' });
  res.redirect('/login');
}

// --- Settings definitions ---
const SETTING_DEFS = [
  // 기본설정
  { key: 'ServerName', label: '서버 이름', desc: '서버 목록에 표시되는 이름', category: '기본설정', type: 'text', default: 'Default Palworld Server' },
  { key: 'ServerDescription', label: '서버 설명', desc: '서버 설명', category: '기본설정', type: 'text', default: '' },
  { key: 'AdminPassword', label: '관리자 비밀번호', desc: '인게임 관리자 명령어용', category: '기본설정', type: 'text', default: '' },
  { key: 'ServerPassword', label: '서버 비밀번호', desc: '접속 시 필요한 비밀번호', category: '기본설정', type: 'text', default: '' },
  { key: 'PublicPort', label: '서버 포트', desc: '기본값 8211', category: '기본설정', type: 'number', default: 8211, min: 1, max: 65535 },
  { key: 'ServerPlayerMaxNum', label: '최대 플레이어 수', desc: '기본값 32', category: '기본설정', type: 'number', default: 32, min: 1, max: 32 },
  { key: 'PublicIP', label: '공개 IP', desc: '서버 공개 IP', category: '기본설정', type: 'text', default: '' },
  { key: 'RCONEnabled', label: 'RCON 활성화', desc: '원격 콘솔 활성화', category: '기본설정', type: 'boolean', default: false },
  { key: 'RCONPort', label: 'RCON 포트', desc: '기본값 25575', category: '기본설정', type: 'number', default: 25575, min: 1, max: 65535 },
  { key: 'RESTAPIEnabled', label: 'REST API 활성화', desc: '플레이어 목록 조회용 REST API (권장). 적용 후 재시작 필요', category: '기본설정', type: 'boolean', default: false },
  { key: 'RESTAPIPort', label: 'REST API 포트', desc: '기본값 8212. AdminPassword로 인증', category: '기본설정', type: 'number', default: 8212, min: 1, max: 65535 },
  { key: 'LogFormatType', label: '로그 형식', desc: '서버 로그 파일 형식. Text 권장(접속 현황 파싱용). 적용 후 재시작 필요', category: '기본설정', type: 'select', default: 'Text', options: ['Text', 'Json'] },
  { key: 'bIsShowJoinLeftMessage', label: '접속/퇴장 메시지 표시', desc: '전용 서버에서 접속·퇴장 시 인게임 및 로그에 메시지 표시. 끄면 로그에 안 남을 수 있음', category: '기본설정', type: 'boolean', default: true },
  { key: 'bEnablePlayerLogging', label: '플레이어 로깅', desc: '플레이어 관련 로그 출력 여부. 로그가 안 남을 때 True로 설정 후 재시작', category: '기본설정', type: 'boolean', default: true },

  // 전투
  { key: 'PalDamageRateAttack', label: '팰 공격력 배율', desc: '기본값 1.0', category: '전투', type: 'slider', default: 1.0, min: 0.1, max: 5.0, step: 0.1 },
  { key: 'PalDamageRateDefense', label: '팰 방어력 배율', desc: '기본값 1.0', category: '전투', type: 'slider', default: 1.0, min: 0.1, max: 5.0, step: 0.1 },
  { key: 'PlayerDamageRateAttack', label: '플레이어 공격력 배율', desc: '기본값 1.0', category: '전투', type: 'slider', default: 1.0, min: 0.1, max: 5.0, step: 0.1 },
  { key: 'PlayerDamageRateDefense', label: '플레이어 방어력 배율', desc: '기본값 1.0', category: '전투', type: 'slider', default: 1.0, min: 0.1, max: 5.0, step: 0.1 },
  { key: 'bEnablePlayerToPlayerDamage', label: 'PvP 활성화', desc: '플레이어 간 데미지 허용', category: '전투', type: 'boolean', default: false },
  { key: 'bEnableFriendlyFire', label: '아군 피해 활성화', desc: '같은 길드원 간 데미지', category: '전투', type: 'boolean', default: false },
  { key: 'bActiveUNKO', label: 'UNKO 활성화', desc: '', category: '전투', type: 'boolean', default: false },
  { key: 'bEnableAimAssistPad', label: '패드 조준 보조', desc: '컨트롤러 에임 어시스트', category: '전투', type: 'boolean', default: true },
  { key: 'bEnableAimAssistKeyboard', label: '키보드 조준 보조', desc: '키보드/마우스 에임 어시스트', category: '전투', type: 'boolean', default: false },
  { key: 'DeathPenalty', label: '사망 페널티', desc: 'None/Item/ItemAndEquipment/All', category: '전투', type: 'select', default: 'All', options: ['None', 'Item', 'ItemAndEquipment', 'All'] },

  // 캡처
  { key: 'PalCaptureRate', label: '팰 포획률 배율', desc: '기본값 1.0 (높을수록 쉬움)', category: '캡처', type: 'slider', default: 1.0, min: 0.1, max: 5.0, step: 0.1 },
  { key: 'PalSpawnNumRate', label: '팰 스폰 배율', desc: '기본값 1.0', category: '캡처', type: 'slider', default: 1.0, min: 0.1, max: 5.0, step: 0.1 },
  { key: 'bEnableNonLoginPenalty', label: '미접속 페널티', desc: '장기 미접속 시 팰 배고픔', category: '캡처', type: 'boolean', default: true },

  // 경험치/드랍
  { key: 'ExpRate', label: '경험치 배율', desc: '기본값 1.0', category: '경험치/드랍', type: 'slider', default: 1.0, min: 0.1, max: 20.0, step: 0.1 },
  { key: 'PalEggDefaultHatchingTime', label: '알 부화 시간(h)', desc: '기본값 72시간', category: '경험치/드랍', type: 'number', default: 72, min: 0, max: 240 },
  { key: 'CollectionDropRate', label: '채집 드랍률 배율', desc: '기본값 1.0', category: '경험치/드랍', type: 'slider', default: 1.0, min: 0.1, max: 10.0, step: 0.1 },
  { key: 'CollectionObjectHpRate', label: '채집 오브젝트 HP 배율', desc: '기본값 1.0 (낮을수록 빨리 부서짐)', category: '경험치/드랍', type: 'slider', default: 1.0, min: 0.1, max: 5.0, step: 0.1 },
  { key: 'CollectionObjectRespawnSpeedRate', label: '채집 리스폰 속도 배율', desc: '기본값 1.0', category: '경험치/드랍', type: 'slider', default: 1.0, min: 0.1, max: 5.0, step: 0.1 },
  { key: 'EnemyDropItemRate', label: '적 드랍 아이템 배율', desc: '기본값 1.0', category: '경험치/드랍', type: 'slider', default: 1.0, min: 0.1, max: 10.0, step: 0.1 },

  // 생존
  { key: 'PlayerStomachDecreaceRate', label: '플레이어 배고픔 감소율', desc: '기본값 1.0 (높을수록 빨리 배고파짐)', category: '생존', type: 'slider', default: 1.0, min: 0.1, max: 5.0, step: 0.1 },
  { key: 'PalStomachDecreaceRate', label: '팰 배고픔 감소율', desc: '기본값 1.0', category: '생존', type: 'slider', default: 1.0, min: 0.1, max: 5.0, step: 0.1 },
  { key: 'PlayerStaminaDecreaceRate', label: '플레이어 스태미나 감소율', desc: '기본값 1.0', category: '생존', type: 'slider', default: 1.0, min: 0.1, max: 5.0, step: 0.1 },
  { key: 'PlayerAutoHPRegeneRate', label: '플레이어 HP 자동회복', desc: '기본값 1.0', category: '생존', type: 'slider', default: 1.0, min: 0.1, max: 5.0, step: 0.1 },
  { key: 'PlayerAutoHpRegeneRateInSleep', label: '수면 시 HP 회복률', desc: '기본값 1.0', category: '생존', type: 'slider', default: 1.0, min: 0.1, max: 5.0, step: 0.1 },
  { key: 'PalAutoHPRegeneRate', label: '팰 HP 자동회복', desc: '기본값 1.0', category: '생존', type: 'slider', default: 1.0, min: 0.1, max: 5.0, step: 0.1 },
  { key: 'PalAutoHpRegeneRateInSleep', label: '팰 수면 시 HP 회복률', desc: '기본값 1.0 (거점)', category: '생존', type: 'slider', default: 1.0, min: 0.1, max: 5.0, step: 0.1 },

  // 길드
  { key: 'GuildPlayerMaxNum', label: '길드 최대 인원', desc: '기본값 20', category: '길드', type: 'number', default: 20, min: 1, max: 100 },
  { key: 'BaseCampMaxNum', label: '거점 최대 수', desc: '기본값 128', category: '길드', type: 'number', default: 128, min: 1, max: 500 },
  { key: 'BaseCampWorkerMaxNum', label: '거점 배치 팰 수', desc: '기본값 15', category: '길드', type: 'number', default: 15, min: 1, max: 50 },

  // 기타
  { key: 'DayTimeSpeedRate', label: '낮 시간 속도', desc: '기본값 1.0', category: '기타', type: 'slider', default: 1.0, min: 0.1, max: 5.0, step: 0.1 },
  { key: 'NightTimeSpeedRate', label: '밤 시간 속도', desc: '기본값 1.0', category: '기타', type: 'slider', default: 1.0, min: 0.1, max: 5.0, step: 0.1 },
  { key: 'BuildObjectDamageRate', label: '건축물 피해 배율', desc: '기본값 1.0', category: '기타', type: 'slider', default: 1.0, min: 0.1, max: 5.0, step: 0.1 },
  { key: 'BuildObjectDeteriorationDamageRate', label: '건축물 노후화 배율', desc: '기본값 1.0 (0으로 비활성화)', category: '기타', type: 'slider', default: 1.0, min: 0, max: 5.0, step: 0.1 },
  { key: 'bIsMultiplay', label: '멀티플레이', desc: '멀티플레이 활성화', category: '기타', type: 'boolean', default: false },
  { key: 'bIsPvP', label: 'PvP 모드', desc: 'PvP 서버 여부', category: '기타', type: 'boolean', default: false },
  { key: 'CoopPlayerMaxNum', label: '협동 최대 인원', desc: '기본값 4', category: '기타', type: 'number', default: 4, min: 1, max: 32 },
  { key: 'DropItemMaxNum', label: '바닥 아이템 최대 수', desc: '기본값 3000', category: '기타', type: 'number', default: 3000, min: 100, max: 10000 },
  { key: 'bAutoResetGuildNoOnlinePlayers', label: '비활성 길드 자동 리셋', desc: '온라인 멤버 없는 길드 리셋', category: '기타', type: 'boolean', default: false },
  { key: 'AutoResetGuildTimeNoOnlinePlayers', label: '길드 리셋 시간(h)', desc: '기본값 72시간', category: '기타', type: 'number', default: 72, min: 1, max: 720 },
];

// --- INI Parser ---
function parseSettings(content) {
  const settings = {};
  // PalWorldSettings.ini format: [/Script/Pal.PalGameWorldSettings] then OptionSettings=(Key=Val,Key=Val,...)
  const match = content.match(/OptionSettings=\(([^)]*)\)/);
  if (!match) return settings;
  const raw = match[1];
  // Parse key=value pairs (handle quoted strings)
  const regex = /(\w+)=("(?:[^"\\]|\\.)*"|[^,]*)/g;
  let m;
  while ((m = regex.exec(raw)) !== null) {
    let val = m[2];
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    settings[m[1]] = val;
  }
  return settings;
}

function buildIniContent(settings) {
  const pairs = Object.entries(settings).map(([k, v]) => {
    if (typeof v === 'string' && !/^[\d.]+$/.test(v) && v !== 'True' && v !== 'False' && !['None','Item','ItemAndEquipment','All','Text','Json'].includes(v)) {
      return `${k}="${v}"`;
    }
    return `${k}=${v}`;
  }).join(',');
  return `[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(${pairs})\n`;
}

function readSettings() {
  try {
    const content = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    return parseSettings(content);
  } catch (e) {
    console.error('설정 파일 읽기 실패:', e.message);
    return null;
  }
}

function writeSettings(settings) {
  const content = buildIniContent(settings);
  // Ensure directory exists
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, content, 'utf-8');
}

// --- REST API Client (플레이어 접속 감지용) ---
class RestApiClient {
  constructor() {
    this.lastSnapshot = [];
    this.isAvailable = false;
    this.lastError = null;
  }

  async getPlayers() {
    return new Promise((resolve, reject) => {
      const auth = 'Basic ' + Buffer.from(`${REST_API_USERNAME}:${REST_API_PASSWORD}`).toString('base64');
      const options = {
        hostname: REST_API_HOST,
        port: REST_API_PORT,
        path: '/v1/api/players',
        method: 'GET',
        headers: {
          'Authorization': auth,
          'Accept': 'application/json'
        },
        timeout: 3000
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const json = JSON.parse(data);
              this.isAvailable = true;
              this.lastError = null;
              resolve(json);
            } catch (e) {
              this.isAvailable = false;
              this.lastError = 'Invalid JSON: ' + e.message;
              reject(new Error('Invalid JSON: ' + e.message));
            }
          } else if (res.statusCode === 401) {
            this.isAvailable = false;
            this.lastError = 'Authentication failed (401)';
            reject(new Error('REST API auth failed'));
          } else {
            this.isAvailable = false;
            this.lastError = `HTTP ${res.statusCode}`;
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('error', (e) => {
        this.isAvailable = false;
        this.lastError = e.message;
        reject(e);
      });

      req.on('timeout', () => {
        req.destroy();
        this.isAvailable = false;
        this.lastError = 'Connection timeout';
        reject(new Error('REST API timeout'));
      });

      req.end();
    });
  }

  normalizePlayerId(player) {
    // Try userId first (Steam ID), fallback to playerId, then accountName
    return normalizePlayerKey(player.userId || player.playerId || player.accountName || '');
  }

  async checkAndDetectChanges() {
    if (!isServerRunning()) {
      this.lastSnapshot = [];
      return { joins: [], leaves: [] };
    }

    try {
      const response = await this.getPlayers();
      const players = response.players || [];

      // Store player names (userId -> name mapping)
      for (const player of players) {
        const userId = this.normalizePlayerId(player);
        const displayName = player.name || player.accountName || userId;
        if (userId) {
          playerNames[userId] = displayName;
        }
      }

      const currentIds = new Set(players.map(p => this.normalizePlayerId(p)));
      const previousIds = new Set(this.lastSnapshot);

      const joins = [...currentIds].filter(id => !previousIds.has(id));
      const leaves = [...previousIds].filter(id => !currentIds.has(id));

      this.lastSnapshot = [...currentIds];

      return { joins, leaves, players };
    } catch (e) {
      // REST API unavailable - return empty, log parser will handle
      return { joins: [], leaves: [], error: e.message };
    }
  }

  /**
   * 서버 정상 종료 (플레이어에게 경고 메시지 표시)
   * @param {number} waittime - 종료까지 대기 시간(초)
   * @param {string} message - 플레이어에게 표시할 메시지
   */
  async shutdown(waittime = 30, message = '서버가 곧 종료됩니다') {
    return new Promise((resolve, reject) => {
      const auth = 'Basic ' + Buffer.from(`${REST_API_USERNAME}:${REST_API_PASSWORD}`).toString('base64');
      const postData = JSON.stringify({ waittime, message });

      const options = {
        hostname: REST_API_HOST,
        port: REST_API_PORT,
        path: '/v1/api/shutdown',
        method: 'POST',
        headers: {
          'Authorization': auth,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 5000
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve({ success: true, message: `서버가 ${waittime}초 후 종료됩니다` });
          } else if (res.statusCode === 401) {
            reject(new Error('REST API 인증 실패'));
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('error', (e) => reject(e));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('REST API timeout'));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * 서버 즉시 강제 종료
   */
  async stop() {
    return new Promise((resolve, reject) => {
      const auth = 'Basic ' + Buffer.from(`${REST_API_USERNAME}:${REST_API_PASSWORD}`).toString('base64');

      const options = {
        hostname: REST_API_HOST,
        port: REST_API_PORT,
        path: '/v1/api/stop',
        method: 'POST',
        headers: {
          'Authorization': auth
        },
        timeout: 5000
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve({ success: true, message: '서버를 강제 종료했습니다' });
          } else if (res.statusCode === 401) {
            reject(new Error('REST API 인증 실패'));
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('error', (e) => reject(e));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('REST API timeout'));
      });

      req.end();
    });
  }

  /**
   * 서버 전체 공지 메시지 전송
   * @param {string} message - 공지할 메시지
   */
  async announce(message) {
    return new Promise((resolve, reject) => {
      const auth = 'Basic ' + Buffer.from(`${REST_API_USERNAME}:${REST_API_PASSWORD}`).toString('base64');
      const postData = JSON.stringify({ message });

      const options = {
        hostname: REST_API_HOST,
        port: REST_API_PORT,
        path: '/v1/api/announce',
        method: 'POST',
        headers: {
          'Authorization': auth,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 5000
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve({ success: true, message: '공지를 전송했습니다' });
          } else if (res.statusCode === 401) {
            reject(new Error('REST API 인증 실패'));
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('error', (e) => reject(e));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('REST API timeout'));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * 서버 월드 저장 (메모리 → 디스크)
   */
  async save() {
    return new Promise((resolve, reject) => {
      const auth = 'Basic ' + Buffer.from(`${REST_API_USERNAME}:${REST_API_PASSWORD}`).toString('base64');

      const options = {
        hostname: REST_API_HOST,
        port: REST_API_PORT,
        path: '/v1/api/save',
        method: 'POST',
        headers: { 'Authorization': auth },
        timeout: 10000
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve({ success: true, message: '서버 저장 완료' });
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('error', (e) => reject(e));
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.end();
    });
  }

  /**
   * 서버 현재 설정값 조회
   */
  async getSettings() {
    return new Promise((resolve, reject) => {
      const auth = 'Basic ' + Buffer.from(`${REST_API_USERNAME}:${REST_API_PASSWORD}`).toString('base64');

      const options = {
        hostname: REST_API_HOST,
        port: REST_API_PORT,
        path: '/v1/api/settings',
        method: 'GET',
        headers: {
          'Authorization': auth,
          'Accept': 'application/json'
        },
        timeout: 3000
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error('Invalid JSON'));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('error', (e) => reject(e));
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.end();
    });
  }
}

const restApiClient = new RestApiClient();

// --- Server management ---
let serverProcess = null;
let serverLogs = [];
const MAX_LOG_LINES = 50;
let stdoutLineBuf = '';
let stderrLineBuf = '';

function addLog(line) {
  const timestamp = new Date().toLocaleTimeString('ko-KR');
  const entry = `[${timestamp}] ${line}`;
  serverLogs.push(entry);
  if (serverLogs.length > MAX_LOG_LINES) serverLogs.shift();
  if (serverProcess) {
    try {
      if (!fs.existsSync(PLAYER_DATA_DIR)) fs.mkdirSync(PLAYER_DATA_DIR, { recursive: true });
      fs.appendFileSync(PANEL_SERVER_LOG_FILE, entry + '\n', 'utf-8');
    } catch (_) {}
  }
}

// --- Player state (REST API only) ---
const currentOnline = new Set();
const everConnected = new Set();
const joinTime = {};
let playtime = {};
const playerNames = {}; // userId -> displayName mapping

function normalizePlayerKey(s) {
  if (!s || typeof s !== 'string') return '';
  return s.trim().replace(/\s+/g, ' ');
}

function loadPlayerList() {
  try {
    if (fs.existsSync(PLAYER_LIST_FILE)) {
      const content = fs.readFileSync(PLAYER_LIST_FILE, 'utf-8');
      content.split('\n').forEach(line => {
        const k = line.trim();
        if (k) everConnected.add(k);
      });
    }
  } catch (_) {}
}

function savePlayerList() {
  try {
    if (!fs.existsSync(PLAYER_DATA_DIR)) fs.mkdirSync(PLAYER_DATA_DIR, { recursive: true });
    fs.writeFileSync(PLAYER_LIST_FILE, [...everConnected].sort().join('\n'), 'utf-8');
  } catch (_) {}
}

function loadPlaytime() {
  try {
    if (fs.existsSync(PLAYTIME_FILE)) {
      const content = fs.readFileSync(PLAYTIME_FILE, 'utf-8');
      playtime = {};
      content.split('\n').forEach(line => {
        const idx = line.indexOf('\t');
        if (idx > 0) {
          const key = line.slice(0, idx).trim();
          const mins = parseFloat(line.slice(idx + 1)) || 0;
          if (key) playtime[key] = (playtime[key] || 0) + mins;
        }
      });
    }
  } catch (_) {}
}

function savePlaytime() {
  try {
    if (!fs.existsSync(PLAYER_DATA_DIR)) fs.mkdirSync(PLAYER_DATA_DIR, { recursive: true });
    const lines = Object.entries(playtime).map(([k, v]) => `${k}\t${v.toFixed(2)}`).sort((a, b) => a.localeCompare(b));
    fs.writeFileSync(PLAYTIME_FILE, lines.join('\n'), 'utf-8');
  } catch (_) {}
}

function getPlayersState() {
  if (!isServerRunning()) {
    currentOnline.clear();
  }
  return {
    online: [...currentOnline].sort(),
    members: [...everConnected].sort(),
    playtime: { ...playtime },
    playerNames: { ...playerNames },
    detectionMethod: {
      enabled: REST_API_ENABLED,
      available: restApiClient.isAvailable,
      error: restApiClient.lastError,
      endpoint: `http://${REST_API_HOST}:${REST_API_PORT}/v1/api/players`
    }
  };
}

// --- REST API Polling & Reconciliation ---
async function pollRestApi() {
  if (!REST_API_ENABLED || !isServerRunning()) return;

  const result = await restApiClient.checkAndDetectChanges();
  const now = Date.now();

  if (result.error) {
    // REST API unavailable - logs will handle detection
    return;
  }

  // Process joins detected by REST API
  for (const playerId of result.joins) {
    if (!currentOnline.has(playerId)) {
      currentOnline.add(playerId);
      everConnected.add(playerId);
      joinTime[playerId] = now;
      const name = playerNames[playerId] || playerId;
      addLog(`[REST-API] Player joined: ${name}`);
      savePlayerList();

      // DB: upsert player & open session (중복 방지)
      try {
        dbStmts.upsertPlayer.run(playerId, name, now, now);
        if (!dbStmts.hasOpenSession.get(playerId)) {
          dbStmts.openSession.run(playerId, name, now);
        }
      } catch (e) { console.error('DB write error (join):', e.message); }
    }
  }

  // Process leaves detected by REST API
  for (const playerId of result.leaves) {
    if (currentOnline.has(playerId)) {
      currentOnline.delete(playerId);
      const name = playerNames[playerId] || playerId;
      if (joinTime[playerId]) {
        const mins = (now - joinTime[playerId]) / 60000;
        playtime[playerId] = (playtime[playerId] || 0) + mins;
        savePlaytime();
        addLog(`[REST-API] Player left: ${name} (session: ${mins.toFixed(1)}m)`);
        delete joinTime[playerId];

        // DB: close session
        try {
          dbStmts.closeSession.run(now, mins, playerId);
          dbStmts.upsertPlayer.run(playerId, name, now, now);
        } catch (e) { console.error('DB write error (leave):', e.message); }
      }
    }
  }

  // Reconciliation: Trust REST API as source of truth
  if (result.players) {
    const restPlayerIds = new Set(result.players.map(p => restApiClient.normalizePlayerId(p)));
    for (const id of restPlayerIds) {
      if (!currentOnline.has(id)) {
        currentOnline.add(id);
        everConnected.add(id);
        joinTime[id] = now;
        const name = playerNames[id] || id;
        addLog(`[REST-API] Player detected (reconciliation): ${name}`);
        savePlayerList();

        // DB: upsert player & open session (중복 방지)
        try {
          dbStmts.upsertPlayer.run(id, name, now, now);
          if (!dbStmts.hasOpenSession.get(id)) {
            dbStmts.openSession.run(id, name, now);
          }
        } catch (e) { console.error('DB write error (reconciliation):', e.message); }
      }
    }
  }
}

function getPalServerPids() {
  if (process.platform !== 'win32') return [];
  const pids = [];
  try {
    const out = execSync('tasklist /FO CSV /NH', { encoding: 'utf8', windowsHide: true });
    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.indexOf('PalServer') === -1) continue;
      const parts = trimmed.split('","');
      if (parts.length >= 2) {
        const pid = parts[1].replace(/^"|"/g, '').trim();
        if (/^\d+$/.test(pid)) pids.push(pid);
      }
    }
  } catch (_) {}
  return pids;
}

function isServerRunning() {
  if (process.platform === 'win32') {
    const pids = getPalServerPids();
    if (pids.length > 0) return true;
  }
  return serverProcess !== null && serverProcess.exitCode === null;
}

function startServer() {
  if (isServerRunning()) return { success: false, message: '서버가 이미 실행 중입니다.' };
  try {
    addLog('서버 시작 중...');
    serverProcess = spawn(SERVER_PATH, SERVER_ARGS, {
      cwd: path.dirname(SERVER_PATH),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false
    });
    const REST_API_LOG_FILTER = /v1\/api\/(players|info|settings|metrics|announce|save|stop|shutdown)\s/i;
    function flushLines(buf, isErr) {
      const lines = buf.split('\n');
      const last = lines.pop() || '';
      lines.forEach(l => {
        if (l.trim() && !(!isErr && REST_API_LOG_FILTER.test(l))) {
          addLog(isErr ? '[ERR] ' + l : l);
        }
      });
      return last;
    }
    serverProcess.stdout.on('data', d => {
      stdoutLineBuf += d.toString();
      stdoutLineBuf = flushLines(stdoutLineBuf, false);
    });
    serverProcess.stderr.on('data', d => {
      stderrLineBuf += d.toString();
      stderrLineBuf = flushLines(stderrLineBuf, true);
    });
    serverProcess.on('close', code => {
      if (stdoutLineBuf.trim()) addLog(stdoutLineBuf);
      if (stderrLineBuf.trim()) addLog('[ERR] ' + stderrLineBuf);
      stdoutLineBuf = '';
      stderrLineBuf = '';
      addLog(`서버 프로세스 종료 (코드: ${code})`);
      serverProcess = null;
    });
    serverProcess.unref();
    addLog('서버 시작 명령 전송 완료');
    return { success: true, message: '서버를 시작했습니다.' };
  } catch (e) {
    addLog('서버 시작 실패: ' + e.message);
    return { success: false, message: '서버 시작 실패: ' + e.message };
  }
}

async function runBackup() {
  if (process.platform !== 'win32') return { success: false, message: '백업은 Windows에서만 지원됩니다.' };
  if (!PAL_SAVE_PATH || !PAL_BACKUP_ROOT) {
    return { success: false, message: '.env에 PAL_SAVE_PATH, PAL_BACKUP_ROOT를 설정하세요.' };
  }
  if (!fs.existsSync(PAL_SAVE_PATH)) {
    return { success: false, message: '세이브 경로가 없습니다: ' + PAL_SAVE_PATH };
  }
  // REST API로 먼저 서버 저장 (최신 데이터 디스크 flush)
  if (isServerRunning() && REST_API_ENABLED && restApiClient.isAvailable) {
    try {
      addLog('[백업] REST API로 서버 저장 요청...');
      await restApiClient.save();
      addLog('[백업] 서버 저장 완료');
      await new Promise(r => setTimeout(r, 2000)); // 디스크 쓰기 대기
    } catch (e) {
      addLog('[백업] 서버 저장 실패 (백업은 계속 진행): ' + e.message);
    }
  }
  try {
    if (!fs.existsSync(PAL_BACKUP_ROOT)) fs.mkdirSync(PAL_BACKUP_ROOT, { recursive: true });
    const ts = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    const dest = path.join(PAL_BACKUP_ROOT, `PalServerSave_${ts}`);
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true });
    fs.mkdirSync(dest, { recursive: true });
    addLog('백업 시작: ' + dest);
    const r = spawnSync('robocopy', [
      PAL_SAVE_PATH, dest,
      '/E', '/Z', '/COPY:DAT', '/R:2', '/W:2', '/XJ', '/NFL', '/NDL', '/NP'
    ], { encoding: 'utf8', windowsHide: true });
    const robocopyExit = r.status != null ? r.status : -1;
    if (robocopyExit >= 8) {
      addLog('백업 실패 (robocopy 코드: ' + robocopyExit + ')');
      return { success: false, message: '백업 실패. robocopy 코드: ' + robocopyExit };
    }
    addLog('백업 완료: ' + dest);
    deleteOldBackups();
    return { success: true, message: '백업 완료: ' + dest, path: dest };
  } catch (e) {
    addLog('백업 실패: ' + e.message);
    return { success: false, message: '백업 실패: ' + e.message };
  }
}

const BACKUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const AUTO_BACKUP_INTERVAL_MS = 3 * 60 * 60 * 1000;

function deleteOldBackups() {
  if (!PAL_BACKUP_ROOT || !fs.existsSync(PAL_BACKUP_ROOT)) return;
  const now = Date.now();
  let entries;
  try {
    entries = fs.readdirSync(PAL_BACKUP_ROOT, { withFileTypes: true });
  } catch (_) { return; }
  for (const e of entries) {
    if (!e.isDirectory() || !e.name.startsWith('PalServerSave_')) continue;
    const full = path.join(PAL_BACKUP_ROOT, e.name);
    try {
      const stat = fs.statSync(full);
      if (now - stat.mtimeMs > BACKUP_MAX_AGE_MS) {
        fs.rmSync(full, { recursive: true });
        addLog('오래된 백업 삭제 (24h 초과): ' + e.name);
      }
    } catch (_) {}
  }
}

function runScheduledBackup() {
  deleteOldBackups();
  if (isServerRunning() && PAL_SAVE_PATH && PAL_BACKUP_ROOT && fs.existsSync(PAL_SAVE_PATH)) {
    addLog('[자동백업] 3시간 주기 실행');
    runBackup();
  }
}

async function stopServer() {
  if (!isServerRunning()) return { success: false, message: '서버가 실행 중이 아닙니다.' };

  // REST API 사용 가능하면 정상 종료 시도 (30초 경고)
  if (REST_API_ENABLED && restApiClient.isAvailable) {
    try {
      addLog('[REST-API] 서버 정상 종료 요청 (30초 후 종료)...');
      const result = await restApiClient.shutdown(30, '서버가 30초 후 종료됩니다');
      addLog('[REST-API] ' + result.message);

      // REST API 종료 후 프로세스 핸들 정리
      setTimeout(() => {
        if (serverProcess) {
          serverProcess = null;
        }
      }, 32000); // 30초 + 2초 여유

      return { success: true, message: result.message };
    } catch (e) {
      addLog(`[REST-API] 정상 종료 실패: ${e.message}, 강제 종료로 전환`);
      // REST API 실패 시 강제 종료로 fallback
    }
  }

  // REST API 미사용 또는 실패 시 기존 방식(강제 종료)
  try {
    addLog('서버 강제 정지 중...');
    if (process.platform === 'win32') {
      const pids = getPalServerPids();
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { encoding: 'utf8', windowsHide: true });
          addLog(`PID ${pid} 종료됨`);
        } catch (err) {
          addLog(`PID ${pid} 종료 시도 실패 (이미 종료됐을 수 있음)`);
        }
      }
      if (pids.length === 0) addLog('실행 중인 PalServer 프로세스 없음');
    }
    if (serverProcess) {
      try { serverProcess.kill('SIGTERM'); } catch (_) {}
      serverProcess = null;
    }
    addLog('서버 정지 완료');
    return { success: true, message: '서버를 정지했습니다.' };
  } catch (e) {
    addLog('서버 정지 실패: ' + e.message);
    return { success: false, message: '서버 정지 실패: ' + e.message };
  }
}

/**
 * 공지 → 대기 → 종료 (플레이어가 있을 때 사용)
 * 60초 공지 → 10초 후 실제 종료 (총 70초)
 */
async function stopServerWithNotice() {
  if (!isServerRunning()) return { success: false, message: '서버가 실행 중이 아닙니다.' };

  if (!REST_API_ENABLED || !restApiClient.isAvailable) {
    return { success: false, message: 'REST API가 활성화되지 않아 공지를 보낼 수 없습니다. 일반 종료를 사용하세요.' };
  }

  try {
    // Send announcement: 60초 후 종료
    addLog('[공지] 60초 후 서버가 종료됩니다...');
    await restApiClient.announce('⚠️ 서버가 60초 후 종료됩니다. 안전한 장소에서 저장해주세요.');

    // Wait 10 seconds, then call shutdown with 60s wait (but we'll actually force it)
    setTimeout(async () => {
      try {
        addLog('[서버 종료] shutdown 요청 전송 중...');
        await restApiClient.shutdown(60, '서버가 곧 종료됩니다');

        // Cleanup process handle after shutdown completes
        setTimeout(() => {
          if (serverProcess) {
            serverProcess = null;
          }
        }, 65000); // 60s + 5s buffer
      } catch (e) {
        addLog('[서버 종료] shutdown 실패, 강제 종료로 전환: ' + e.message);
        // Fallback to force stop
        setTimeout(async () => {
          await stopServer();
        }, 5000);
      }
    }, 10000); // Wait 10 seconds before sending shutdown

    return { success: true, message: '공지가 전송되었습니다. 10초 후 종료 프로세스가 시작됩니다.' };
  } catch (e) {
    addLog('[공지 전송 실패]: ' + e.message);
    return { success: false, message: '공지 전송 실패: ' + e.message };
  }
}

/**
 * 즉시 강제 종료 (공지 없이 바로 종료)
 */
async function forceStopServer() {
  if (!isServerRunning()) return { success: false, message: '서버가 실행 중이 아닙니다.' };

  try {
    addLog('[강제 종료] 즉시 서버를 종료합니다...');

    // Try REST API force stop first
    if (REST_API_ENABLED && restApiClient.isAvailable) {
      try {
        await restApiClient.stop();
        addLog('[강제 종료] REST API stop 호출 완료');

        setTimeout(() => {
          if (serverProcess) serverProcess = null;
        }, 3000);

        return { success: true, message: '서버를 강제 종료했습니다.' };
      } catch (e) {
        addLog('[강제 종료] REST API 실패, taskkill로 전환: ' + e.message);
      }
    }

    // Fallback to taskkill
    if (process.platform === 'win32') {
      const pids = getPalServerPids();
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { encoding: 'utf8', windowsHide: true });
          addLog(`[강제 종료] PID ${pid} 종료됨`);
        } catch (err) {
          addLog(`[강제 종료] PID ${pid} 종료 실패`);
        }
      }
    }

    if (serverProcess) {
      try { serverProcess.kill('SIGKILL'); } catch (_) {}
      serverProcess = null;
    }

    addLog('[강제 종료] 완료');
    return { success: true, message: '서버를 강제 종료했습니다.' };
  } catch (e) {
    addLog('[강제 종료 실패]: ' + e.message);
    return { success: false, message: '강제 종료 실패: ' + e.message };
  }
}

// --- Routes ---
app.get('/login', (req, res) => {
  if (req.session.authenticated) return res.redirect('/');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  if (req.body.password === PANEL_PASSWORD) {
    req.session.authenticated = true;
    return res.redirect('/');
  }
  res.render('login', { error: '비밀번호가 틀렸습니다.' });
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// 서버 실행 중이면 REST API에서 실제 설정값 가져오기, 아니면 ini 파일
async function getActiveSettings() {
  const fileSettings = readSettings() || {};
  if (isServerRunning() && REST_API_ENABLED && restApiClient.isAvailable) {
    try {
      const liveSettings = await restApiClient.getSettings();
      // SETTING_DEFS에 정의된 모든 키에 대해 REST API 값 우선 적용
      for (const def of SETTING_DEFS) {
        if (liveSettings[def.key] !== undefined) {
          fileSettings[def.key] = liveSettings[def.key];
        }
      }
    } catch (_) {}
  }
  return fileSettings;
}

app.get('/', requireAuth, async (req, res) => {
  const settings = await getActiveSettings();
  const categories = ['전체', ...new Set(SETTING_DEFS.map(d => d.category))];
  res.render('index', { settings, defs: SETTING_DEFS, categories, running: isServerRunning(), settingsPath: SETTINGS_PATH });
});

// API
app.get('/api/status', requireAuth, (req, res) => {
  res.json({
    running: isServerRunning(),
    logs: serverLogs,
    players: getPlayersState()
  });
});

app.get('/api/players', requireAuth, (req, res) => {
  res.json(getPlayersState());
});

app.get('/api/settings', requireAuth, async (req, res) => {
  const settings = await getActiveSettings();
  if (!settings) return res.status(500).json({ error: '설정을 읽을 수 없습니다.' });
  res.json(settings);
});

app.post('/api/settings', requireAuth, (req, res) => {
  try {
    const current = readSettings() || {};
    const updates = req.body;
    // Convert types
    for (const def of SETTING_DEFS) {
      if (updates[def.key] !== undefined) {
        if (def.type === 'boolean') {
          current[def.key] = updates[def.key] ? 'True' : 'False';
        } else if (def.type === 'slider' || def.type === 'number') {
          const num = Number(updates[def.key]);
          current[def.key] = String(isNaN(num) ? def.default : num);
        } else {
          current[def.key] = String(updates[def.key]);
        }
      }
    }
    writeSettings(current);
    addLog('설정이 저장되었습니다.');
    res.json({ success: true, needRestart: isServerRunning() });
  } catch (e) {
    res.status(500).json({ error: '설정 저장 실패: ' + e.message });
  }
});

app.post('/api/server/start', requireAuth, (req, res) => res.json(startServer()));
app.post('/api/server/stop', requireAuth, async (req, res) => {
  const result = await stopServer();
  res.json(result);
});
app.post('/api/server/restart', requireAuth, async (req, res) => {
  await stopServer();
  // REST API 정상 종료 사용 시 30초 대기, 그 외 3초
  const waitTime = REST_API_ENABLED && restApiClient.isAvailable ? 33000 : 3000;
  await new Promise(r => setTimeout(r, waitTime));
  res.json(startServer());
});

app.post('/api/server/stop-with-notice', requireAuth, async (req, res) => {
  const result = await stopServerWithNotice();
  res.json(result);
});

app.post('/api/server/force-stop', requireAuth, async (req, res) => {
  const result = await forceStopServer();
  res.json(result);
});

app.post('/api/backup/now', requireAuth, async (req, res) => res.json(await runBackup()));

// --- 통계 API ---
app.get('/api/stats/players', requireAuth, (req, res) => {
  try {
    const players = dbStmts.getPlayerStats.all(Date.now());
    res.json({ success: true, players });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/stats/sessions', requireAuth, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const sessions = dbStmts.getRecentSessions.all(limit);
    res.json({ success: true, sessions });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/stats/daily', requireAuth, (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days || '30', 10), 90);
    const since = Date.now() - (days * 24 * 60 * 60 * 1000);
    const daily = dbStmts.getDailyStats.all(Date.now(), since);
    res.json({ success: true, daily });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/stats/player/:userId', requireAuth, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
    const sessions = dbStmts.getPlayerSessions.all(req.params.userId, limit);
    res.json({ success: true, sessions });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

loadPlayerList();
loadPlaytime();

// --- 패널 시작 시 열린 세션에서 상태 복원 ---
(function restoreOpenSessions() {
  try {
    const openSessions = dbStmts.getOpenSessions.all();
    for (const s of openSessions) {
      currentOnline.add(s.userId);
      everConnected.add(s.userId);
      joinTime[s.userId] = s.joinTime;
      if (s.displayName) playerNames[s.userId] = s.displayName;
    }
    if (openSessions.length > 0) {
      console.log(`📋 열린 세션 ${openSessions.length}개 복원 완료`);
    }
  } catch (e) {
    console.error('세션 복원 실패:', e.message);
  }
})();

// --- 기존 playtime.txt → DB 마이그레이션 ---
(function migratePlaytimeToDb() {
  try {
    const playerCount = db.prepare('SELECT COUNT(*) as cnt FROM players').get().cnt;
    if (playerCount > 0) return; // 이미 DB에 데이터 있으면 스킵

    // playtime.txt에서 마이그레이션
    if (fs.existsSync(PLAYTIME_FILE)) {
      const content = fs.readFileSync(PLAYTIME_FILE, 'utf-8');
      const now = Date.now();
      const insertPlayer = db.prepare('INSERT OR IGNORE INTO players (userId, displayName, firstSeen, lastSeen) VALUES (?, ?, ?, ?)');
      const insertSession = db.prepare('INSERT INTO sessions (userId, displayName, joinTime, leaveTime, durationMinutes) VALUES (?, ?, ?, ?, ?)');

      const migrate = db.transaction(() => {
        content.split('\n').forEach(line => {
          const idx = line.indexOf('\t');
          if (idx > 0) {
            const userId = line.slice(0, idx).trim();
            const mins = parseFloat(line.slice(idx + 1)) || 0;
            if (userId && mins > 0) {
              const name = playerNames[userId] || userId;
              insertPlayer.run(userId, name, now - (mins * 60000), now);
              // 기존 총 플레이타임을 단일 세션으로 기록
              insertSession.run(userId, name, now - (mins * 60000), now, mins);
            }
          }
        });
      });
      migrate();
      console.log('📦 playtime.txt → DB 마이그레이션 완료');
    }

    // player_list.txt에서 추가 마이그레이션
    if (fs.existsSync(PLAYER_LIST_FILE)) {
      const content = fs.readFileSync(PLAYER_LIST_FILE, 'utf-8');
      const now = Date.now();
      const insertPlayer = db.prepare('INSERT OR IGNORE INTO players (userId, displayName, firstSeen, lastSeen) VALUES (?, ?, ?, ?)');
      content.split('\n').forEach(line => {
        const userId = line.trim();
        if (userId) {
          insertPlayer.run(userId, playerNames[userId] || userId, now, now);
        }
      });
      console.log('📦 player_list.txt → DB 마이그레이션 완료');
    }
  } catch (e) {
    console.error('마이그레이션 실패:', e.message);
  }
})();

app.listen(PORT, () => {
  console.log(`🎮 팰월드 서버 패널 실행 중: http://localhost:${PORT}`);
  if (PAL_BACKUP_ROOT) {
    setTimeout(runScheduledBackup, 60 * 1000);
    setInterval(runScheduledBackup, AUTO_BACKUP_INTERVAL_MS);
    console.log('⏱️ 자동 백업: 서버 켜져 있을 때 3시간마다 실행, 24시간 지난 백업 자동 삭제');
  }

  // REST API polling for player detection
  setInterval(async () => {
    try {
      await pollRestApi();
    } catch (e) {
      console.error('REST API poll error:', e.message);
    }
  }, REST_API_POLL_INTERVAL);

  // 접속 시간 알림 (1분마다 체크)
  const notifiedHours = {}; // { userId: lastNotifiedHour }
  // 패널 재시작 시 이미 경과한 시간을 세팅 (중복 알림 방지)
  for (const userId of currentOnline) {
    if (joinTime[userId]) {
      const alreadyHours = Math.floor((Date.now() - joinTime[userId]) / (60 * 60 * 1000));
      if (alreadyHours >= 1) notifiedHours[userId] = alreadyHours;
    }
  }
  setInterval(async () => {
    if (!REST_API_ENABLED || !restApiClient.isAvailable || !isServerRunning()) return;
    const now = Date.now();
    for (const userId of currentOnline) {
      if (!joinTime[userId]) continue;
      const hoursPlayed = Math.floor((now - joinTime[userId]) / (60 * 60 * 1000));
      if (hoursPlayed >= 1 && notifiedHours[userId] !== hoursPlayed) {
        notifiedHours[userId] = hoursPlayed;
        const name = playerNames[userId] || userId;
        try {
          await restApiClient.announce(`${name}님 접속하신지 ${hoursPlayed}시간 지났습니다!`);
          addLog(`[알림] ${name}님 접속 ${hoursPlayed}시간 경과 공지`);
        } catch (e) {
          console.error('접속 시간 알림 실패:', e.message);
        }
      }
    }
    // 퇴장한 플레이어 정리
    for (const userId of Object.keys(notifiedHours)) {
      if (!currentOnline.has(userId)) delete notifiedHours[userId];
    }
  }, 60 * 1000); // 1분마다 체크
});
