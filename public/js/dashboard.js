'use strict';

// ══════════════════════════════════════════════════════════════
//  AirWatch Dashboard — lógica de polling, gráficos e UI
// ══════════════════════════════════════════════════════════════

const POLL_INTERVAL_MS = 30_000;
const HISTORY_HOURS    = 24;

// Variável atualmente selecionada no gráfico de histórico
let activeMetric = 'temperature';

// Instâncias Chart.js
let chartHistory = null;
let chartCompare = null;

// ── Configuração de cada variável ──────────────────────────
// Cores análogas frias — teoria das cores para dashboard ambiental/climático
const METRIC_CFG = {
  temperature: { label: 'Temperatura (°C)', color: '#0ea5e9', unit: '°C',    good: [18,26],    warn: [15,30],    crit: [0,40] },
  humidity:    { label: 'Umidade (%)',       color: '#06b6d4', unit: '%',     good: [40,70],    warn: [30,80],    crit: [0,100] },
  CO2:         { label: 'CO₂ (ppm)',         color: '#14b8a6', unit: 'ppm',   good: [0,999],    warn: [1000,1500],crit: [1500,9999] },
  pressure:    { label: 'Pressão (hPa)',     color: '#38bdf8', unit: 'hPa',   good: [950,1050], warn: [920,1070], crit: [0,9999] },
  particula1:  { label: 'PM2.5 (µg/m³)',    color: '#34d399', unit: 'µg/m³', good: [0,25],     warn: [25,50],    crit: [50,9999] },
  particula2:  { label: 'PM10 (µg/m³)',     color: '#86efac', unit: 'µg/m³', good: [0,50],     warn: [50,100],   crit: [100,9999] },
};

// ══ Animação de contador numérico ══════════════════════════
// Anima o valor do KPI de oldVal → newVal em ~600ms
function animateValue(el, newVal, decimals) {
  const oldVal = parseFloat(el.dataset.raw ?? newVal);
  el.dataset.raw = newVal;
  if (isNaN(oldVal) || oldVal === newVal) {
    el.textContent = newVal.toFixed(decimals);
    return;
  }
  // Flash no valor ao atualizar
  el.style.animation = 'none';
  el.offsetHeight; // reflow
  el.style.animation = 'value-flash .5s ease both';

  const duration = 600;
  const start = performance.now();
  function step(now) {
    const p = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    el.textContent = (oldVal + (newVal - oldVal) * ease).toFixed(decimals);
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ══ Utilitários ════════════════════════════════════════════

function statusForValue(metricKey, value) {
  if (value == null) return 'unknown';
  const cfg = METRIC_CFG[metricKey];
  if (!cfg) return 'unknown';
  if (value >= cfg.good[0] && value <= cfg.good[1]) return 'good';
  if (value >= cfg.warn[0] && value <= cfg.warn[1]) return 'warning';
  return 'critical';
}

function statusLabel(s) {
  return { good: 'Normal', warning: 'Atenção', serious: 'Ruim', critical: 'Crítico', unknown: '—' }[s] ?? s;
}

function fmtTime(isoOrDatetime) {
  if (!isoOrDatetime) return '—';
  // Backend devolve UTC sem 'Z'; acrescentamos para o JS interpretar corretamente,
  // depois exibimos em horário local.
  const raw = isoOrDatetime.includes('Z') || isoOrDatetime.includes('+')
    ? isoOrDatetime
    : isoOrDatetime + 'Z';
  const d = new Date(raw);
  return isNaN(d) ? isoOrDatetime : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDateTime(isoOrDatetime) {
  if (!isoOrDatetime) return '—';
  const raw = isoOrDatetime.includes('Z') || isoOrDatetime.includes('+')
    ? isoOrDatetime
    : isoOrDatetime + 'Z';
  const d = new Date(raw);
  return isNaN(d) ? isoOrDatetime : d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

function durationStr(inicio, fim) {
  const start = new Date((inicio.includes('Z') ? inicio : inicio + 'Z'));
  const end   = fim ? new Date((fim.includes('Z') ? fim : fim + 'Z')) : new Date();
  const mins  = Math.round((end - start) / 60000);
  if (mins < 60)  return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

// ══ Chart.js — tema ════════════════════════════════════════

function chartDefaults() {
  const dark = document.documentElement.dataset.theme !== 'light';
  return {
    gridColor:  dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.06)',
    tickColor:  dark ? '#64748b' : '#94a3b8',
    tooltipBg:  dark ? '#1e293b' : '#ffffff',
    tooltipTxt: dark ? '#f1f5f9' : '#0f172a',
  };
}

function commonScales() {
  const t = chartDefaults();
  return {
    x: {
      grid:  { color: t.gridColor, drawBorder: false },
      ticks: { color: t.tickColor, maxRotation: 0, maxTicksLimit: 8, font: { family: "'JetBrains Mono'" } },
    },
    y: {
      grid:  { color: t.gridColor, drawBorder: false },
      ticks: { color: t.tickColor, font: { family: "'JetBrains Mono'" } },
    },
  };
}

function commonTooltip() {
  const t = chartDefaults();
  return {
    backgroundColor: t.tooltipBg,
    titleColor:      t.tooltipTxt,
    bodyColor:       t.tooltipTxt,
    borderColor:     '#334155',
    borderWidth:     1,
    padding:         10,
    cornerRadius:    8,
    displayColors:   true,
  };
}

// ══ Gráfico — Histórico ════════════════════════════════════

function buildHistoryChart(labels, data, metricKey) {
  const cfg = METRIC_CFG[metricKey];
  const ctx  = document.getElementById('chart-history').getContext('2d');

  if (chartHistory) chartHistory.destroy();

  chartHistory = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: cfg.label,
        data,
        borderColor:     cfg.color,
        backgroundColor: cfg.color + '1a',
        borderWidth:     2,
        pointRadius:     data.length > 100 ? 0 : 3,
        pointHoverRadius: 6,
        fill: true,
        tension: .3,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      scales: commonScales(),
      plugins: {
        legend: { display: false },
        tooltip: { ...commonTooltip(), mode: 'index', intersect: false,
          callbacks: { label: ctx => `${ctx.parsed.y} ${cfg.unit}` }
        },
        crosshair: false,
      },
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
    }
  });
}

// ══ Gráfico — Comparativo interno vs externo ══════════════

function buildCompareChart(labels, intData, extData) {
  const ctx = document.getElementById('chart-compare').getContext('2d');

  if (chartCompare) chartCompare.destroy();

  chartCompare = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Interno', data: intData, backgroundColor: '#0ea5e980', borderColor: '#0ea5e9', borderWidth: 1.5, borderRadius: 4 },
        { label: 'Externo', data: extData, backgroundColor: '#34d39980', borderColor: '#34d399', borderWidth: 1.5, borderRadius: 4 },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      scales: {
        ...commonScales(),
        x: { ...commonScales().x, stacked: false },
        y: { ...commonScales().y, title: { display: true, text: '°C / % / hPa (indexado)', color: '#64748b', font: { size: 10 } } }
      },
      plugins: {
        legend: { labels: { color: chartDefaults().tickColor, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, font: { size: 11 } } },
        tooltip: { ...commonTooltip() },
      },
    }
  });
}

// ══ Atualizar KPI cards ════════════════════════════════════

function updateKPICards(leitura) {
  for (const key of Object.keys(METRIC_CFG)) {
    const card  = document.getElementById(`kpi-${key}`);
    if (!card) continue;
    const val    = leitura?.[key] ?? null;
    const status = statusForValue(key, val !== null ? parseFloat(val) : null);

    card.dataset.status = status;
    const valEl = card.querySelector('.kpi-value');
    if (val !== null) {
      animateValue(valEl, parseFloat(val), key === 'CO2' ? 0 : 1);
    } else {
      valEl.textContent = '—';
    }
    card.querySelector('.kpi-status-badge').textContent = statusLabel(status);
  }
}

// ══ Atualizar gráfico histórico ════════════════════════════

function updateHistoryChart(leituras) {
  if (!Array.isArray(leituras) || leituras.length === 0) return;

  const cutoff = Date.now() - HISTORY_HOURS * 3600 * 1000;
  const filtered = leituras.filter(l => {
    const raw = l.registro_tempo.includes('Z') ? l.registro_tempo : l.registro_tempo + 'Z';
    return new Date(raw).getTime() >= cutoff;
  });

  const labels = filtered.map(l => fmtTime(l.registro_tempo));
  const data   = filtered.map(l => l[activeMetric] !== null && l[activeMetric] !== undefined
    ? parseFloat(l[activeMetric])
    : null
  );

  buildHistoryChart(labels, data, activeMetric);
  updateHistoryTable(labels, data);
}

// ══ Tabela acessível para o histórico ═════════════════════

function updateHistoryTable(labels, data) {
  const tbody = document.querySelector('#history-table tbody');
  const thMetric = document.getElementById('th-metric');
  if (!tbody || !thMetric) return;

  const cfg = METRIC_CFG[activeMetric];
  thMetric.textContent = `${cfg.label}`;
  tbody.innerHTML = '';
  labels.forEach((lbl, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${lbl}</td><td>${data[i] !== null ? data[i] : '—'}</td>`;
    tbody.appendChild(tr);
  });
}

// ══ Atualizar comparativo interno / externo ════════════════

function updateCompareChart(leituraAtual, meteoroAtual) {
  if (!leituraAtual) return;

  const labels  = ['Temperatura (°C)', 'Umidade (%)', 'Pressão (hPa÷10)'];
  const intData = [
    leituraAtual.temperature ? parseFloat(leituraAtual.temperature) : null,
    leituraAtual.humidity    ? parseFloat(leituraAtual.humidity)    : null,
    leituraAtual.pressure    ? parseFloat(leituraAtual.pressure) / 10 : null,
  ];
  const extData = meteoroAtual ? [
    meteoroAtual.temperatura_ext ? parseFloat(meteoroAtual.temperatura_ext) : null,
    meteoroAtual.umidade_ext     ? parseFloat(meteoroAtual.umidade_ext)     : null,
    meteoroAtual.pressao_ext     ? parseFloat(meteoroAtual.pressao_ext) / 10 : null,
  ] : [null, null, null];

  buildCompareChart(labels, intData, extData);
}

// ══ Alertas ativos ═════════════════════════════════════════

function SEV_NAME(id) {
  return { 1: 'Moderado', 2: 'Ruim', 3: 'Grave' }[id] ?? `Nível ${id}`;
}

function updateActiveAlerts(alertas) {
  const list  = document.getElementById('active-alerts');
  const badge = document.getElementById('active-count');
  const ativos = alertas.filter(a => a.status === 'ativo');

  const prevCount = parseInt(badge.dataset.prev ?? '0', 10);
  badge.textContent = ativos.length;
  badge.classList.toggle('has-alerts', ativos.length > 0);
  if (ativos.length > 0 && ativos.length !== prevCount) {
    badge.style.animation = 'none';
    badge.offsetHeight;
    badge.style.animation = 'badge-pop .4s ease both';
  }
  badge.dataset.prev = ativos.length;

  if (ativos.length === 0) {
    list.innerHTML = '<li class="alert-empty">Nenhum alerta ativo</li>';
    return;
  }

  list.innerHTML = ativos.map(a => `
    <li class="alert-item" data-sev="${a.id_severidade}">
      <div class="alert-item-top">
        <span class="alert-sev-tag">${SEV_NAME(a.id_severidade)}</span>
        <span class="alert-time">${fmtTime(a.inicio)}</span>
      </div>
      <span class="alert-desc">${a.regra_nome ?? 'Limite ultrapassado'}</span>
      <span class="alert-vars">Duração: ${durationStr(a.inicio, a.fim)}</span>
    </li>
  `).join('');
}

// ══ Histórico de alertas ════════════════════════════════════

function updateAlertHistory(alertas) {
  const tbody = document.getElementById('alert-history-body');
  if (!tbody) return;

  if (!alertas.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-row">Nenhum alerta registrado</td></tr>';
    return;
  }

  const recent = [...alertas].sort((a, b) =>
    new Date(b.inicio + 'Z') - new Date(a.inicio + 'Z')
  ).slice(0, 50);

  tbody.innerHTML = recent.map(a => {
    const statusLabel2 = a.status === 'ativo' ? '🔴 Ativo' : '✅ Resolvido';
    return `
      <tr>
        <td>${fmtDateTime(a.inicio)}</td>
        <td>${SEV_NAME(a.id_severidade)}</td>
        <td>${durationStr(a.inicio, a.fim)}</td>
        <td>${statusLabel2}</td>
      </tr>
    `;
  }).join('');
}

// ══ Indicador de conexão ════════════════════════════════════

function setConnection(online) {
  const pill  = document.getElementById('conn-pill');
  const label = document.getElementById('conn-label');
  pill.className  = `connection-pill ${online ? 'online' : 'offline'}`;
  label.textContent = online ? 'Online' : 'Offline';
}

function setLastUpdate() {
  const el = document.getElementById('last-update');
  if (el) el.textContent = `Atualizado: ${new Date().toLocaleTimeString('pt-BR')}`;
}

// ══ Ciclo de polling ════════════════════════════════════════

async function fetchJson(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function refresh() {
  try {
    // Flask usa 'inicio'/'fim' (ISO UTC) e 'limite' (não 'limit')
    // Sem 'inicio' o endpoint retorna só a última 1 hora — precisamos de 24 h
    const inicio24h = new Date(Date.now() - HISTORY_HOURS * 3600 * 1000).toISOString();
    const leituras24hUrl = `/api/leituras?inicio=${encodeURIComponent(inicio24h)}&limite=5000`;

    const [ultima, leituras, alertas, meteo] = await Promise.all([
      fetchJson('/api/leituras/ultima'),
      fetchJson(leituras24hUrl),
      fetchJson('/api/alertas'),
      fetchJson('/api/meteorologico/ultimo').catch(() => null),
    ]);

    setConnection(true);
    setLastUpdate();

    // Flask envolve os arrays em objetos: { leituras: [...] }, { alertas: [...] }
    const leiturasList = Array.isArray(leituras) ? leituras : (leituras.leituras ?? []);
    const alertasList  = Array.isArray(alertas)  ? alertas  : (alertas.alertas   ?? []);

    updateKPICards(Array.isArray(ultima) ? ultima[0] : ultima);
    updateHistoryChart(leiturasList);
    updateActiveAlerts(alertasList);
    updateAlertHistory(alertasList);
    // /api/meteorologico/ultimo pode devolver { meteorologico: {...} } ou o objeto direto
    const meteoObj = meteo?.meteorologico ?? meteo;
    updateCompareChart(Array.isArray(ultima) ? ultima[0] : ultima, meteoObj);

  } catch (err) {
    setConnection(false);
    console.error('Erro ao buscar dados:', err);
  }
}

// ══ Inicialização ═══════════════════════════════════════════

function initFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeMetric = btn.dataset.metric;
      refresh();
    });
  });
}

function initTableToggle() {
  const btn  = document.getElementById('toggle-history-table');
  const wrap = document.getElementById('history-table-wrap');
  btn?.addEventListener('click', () => {
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!expanded));
    wrap.classList.toggle('visually-hidden', expanded);
    btn.textContent = expanded ? 'Ver dados em tabela' : 'Ocultar tabela';
  });
}

function initThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  btn?.addEventListener('click', () => {
    const html  = document.documentElement;
    const light = html.dataset.theme !== 'light';
    html.dataset.theme = light ? 'light' : 'dark';
    try { localStorage.setItem('aw-theme', html.dataset.theme); } catch {}
    // Recriar gráficos com as cores corretas
    if (chartHistory) refresh();
    if (chartCompare) refresh();
  });
  try {
    const saved = localStorage.getItem('aw-theme');
    if (saved) document.documentElement.dataset.theme = saved;
  } catch {}
}

// ══════════════════════════════════════════════════════════════
//  FUNDO DINÂMICO — clima atual via Open-Meteo
// ══════════════════════════════════════════════════════════════

// Coordenadas de São Caetano do Sul (do .env do projeto)
const GEO = { lat: -23.6150, lon: -46.5695 };

// Canvas para partículas (chuva / neve)
const weatherCanvas = document.getElementById('weather-canvas');
const wCtx = weatherCanvas ? weatherCanvas.getContext('2d') : null;
let particles = [];
let weatherAnim = null;

function resizeWeatherCanvas() {
  if (!weatherCanvas) return;
  weatherCanvas.width  = window.innerWidth;
  weatherCanvas.height = window.innerHeight;
}

// WMO code → estado visual
function wmoToState(code, isDay) {
  if (code === 0)                        return isDay ? 'clear-day' : 'clear-night';
  if (code <= 3)                         return 'cloudy';
  if (code <= 48)                        return 'fog';
  if (code <= 67 || (code >= 80 && code <= 82)) return 'rain';
  if (code <= 77 || (code >= 85 && code <= 86)) return 'snow';
  if (code >= 95)                        return 'storm';
  return 'cloudy';
}

// Remove todas as classes weather-* do body
function clearWeatherClass() {
  document.body.className = document.body.className
    .split(' ')
    .filter(c => !c.startsWith('weather-'))
    .join(' ');
}

// ── Partículas de chuva ───────────────────────────────────
function initRain(heavy = false) {
  resizeWeatherCanvas();
  const count = heavy ? 220 : 130;
  particles = Array.from({ length: count }, () => ({
    x: Math.random() * weatherCanvas.width,
    y: Math.random() * weatherCanvas.height,
    len:   Math.random() * 18 + 8,
    speed: Math.random() * 6 + (heavy ? 8 : 4),
    op:    Math.random() * 0.4 + 0.2,
  }));
}

function drawRain() {
  if (!wCtx) return;
  wCtx.clearRect(0, 0, weatherCanvas.width, weatherCanvas.height);
  wCtx.strokeStyle = '#a8d4f0';
  wCtx.lineWidth = 1;
  for (const p of particles) {
    wCtx.globalAlpha = p.op;
    wCtx.beginPath();
    wCtx.moveTo(p.x, p.y);
    wCtx.lineTo(p.x - p.len * 0.2, p.y + p.len);
    wCtx.stroke();
    p.y += p.speed;
    p.x -= p.speed * 0.2;
    if (p.y > weatherCanvas.height) {
      p.y = -p.len;
      p.x = Math.random() * weatherCanvas.width;
    }
  }
  wCtx.globalAlpha = 1;
  weatherAnim = requestAnimationFrame(drawRain);
}

// ── Partículas de neve ────────────────────────────────────
function initSnow() {
  resizeWeatherCanvas();
  particles = Array.from({ length: 100 }, () => ({
    x:     Math.random() * weatherCanvas.width,
    y:     Math.random() * weatherCanvas.height,
    r:     Math.random() * 3 + 1,
    speed: Math.random() * 1.5 + 0.5,
    drift: (Math.random() - 0.5) * 0.5,
    op:    Math.random() * 0.5 + 0.3,
  }));
}

function drawSnow() {
  if (!wCtx) return;
  wCtx.clearRect(0, 0, weatherCanvas.width, weatherCanvas.height);
  for (const p of particles) {
    wCtx.globalAlpha = p.op;
    wCtx.fillStyle = '#ffffff';
    wCtx.beginPath();
    wCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    wCtx.fill();
    p.y += p.speed;
    p.x += p.drift;
    if (p.y > weatherCanvas.height) {
      p.y = -p.r;
      p.x = Math.random() * weatherCanvas.width;
    }
  }
  wCtx.globalAlpha = 1;
  weatherAnim = requestAnimationFrame(drawSnow);
}

// ── Aplicar estado visual ─────────────────────────────────
function applyWeatherState(state) {
  if (weatherAnim) { cancelAnimationFrame(weatherAnim); weatherAnim = null; }
  if (wCtx) wCtx.clearRect(0, 0, weatherCanvas.width, weatherCanvas.height);

  clearWeatherClass();
  document.body.classList.add(`weather-${state}`);

  if (state === 'rain')  { initRain(false); drawRain(); }
  if (state === 'storm') { initRain(true);  drawRain(); }
  if (state === 'snow')  { initSnow();      drawSnow(); }
}

// ── Indicador de clima no header ──────────────────────────
const WEATHER_LABEL = {
  'clear-day':   '☀️ Dia limpo',
  'clear-night': '🌙 Noite limpa',
  'cloudy':      '☁️ Nublado',
  'fog':         '🌫️ Névoa',
  'rain':        '🌧️ Chuva',
  'storm':       '⛈️ Tempestade',
  'snow':        '🌨️ Neve',
};


// ══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initFilters();
  initTableToggle();
  initThemeToggle();
  resizeWeatherCanvas();
  window.addEventListener('resize', () => {
    resizeWeatherCanvas();
    // reinicia partículas no novo tamanho
    if (document.body.classList.contains('weather-rain') ||
        document.body.classList.contains('weather-storm')) { initRain(document.body.classList.contains('weather-storm')); }
    if (document.body.classList.contains('weather-snow'))  { initSnow(); }
  });
  refresh();
  setInterval(refresh, POLL_INTERVAL_MS);
});
