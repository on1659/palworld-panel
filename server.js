require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

const DEFAULT_SETTINGS_PATH = String.raw`C:\Program Files (x86)\Steam\steamapps\common\PalServer\Pal\Saved\Config\WindowsServer\PalWorldSettings.ini`;
const DEFAULT_SERVER_PATH = String.raw`C:\Program Files (x86)\Steam\steamapps\common\PalServer\PalServer.exe`;

const SETTINGS_PATH = process.env.PAL_SETTINGS_PATH || DEFAULT_SETTINGS_PATH;
const SERVER_PATH = process.env.PAL_SERVER_PATH || DEFAULT_SERVER_PATH;
const SERVER_ARGS = (process.env.PAL_SERVER_ARGS || '-useperfthreads -NoAsyncLoadingThread -UseMultithreadForDS').split(' ').filter(Boolean);
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || 'admin';

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
    if (typeof v === 'string' && !/^[\d.]+$/.test(v) && v !== 'True' && v !== 'False' && !['None','Item','ItemAndEquipment','All'].includes(v)) {
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

// --- Server management ---
let serverProcess = null;
let serverLogs = [];
const MAX_LOG_LINES = 50;

function addLog(line) {
  const timestamp = new Date().toLocaleTimeString('ko-KR');
  serverLogs.push(`[${timestamp}] ${line}`);
  if (serverLogs.length > MAX_LOG_LINES) serverLogs.shift();
}

function isServerRunning() {
  if (process.platform === 'win32') {
    try {
      const result = execSync('tasklist /FI "IMAGENAME eq PalServer-Win64-Test-Cmd.exe" /NH', { encoding: 'utf-8' });
      if (result.includes('PalServer')) return true;
    } catch {}
    try {
      const result = execSync('tasklist /FI "IMAGENAME eq PalServer.exe" /NH', { encoding: 'utf-8' });
      if (result.includes('PalServer')) return true;
    } catch {}
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
    serverProcess.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => addLog(l)));
    serverProcess.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => addLog('[ERR] ' + l)));
    serverProcess.on('close', code => {
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

function stopServer() {
  if (!isServerRunning()) return { success: false, message: '서버가 실행 중이 아닙니다.' };
  try {
    addLog('서버 정지 중...');
    if (process.platform === 'win32') {
      execSync('taskkill /IM PalServer-Win64-Test-Cmd.exe /F', { encoding: 'utf-8' });
    }
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      serverProcess = null;
    }
    addLog('서버 정지 완료');
    return { success: true, message: '서버를 정지했습니다.' };
  } catch (e) {
    addLog('서버 정지 실패: ' + e.message);
    return { success: false, message: '서버 정지 실패: ' + e.message };
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

app.get('/', requireAuth, (req, res) => {
  const settings = readSettings();
  const categories = [...new Set(SETTING_DEFS.map(d => d.category))];
  res.render('index', { settings, defs: SETTING_DEFS, categories, running: isServerRunning(), settingsPath: SETTINGS_PATH });
});

// API
app.get('/api/status', requireAuth, (req, res) => {
  res.json({ running: isServerRunning(), logs: serverLogs });
});

app.get('/api/settings', requireAuth, (req, res) => {
  const settings = readSettings();
  if (!settings) return res.status(500).json({ error: '설정 파일을 읽을 수 없습니다.' });
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
          current[def.key] = String(Number(updates[def.key]) || def.default);
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
app.post('/api/server/stop', requireAuth, (req, res) => res.json(stopServer()));
app.post('/api/server/restart', requireAuth, async (req, res) => {
  stopServer();
  await new Promise(r => setTimeout(r, 3000));
  res.json(startServer());
});

app.listen(PORT, () => {
  console.log(`🎮 팰월드 서버 패널 실행 중: http://localhost:${PORT}`);
});
