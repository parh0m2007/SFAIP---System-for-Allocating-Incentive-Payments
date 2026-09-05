import { loadState, saveState, submitApplication, decideApplication, getReviewableApplications, updateCriterionAmount, criterionUpdatePayload, getQualityBand, getOlympiadReward, calculateOlympiadTotal, normalizeQualityPercentage, getApplicationValidationErrors, OLYMPIAD_LEVELS, DIPLOMA_TYPES, QUALITY_BANDS } from './domain.js';
import api from './api.js';

const icons = {
  grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></svg>',
  users: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
  bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M5 20h14"/></svg>',
  logout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3M21 3v18"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
  arrowUpRight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
};

let state = loadState();
let view = state.activeRole === 'teacher' ? 'overview' : 'review';
let selectedAppId = null;
let toastTimer;
let backendReady = false;
let backendSyncBusy = false;
let applicationSyncPromise = Promise.resolve();
let submitInFlight = false;
let criterionEditor = null;
let allPeriods = [];
let periodEditor = null;
let criteriaSearch = '';
let criteriaCategory = 'all';
let reviewSearch = '';
let reviewStatus = 'all';
let staffSearch = '';
let helpOpen = false;
let initialLoading = true;
let authenticated = Boolean(api.getAccessToken());
let authMode = 'login';
let authError = '';
let authSchools = state.schools || [];
let notifications = Array.isArray(state.notifications) ? state.notifications : [];
let notificationsOpen = false;

function mapUser(user) {
  const school = user?.school || {};
  const name = user?.fullName || user?.name || '';
  return { id: user?.id, name, initials: name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2), position: user?.position || '', schoolId: school.id || user?.schoolId, schoolName: school.name || '' };
}

const escapeHtml = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function mapCriterion(c) {
  const type = String(c.type || 'FIXED').toLowerCase();
  const bands = (c.scales || []).filter((s) => s.fromValue != null || s.toValue != null).map((s) => ({ from: Number(s.fromValue ?? 0), to: Number(s.toValue ?? 100), amount: Number(s.amount || 0) }));
  const olympiadAmounts = {};
  (c.scales || []).forEach((s) => { if (!s.key?.includes(':')) return; const [level, diploma] = s.key.split(':'); olympiadAmounts[level] = olympiadAmounts[level] || {}; olympiadAmounts[level][diploma] = Number(s.amount || 0); });
  const fields = (c.fields || []).map((field) => ({ ...field, options: Array.isArray(field.options) ? field.options : (() => { try { return field.optionsJson ? JSON.parse(field.optionsJson) : []; } catch { return []; } })() }));
  const usageCount = Number(c.usageCount ?? 0);
  return { id: c.id, type, title: c.title, category: c.category, amount: Number(c.amount ?? c.maxAmount ?? 0), maxAmount: Number(c.maxAmount || 0), qualityBands: bands.length ? bands : QUALITY_BANDS, olympiadAmounts, usage: usageCount ? `${usageCount} ${usageCount === 1 ? 'заявка' : usageCount < 5 ? 'заявки' : 'заявок'}` : 'не использовался', allowEvidence: Boolean(c.allowEvidence), active: c.active !== false, version: c.version, fields, scales: c.scales || [] };
}

function mapApplication(a) {
  const teacher = a.teacher || {};
  return { id: a.id, periodId: a.periodId, teacherId: a.teacherId, schoolId: a.schoolId, status: String(a.status || 'DRAFT').toLowerCase(), total: Number(a.total || 0), comment: a.comment || '', submittedAt: a.submittedAt, decidedAt: a.decidedAt, updatedAt: a.updatedAt, items: (a.items || []).map((i) => { let values = {}; try { values = JSON.parse(i.valuesJson || '{}'); } catch {} return { id: i.id, criterionId: i.criterionId, title: i.titleSnapshot, category: '', amount: Number(i.amount || 0), maxAmount: Number(i.amount || 0), percentage: values.percentage ?? '', entries: (i.olympiadEntries || []).map((e) => ({ level: e.level, diploma: e.diploma, studentName: e.studentName, olympiadName: e.olympiadName, amount: e.amount })), evidence: i.files?.[0]?.originalName || 'Добавьте документ', progress: 100, values }; }), teacherName: teacher.fullName };
}

const formatDate = (value) => { try { return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value)); } catch { return ''; } };

function mapPeriod(p) {
  return { id: p.id, label: p.label, startsAt: p.startsAt, endsAt: p.endsAt, active: p.active !== false, due: formatDate(p.endsAt) || state.activePeriod.due, myApplication: p.myApplication ? { id: p.myApplication.id, status: String(p.myApplication.status || 'DRAFT').toLowerCase(), total: Number(p.myApplication.total || 0) } : null, submittedCount: p.submittedCount };
}

async function hydrateBackend() {
  try {
    if (!api.getAccessToken()) {
      authSchools = await api.listSchools().catch(() => authSchools);
      state.schools = authSchools;
      initialLoading = false;
      render();
      return;
    }
    const [profile, criteria, applications, remoteNotifications, remotePeriods] = await Promise.all([
      api.getProfile(), api.listCriteria(), api.listApplications(), api.listNotifications().catch(() => []), api.listPeriods().catch(() => []),
    ]);
    if (Array.isArray(remotePeriods) && remotePeriods.length) {
      allPeriods = remotePeriods.map(mapPeriod);
      const current = allPeriods.find((p) => p.active) || allPeriods[0];
      if (current) state.activePeriod = current;
    }
    const user = mapUser(profile);
    if (state.activeRole === 'teacher') state.currentUser = user; else state.currentAdmin = user;
    authenticated = true;
    state.criteria = criteria.map(mapCriterion);
    state.users = applications.map((a) => mapUser({ id: a.teacher?.id || a.teacherId, fullName: a.teacher?.fullName || a.teacherName, position: a.teacher?.position, school: profile.school }));
    if (state.activeRole === 'admin') { try { state.users = (await api.listUsers()).map(mapUser); } catch {} }
    state.users = [...new Map(state.users.map((u) => [u.id, u])).values()];
    state.applications = applications.map(mapApplication);
    notifications = Array.isArray(remoteNotifications) ? remoteNotifications : [];
    state.notifications = notifications;
    if (state.activeRole === 'teacher' && !state.applications.some((a) => a.periodId === state.activePeriod.id)) {
      const created = await api.createApplication({ periodId: state.activePeriod.id });
      state.applications = [mapApplication(created)];
    }
    backendReady = true;
    initialLoading = false;
    saveState(state);
    render();
  } catch {
    api.clearTokens();
    backendReady = false;
    initialLoading = false;
    authenticated = false;
    render();
  }
}

async function syncCurrentApplication() {
  if (!backendReady || backendSyncBusy || state.activeRole !== 'teacher') return;
  const app = state.applications.find((a) => a.teacherId === state.currentUser.id && a.periodId === state.activePeriod.id);
  if (!app || !app.id || app.id.startsWith('app-') || !['draft', 'rejected'].includes(app.status)) return;
  backendSyncBusy = true;
  try {
    await api.updateApplication(app.id, { items: app.items.map((item) => ({ criterionId: item.criterionId, values: { ...(item.values || {}), ...(item.percentage !== undefined ? { percentage: item.percentage } : {}) }, entries: item.entries || [] })) });
  } catch (error) {
    // Keep backend mode for validation/locking failures so Submit cannot fall back to local-only state.
    if (error?.status === 401 || String(error?.code || '').startsWith('AUTH_') || error?.code === 'TOKEN_EXPIRED' || error?.code === 'REFRESH_INVALID') {
      backendReady = false;
      authenticated = false;
    }
    throw error;
  }
  finally { backendSyncBusy = false; }
}

function scheduleApplicationSync() {
  applicationSyncPromise = applicationSyncPromise
    .catch(() => {})
    .then(() => syncCurrentApplication());
  return applicationSyncPromise;
}

const rub = (value) => `${new Intl.NumberFormat('ru-RU').format(value)} ₽`;
const statusLabel = { draft: 'Черновик', review: 'На проверке', approved: 'Утверждена', rejected: 'Нужно исправить' };
const statusTone = { draft: 'neutral', review: 'amber', approved: 'green', rejected: 'red' };
const userById = (id) => state.users.find((u) => u.id === id) || state.currentUser;

function setView(next) { view = next; selectedAppId = null; render(); }
function persist(message) { saveState(state); render(); if (message) showToast(message); if (!submitInFlight) void scheduleApplicationSync().catch(() => {}); }
const TOAST_ICONS = { success: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>', error: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>', info: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8h.01M12 12v4"/><circle cx="12" cy="12" r="9"/></svg>' };
function showToast(message, type = 'success') { clearTimeout(toastTimer); const el = document.querySelector('#toast'); if (!el) return; el.className = `toast is-visible toast-${type}`; el.innerHTML = `<span class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.success}</span><span>${escapeHtml(message)}</span><button class="toast-close" data-action="close-toast" aria-label="Закрыть">×</button>`; toastTimer = setTimeout(() => el.classList.remove('is-visible'), 4000); }
const showToastError = (message) => showToast(message, 'error');
const showToastInfo = (message) => showToast(message, 'info');

function shell(content) {
  const isTeacher = state.activeRole === 'teacher';
  const nav = isTeacher
    ? [['overview', icons.grid, 'Обзор'], ['application', icons.file, 'Моя заявка'], ['account', icons.users, 'Профиль']]
    : [['review', icons.grid, 'На проверке'], ['criteria', icons.sliders, 'Критерии'], ['periods', icons.file, 'Периоды'], ['staff', icons.users, 'Сотрудники'], ['reports', icons.download, 'Отчёты'], ['account', icons.users, 'Профиль']];
  const activeUser = isTeacher ? state.currentUser : state.currentAdmin;
  const pendingReviewCount = (state.applications || []).filter((a) => a.schoolId === state.currentAdmin?.schoolId && a.status === 'review').length;
  const unreadCount = notifications.filter((item) => !item.readAt).length;
  const notificationPanel = notificationsOpen ? `<div class="notification-panel" role="dialog" aria-label="Уведомления"><div class="notification-head"><b>Уведомления</b>${unreadCount ? `<span>${unreadCount} новых</span>` : '<span>Нет новых</span>'}</div>${notifications.length ? notifications.slice(0, 8).map((item) => `<button class="notification-item ${item.readAt ? '' : 'unread'}" data-notification-read="${item.id}"><span class="notification-dot"></span><span><b>${item.title || 'Уведомление'}</b><small>${item.body || ''}</small></span></button>`).join('') : '<p class="notification-empty">Здесь появятся решения по заявкам.</p>'}</div>` : '';
  return `<div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark">ОС</div><div><b>Образовательная</b><span>система</span></div></div>
      <div class="workspace-label">${isTeacher ? 'ЛИЧНЫЙ КАБИНЕТ' : 'АДМИНИСТРИРОВАНИЕ'}</div>
      <nav>${nav.map(([id, icon, label]) => `<button class="nav-item ${view === id ? 'active' : ''}" data-view="${id}">${icon}<span>${label}${id === 'review' && pendingReviewCount > 0 ? ` <em>${pendingReviewCount}</em>` : ''}</button>`).join('')}</nav>
      <div class="sidebar-footer"><div class="help-wrap"><button class="help-card" data-action="open-help" aria-expanded="${helpOpen}" aria-controls="help-panel"><span class="help-icon">?</span><div><b>Как это работает</b><small>3 подсказки по системе</small></div>${icons.arrow}</button><div id="help-panel" class="help-panel" ${helpOpen ? '' : 'hidden'}>${(isTeacher ? [['Выберите критерии', 'Отметьте достижения, подтверждённые документами — в заявке видны только активные критерии вашей школы.'], ['Заполните данные', 'Для качества обученности введите процент, для олимпиад — список учеников. Сумма считается автоматически.'], ['Отправьте и следите', 'После отправки завуч проверит заявку. Если что-то не так — заявку вернут с комментарием, её можно исправить и отправить снова.']] : [['Настройте критерии', 'Создайте критерии выплат: фиксированные суммы, шкалы качества или олимпиад. Изменения не влияют на уже поданные заявки.'], ['Управляйте периодами', 'Откройте новый отчётный период — предыдущий закроется автоматически. Учителя увидят период сразу.'], ['Проверяйте и решайте', 'Заявки приходят в очередь «На проверке». Утверждённые попадают в Excel-реестр для бухгалтерии.']]).map(([title, text]) => `<div class="help-tip"><b>${title}</b><p>${text}</p></div>`).join('')}</div></div><button class="nav-item muted" data-action="logout">${icons.logout}<span>Выйти</span></button></div>
    </aside>
    <main class="main"><header class="topbar"><button class="mobile-menu" aria-label="Открыть меню" aria-expanded="false">☰</button><div class="period"><span class="eyebrow">ОТЧЁТНЫЙ ПЕРИОД</span><span>${state.activePeriod.label}</span><span class="dot"></span><span class="deadline">до ${state.activePeriod.due} г.</span></div><div class="top-actions"><div class="notification-wrap"><button class="icon-button" data-action="toggle-notifications" aria-label="Уведомления" aria-expanded="${notificationsOpen}">${icons.bell}${unreadCount ? '<i></i>' : ''}</button>${notificationPanel}</div><div class="profile"><div class="avatar">${activeUser.initials}</div><div><b>${activeUser.name}</b><span>${activeUser.position}</span></div><span class="chevron">⌄</span></div></div></header><div class="content">${content}</div></main></div>`;
}

function authView() {
  const register = authMode === 'register';
  return `<main class="auth-page"><section class="auth-card"><div class="auth-brand"><div class="brand-mark">ОС</div><div><b>Образовательная</b><span>система</span></div></div><div class="auth-intro"><span class="eyebrow">ЕДИНЫЙ КАБИНЕТ</span><h1>${register ? 'Создайте профиль' : 'С возвращением'}</h1><p>${register ? 'Зарегистрируйтесь, чтобы подать и отслеживать заявку.' : 'Войдите, чтобы продолжить работу с заявкой.'}</p></div><form data-auth-submit class="auth-form"><label>Электронная почта<input required type="email" name="email" autocomplete="email" placeholder="you@school.ru"></label>${register ? '<label>ФИО<input required name="fullName" autocomplete="name" placeholder="Иванова Мария Петровна"></label><label>Должность<input name="position" placeholder="Учитель математики"></label><label>Роль<select required name="role"><option value="TEACHER">Учитель</option><option value="DEPUTY">Завуч</option></select></label><label>Школа<select required name="schoolId"><option value="">Выберите школу</option>'+authSchools.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')+'</select></label>' : ''}<label>Пароль<input required type="password" name="password" minlength="8" autocomplete="current-password" placeholder="Не менее 8 символов"></label>${authError ? `<div class="auth-error" role="alert">${authError}</div>` : ''}<button class="btn primary wide" type="submit">${register ? 'Зарегистрироваться' : 'Войти'}</button></form><button class="auth-switch" data-auth-mode="${register ? 'login' : 'register'}">${register ? 'Уже есть профиль? Войти' : 'Нет профиля? Зарегистрироваться'}</button><p class="auth-note">Данные доступны только сотрудникам вашей школы.</p></section><aside class="auth-aside"><span class="eyebrow light">СТИМУЛИРУЮЩИЕ ВЫПЛАТЫ</span><h2>Понятный путь<br><span>от достижения к выплате</span></h2><p>Заполняйте критерии, прикладывайте подтверждения и следите за решением завуча в одном кабинете.</p><div class="auth-aside-stat"><b>0–100%</b><span>фактические данные обученности</span></div></aside></main>`;
}

function header(title, sub, action = '') { return `<div class="page-heading"><div><span class="eyebrow">${state.activeRole === 'teacher' ? 'ЛИЧНЫЙ КАБИНЕТ' : 'АДМИНИСТРАТОР'}</span><h1>${title}</h1><p>${sub}</p></div>${action}</div>`; }
function stat(label, value, hint, tone = '') { return `<div class="stat-card"><span>${label}</span><strong class="${tone}">${value}</strong><small>${hint}</small></div>`; }
function badge(status) { return `<span class="badge ${statusTone[status]}"><span></span>${statusLabel[status]}</span>`; }
const skeletonRow = (cells) => `<tr class="skeleton-row" aria-hidden="true"><td colspan="${cells}">${Array.from({ length: 3 }, (_, i) => `<div class="skeleton-line" style="width:${[70, 45, 85][i]}%"></div>`).slice(0, cells > 3 ? 3 : 1).join('')}</td></tr>`;
const skeletonRows = (cells, count = 4) => Array.from({ length: count }, () => skeletonRow(cells)).join('');

const formatDateTime = (value) => { try { return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); } catch { return '—'; } };
const relativeTime = (value) => {
  try {
    const diff = Date.now() - new Date(value).getTime();
    if (!Number.isFinite(diff)) return '—';
    const minutes = Math.round(diff / 60000);
    if (minutes < 1) return 'только что';
    if (minutes < 60) return `${minutes} мин назад`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} ч назад`;
    return formatDateTime(value);
  } catch { return '—'; }
};

function teacherOverview() {
  const app = state.applications.find((a) => a.teacherId === state.currentUser.id && a.periodId === state.activePeriod.id);
  const totalCriteria = state.criteria.length || 1;
  const chosen = app?.items.length || 0;
  const progress = Math.min(100, Math.round((chosen / totalCriteria) * 100));
  const firstName = String(state.currentUser?.name || '').trim().split(/\s+/)[0] || 'коллега';
  const nextStep = !app || app.status === 'draft' ? (chosen ? `Осталось выбрать критерии: ${totalCriteria - chosen} из ${totalCriteria} доступно. Заполните поля и отправьте на проверку.` : `Выберите ${totalCriteria} доступных критериев — отметьте те, что подтверждены документами.`) : app.status === 'rejected' ? app.comment || 'Внесите исправления и отправьте заявку повторно.' : app.status === 'review' ? 'Заявка на проверке — завуч увидит её в очереди.' : 'Заявка утверждена и включена в реестр выплат.';
  return shell(`${header(`Добрый день, ${firstName}`, 'Здесь собрана вся информация по стимулирующим выплатам за текущий период.', `<button class="btn primary" data-view="application">${icons.file} Открыть заявку</button>`)}
    <section class="hero-banner" role="region" aria-label="Статус заявки"><div><span class="eyebrow light">${escapeHtml(state.activePeriod.label).toUpperCase()}</span><h2>Стимулирующие выплаты<br><span>${statusLabel[app?.status || 'draft']}</span></h2><p>Приём заявок до ${state.activePeriod.due} г. Сумма рассчитывается автоматически по действующим критериям.</p><button class="btn white" data-view="application">Перейти к заявке ${icons.arrow}</button></div><div class="progress-ring" style="--progress:${Math.max(progress, 3)}" role="img" aria-label="Заполнено ${progress}% заявки"><b>${progress}%</b><span>заявка заполнена</span></div></section>
    <div class="section-head"><div><span class="eyebrow">СВОДКА</span><h2>Ваш прогресс</h2></div><span class="muted-text">${app?.updatedAt ? `Обновлено ${relativeTime(app.updatedAt)}` : 'Заявка ещё не начата'}</span></div>
    <div class="stats-grid">${stat('КРИТЕРИЕВ ВЫБРАНО', `${chosen} из ${totalCriteria}`, `${progress}% от доступных`, 'blue')}${stat('ПРЕДВАРИТЕЛЬНАЯ СУММА', rub(app?.total || 0), 'по текущим шкалам', 'dark')}${stat('СТАТУС', statusLabel[app?.status || 'draft'], app?.status === 'rejected' ? 'требуются правки' : 'текущий этап', app?.status === 'approved' ? 'green' : app?.status === 'rejected' ? 'red' : 'amber')}</div>
    <section class="content-grid"><div class="panel progress-panel"><div class="panel-head"><div><span class="eyebrow">ЗАЯВКА №${app?.id?.replace('app-', '') || '—'}</span><h3>Статус заявки</h3></div>${badge(app?.status || 'draft')}</div><div class="progress-track"><span style="width:${Math.max(progress, 3)}%"></span></div><div class="progress-meta"><span>${progress}% заполнено</span><span>Срок: ${state.activePeriod.due} г.</span></div><div class="next-step"><div class="step-icon">${icons.arrow}</div><div><b>${app?.status === 'rejected' ? 'Требуются исправления' : 'Следующий шаг'}</b><p>${nextStep}</p></div></div><button class="text-btn" data-view="application">Продолжить заполнение ${icons.arrow}</button></div><div class="panel tips-panel"><div class="panel-head"><div><span class="eyebrow">ПОДСКАЗКИ</span><h3>Как получить выплату</h3></div><span class="spark" aria-hidden="true">${icons.pencil}</span></div><div class="tip-list"><div><span>01</span><p><b>Выберите критерии</b><small>Отметьте только то, что подтверждено документами</small></p></div><div><span>02</span><p><b>Приложите доказательства</b><small>Справки, дипломы или выгрузки из журнала</small></p></div><div><span>03</span><p><b>Отправьте на проверку</b><small>Завуч рассмотрит заявку и примет решение</small></p></div></div></div></section>`);
}

function recalculateApplication(app) {
  app.items.forEach((item) => {
    const criterion = state.criteria.find((c) => c.id === item.criterionId);
    if (!criterion) return;
    if (criterion.type === 'quality') item.amount = getQualityBand(criterion.qualityBands, item.percentage)?.amount || 0;
    else if (criterion.type === 'olympiad') item.amount = calculateOlympiadTotal(criterion, item.entries || []);
    else item.amount = criterion.amount ?? criterion.maxAmount;
    item.maxAmount = criterion.maxAmount;
  });
  app.total = app.items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
}

function olympiadEntry(entry = {}, criterionId, index) {
  const levels = OLYMPIAD_LEVELS.map((level) => `<option value="${level.id}" ${entry.level === level.id ? 'selected' : ''}>${level.label}</option>`).join('');
  const diplomas = DIPLOMA_TYPES.map((type) => `<option value="${type.id}" ${entry.diploma === type.id ? 'selected' : ''}>${type.label}</option>`).join('');
  return `<div class="olympiad-entry"><label>Уровень<select required data-olympiad-field="level" data-criterion="${criterionId}" data-entry="${index}">${levels}</select></label><label>Степень диплома<select required data-olympiad-field="diploma" data-criterion="${criterionId}" data-entry="${index}">${diplomas}</select></label><label class="student-field">Фамилия и имя обучающегося<input required value="${entry.studentName || ''}" placeholder="Например, Иванов Иван" data-olympiad-field="studentName" data-criterion="${criterionId}" data-entry="${index}" /></label><label class="olympiad-name-field">Название олимпиады<input required value="${entry.olympiadName || ''}" placeholder="Название" data-olympiad-field="olympiadName" data-criterion="${criterionId}" data-entry="${index}" /></label><button class="icon-button danger" title="Удалить обучающегося" data-remove-student="${criterionId}" data-entry="${index}">×</button></div>`;
}

function criterionDetail(c, chosen) {
  const customFields = (c.fields || []).map((field) => {
    const type = String(field.type || 'TEXT').toUpperCase();
    const value = chosen.values?.[field.key] ?? '';
    const options = field.options || (() => { try { return field.optionsJson ? JSON.parse(field.optionsJson) : []; } catch { return []; } })();
    const control = type === 'SELECT'
      ? `<select data-custom-field data-criterion="${c.id}" data-field-key="${field.key}" ${field.required ? 'required' : ''}><option value="">Выберите</option>${options.map((option) => `<option value="${option}" ${String(value) === String(option) ? 'selected' : ''}>${option}</option>`).join('')}</select>`
      : `<input type="${type === 'NUMBER' ? 'number' : type === 'DATE' ? 'date' : 'text'}" value="${String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}" data-custom-field data-criterion="${c.id}" data-field-key="${field.key}" ${field.required ? 'required' : ''} ${type === 'FILE' ? 'placeholder="Название или ссылка на документ"' : ''} />`;
    return `<label class="custom-field">${field.label}${control}</label>`;
  }).join('');
  const customBlock = customFields ? `<div class="custom-fields">${customFields}</div>` : '';
  if (c.type === 'quality') {
    const band = getQualityBand(c.qualityBands, chosen.percentage);
    return `${customBlock}<div class="criterion-special quality-special"><label>Процент обученности<input type="number" min="0" max="100" step="0.1" value="${chosen.percentage ?? ''}" placeholder="0–100" data-quality-percent="${c.id}" /><small>Введите процент из выгрузки журнала. При значении выше 90% выплата не начисляется.</small></label><div class="fixed-amount"><label>Фиксированная выплата</label><strong>${band ? rub(band.amount) : '—'}</strong><small>${band ? `${band.from}–${band.to}%` : 'Выберите диапазон'}</small></div></div>`;
  }
  if (c.type === 'olympiad') {
    const entries = chosen.entries || [];
    return `${customBlock}<div class="criterion-special olympiad-special"><div class="special-head"><div><b>Победители и призёры</b><small>Добавьте каждого обучающегося отдельной строкой</small></div><strong>${rub(chosen.amount || 0)}</strong></div><div class="olympiad-list">${entries.map((entry, index) => olympiadEntry(entry, c.id, index)).join('')}</div><button class="text-btn add-student" data-add-student="${c.id}">${icons.plus} Добавить обучающегося</button></div>`;
  }
  return `${customBlock}<div class="criterion-detail"><div class="fixed-amount"><label>Фиксированная выплата</label><strong>${rub(c.amount ?? chosen.amount)}</strong><small>назначено завучем</small></div><button class="icon-button danger" title="Удалить" data-remove="${c.id}">×</button></div>`;
}

function applicationView() {
  const app = state.applications.find((a) => a.teacherId === state.currentUser.id && a.periodId === state.activePeriod.id);
  const items = app?.items || [];
  const criteria = state.criteria;
  const daysLeft = (() => { try { return Math.ceil((new Date(state.activePeriod.endsAt).setHours(23, 59, 59) - Date.now()) / 86400000); } catch { return null; } })();
  const daysLeftText = daysLeft == null ? 'Крайний срок' : daysLeft < 0 ? 'Приём заявок завершён' : daysLeft === 0 ? 'Сегодня последний день' : 'Не откладывайте';
  const daysLeftHint = daysLeft == null ? `Приём до ${state.activePeriod.due} г.` : daysLeft < 0 ? `Приём завершился ${state.activePeriod.due} г.` : daysLeft === 0 ? `Отправьте заявку до конца дня` : `До окончания приёма осталось ${daysLeft} ${daysLeft === 1 ? 'день' : daysLeft < 5 ? 'дня' : 'дней'}`;
  return shell(`${header('Моя заявка', `${state.activePeriod.label} · крайний срок ${state.activePeriod.due} г.`, `<div class="heading-actions">${badge(app?.status || 'draft')}<button class="btn ghost" data-action="save">Сохранить черновик</button></div>`)}
    <div class="application-layout"><div><div class="notice"><span class="notice-icon">i</span><div><b>Сумма фиксируется завучем</b><p>Для специальных критериев сумма рассчитывается по утверждённой шкале. Учитель вводит только фактические данные.</p></div></div><div class="panel criteria-panel"><div class="panel-head"><div><span class="eyebrow">ВЫБРАНО ${items.length} ИЗ ${criteria.length} КРИТЕРИЕВ</span><h3>Выберите достижения</h3></div><span class="total-label">Итого <b>${rub(app?.total || 0)}</b></span></div>${criteria.map((c, i) => { const chosen = items.find((x) => x.criterionId === c.id); return `<div class="criterion-row ${chosen ? 'selected' : ''}"><div class="criterion-number">0${i + 1}</div><div class="criterion-main"><div><b>${c.title}</b><span>${c.category}</span></div>${chosen ? `${criterionDetail(c, chosen)}${c.allowEvidence ? `<label class="file-field compact-file">Подтверждающий документ<div>${icons.upload}<span>${chosen.evidence}</span></div><input type="file" data-file="${c.id}" /></label>` : ''}<button class="icon-button danger" title="Удалить" data-remove="${c.id}">×</button>` : `<button class="select-criterion" data-add="${c.id}">${icons.plus} Добавить в заявку <span>${c.type === 'quality' ? '0–90%' : c.type === 'olympiad' ? 'по шкале' : rub(c.amount ?? c.maxAmount)}</span></button>`}</div><span class="criterion-state">${chosen ? icons.check : icons.arrow}</span></div>`; }).join('')}</div><button class="btn primary wide" data-action="submit">Отправить на проверку ${icons.arrow}</button></div><aside><div class="panel side-summary"><span class="eyebrow">ПРЕДВАРИТЕЛЬНЫЙ РАСЧЁТ</span><div class="big-number">${rub(app?.total || 0)}</div><p>Сумма по утверждённым шкалам и выбранным достижениям</p><div class="summary-line"><span>Выбрано критериев</span><b>${items.length}</b></div><div class="summary-line"><span>Подтверждения</span><b>${items.filter((x) => x.evidence).length}/${items.length || 0}</b></div><div class="summary-divider"></div><div class="summary-callout">${icons.check}<span>Все суммы проверены<br><b>по действующим критериям</b></span></div></div><div class="panel deadline-card"><span class="deadline-icon" aria-hidden="true">${icons.clock}</span><div><b>${daysLeftText}</b><p>${daysLeftHint}</p></div></aside></div>`);
}

function accountView() {
  const user = state.activeRole === 'teacher' ? state.currentUser : state.currentAdmin;
  return shell(`${header('Профиль и школа', 'Школа привязывает пользователя к своему контуру данных и очереди проверки.', '<button class="btn primary" data-action="save-school">Сохранить профиль</button>')}
    <div class="account-grid"><div class="panel account-card"><div class="panel-head"><div><span class="eyebrow">РЕГИСТРАЦИЯ · ${state.activeRole === 'teacher' ? 'УЧИТЕЛЬ' : 'ЗАВУЧ'}</span><h3>Данные пользователя</h3></div><span class="badge blue-soft">Обязательно</span></div><div class="form-grid"><label>ФИО<input value="${user.name}" data-profile-name /></label><label>Должность<input value="${user.position}" data-profile-position /></label><label class="full">Школа / образовательная организация<select data-profile-school disabled aria-describedby="school-help">${state.schools.map((s) => `<option value="${s.id}" ${s.id === user.schoolId ? 'selected' : ''}>${s.name}</option>`).join('')}</select><small id="school-help">Школа назначается при регистрации и не изменяется в профиле.</small></label></div></div><div class="panel security-card"><span class="eyebrow">КОНТУР ДОСТУПА</span><h3>${user.schoolName || 'Школа не выбрана'}</h3><div class="access-row"><span class="access-dot"></span><div><b>Данные изолированы по школе</b><p>Заявки, сотрудники и отчёты доступны только пользователям с тем же идентификатором школы.</p></div></div><div class="access-rule">schoolId: <code>${user.schoolId || '—'}</code></div></div></div>`);
}

function reviewView() {
  const schoolApps = getReviewableApplications(state, state.currentAdmin.schoolId);
  const query = reviewSearch.trim().toLowerCase();
  const review = schoolApps.filter((a) => (reviewStatus === 'all' || a.status === reviewStatus) && (!query || userById(a.teacherId).name.toLowerCase().includes(query)));
  const selected = selectedAppId ? schoolApps.find((a) => a.id === selectedAppId) : null;
  return shell(`${header('Очередь на проверку', 'Проверьте заявки сотрудников и примите решение по каждой.', `<button class="btn ghost" data-view="reports">${icons.download} Экспорт реестра</button>`)}
    <div class="stats-grid admin-stats">${stat('НА ПРОВЕРКЕ', schoolApps.filter((a) => a.status === 'review').length, 'требуют решения', 'amber')}${stat('УТВЕРЖДЕНО', schoolApps.filter((a) => a.status === 'approved').length, `на ${escapeHtml(state.activePeriod.label.toLowerCase())}`, 'green')}${stat('СУММА К ВЫПЛАТЕ', rub(schoolApps.filter((a) => a.status === 'approved').reduce((s, a) => s + a.total, 0)), 'утверждённые заявки', 'dark')}${stat('СОТРУДНИКОВ', state.users.length, 'активных в системе', 'blue')}</div>
    <div class="review-layout"><div class="panel table-panel"><div class="table-toolbar"><div class="search"><span class="search-icon" aria-hidden="true">${icons.search}</span><input placeholder="Поиск по сотруднику" value="${escapeHtml(reviewSearch)}" data-review-search /></div><select data-review-status><option value="all">Все статусы</option><option value="review" ${reviewStatus === 'review' ? 'selected' : ''}>На проверке</option><option value="approved" ${reviewStatus === 'approved' ? 'selected' : ''}>Утверждена</option><option value="rejected" ${reviewStatus === 'rejected' ? 'selected' : ''}>Нужно исправить</option><option value="draft" ${reviewStatus === 'draft' ? 'selected' : ''}>Черновики</option></select></div><div class="table-scroll"><table><thead><tr><th>СОТРУДНИК</th><th>КРИТЕРИИ</th><th>СУММА</th><th>ОБНОВЛЕНО</th><th>СТАТУС</th><th></th></tr></thead><tbody>${initialLoading ? skeletonRows(6, 5) : review.length ? review.map((a) => { const u = userById(a.teacherId); return `<tr class="${selectedAppId === a.id ? 'selected-row' : ''}" data-select="${a.id}"><td><div class="person"><span class="avatar small">${u.initials}</span><span><b>${escapeHtml(u.name)}</b><small>${escapeHtml(u.position)}</small></span></div></td><td>${a.items.length} ${a.items.length === 1 ? 'критерий' : 'критериев'}</td><td class="td-amount"><b>${rub(a.total)}</b></td><td>${relativeTime(a.updatedAt)}</td><td>${badge(a.status)}</td><td>${icons.arrow}</td></tr>`; }).join('') : `<tr><td colspan="6"><div class="empty-detail"><span>${icons.inbox}</span><b>Заявок не найдено</b><p>${reviewStatus === 'all' && !query ? 'Как только сотрудник отправит заявку, она появится здесь.' : 'Измените параметры поиска или сбросьте фильтр.'}</p></div></td></tr>`}</tbody></table></div>${!initialLoading && review.length ? `<div class="table-footer"><span>Показано ${review.length} из ${schoolApps.length}</span></div>` : ''}</div>${selected ? reviewDetail(selected) : '<div class="empty-detail"><span>${icons.arrowUpRight}</span><b>Выберите заявку</b><p>Нажмите на строку, чтобы открыть детали и принять решение</p></div>'}</div>`);
}

function reviewDetail(app) { const u = userById(app.teacherId); return `<div class="panel detail-panel"><div class="detail-top"><div class="person"><span class="avatar">${u.initials}</span><span><b>${escapeHtml(u.name)}</b><small>${escapeHtml(u.position)}</small></span></div>${badge(app.status)}</div><div class="detail-meta"><span>Заявка <b>#${app.id.replace('app-', '')}</b></span><span>${app.submittedAt ? `Подана ${formatDateTime(app.submittedAt)}` : 'Ещё не отправлена'}</span></div><div class="detail-total"><span>Предварительная сумма</span><b>${rub(app.total)}</b></div><div class="evidence-list">${app.items.map((x) => `<div><span class="evidence-check">${icons.check}</span><span><b>${escapeHtml(x.title)}</b><small>${escapeHtml(x.evidence)}</small></span><strong>${rub(x.amount)}</strong></div>`).join('')}</div>${app.status === 'review' ? `<div class="decision"><button class="btn success" data-decision="approved" data-id="${app.id}">${icons.check} Утвердить</button><button class="btn reject" data-decision="rejected" data-id="${app.id}">Отклонить</button></div>` : `<div class="decision-note">Решение принято. ${app.status === 'approved' ? 'Заявка включена в реестр выплат.' : escapeHtml(app.comment)}</div>`}</div>`; }

function captureCriterionEditorForm() {
  const form = document.querySelector('[data-criterion-form]');
  if (!form || !criterionEditor) return;
  const data = new FormData(form);
  criterionEditor = {
    ...criterionEditor,
    title: String(data.get('title') || '').trim(),
    category: String(data.get('category') || '').trim(),
    type: String(data.get('type') || criterionEditor.type || 'fixed').toLowerCase(),
    maxAmount: Number(data.get('maxAmount') || 0),
    amount: data.get('amount') === '' || data.get('amount') == null ? null : Number(data.get('amount')),
    allowEvidence: data.get('allowEvidence') === 'on',
    fields: [...form.querySelectorAll('[data-builder-field]')].map((row, index) => ({
      label: row.querySelector('[data-field-label]')?.value.trim() || `Поле ${index + 1}`,
      type: row.querySelector('[data-field-type]')?.value || 'TEXT',
      required: Boolean(row.querySelector('[data-field-required]')?.checked),
      options: (row.querySelector('[data-field-options]')?.value || '').split(',').map((value) => value.trim()).filter(Boolean),
    })),
  };
  criterionEditor.fields = uniqueKeys(criterionEditor.fields);
  const type = String(criterionEditor.type).toUpperCase();
  if (type === 'QUALITY') criterionEditor.qualityBands = [...form.querySelectorAll('[data-builder-scale]')].map((row) => ({ from: Number(row.querySelector('[data-scale-from]')?.value || 0), to: Number(row.querySelector('[data-scale-to]')?.value || 0), amount: Number(row.querySelector('[data-scale-amount]')?.value || 0) }));
  else if (type === 'OLYMPIAD') criterionEditor.scales = [...form.querySelectorAll('[data-builder-scale]')].map((row) => ({ key: `${row.querySelector('[data-scale-level]')?.value || 'municipal'}:${row.querySelector('[data-scale-diploma]')?.value || 'winner'}`, amount: Number(row.querySelector('[data-scale-amount]')?.value || 0) }));
}

// Transliterate Cyrillic so a Russian field label ("Комментарий") produces a valid
// Latin key ("komentariy") instead of the generic "field" fallback that collides.
const CYRILLIC_MAP = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const slugify = (label) => {
  const transliterated = String(label || '').toLowerCase().split('').map((char) => CYRILLIC_MAP[char] ?? char).join('');
  const slug = transliterated.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f$1').slice(0, 40);
  return slug || 'field';
};
// Identical labels (e.g. two "Название") get "_2"/"_3" suffixes instead of a hard error.
const uniqueKeys = (fields) => {
  const seen = new Map();
  return (fields || []).map((field) => {
    const base = slugify(field.label);
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return { ...field, key: count === 1 ? base : `${base}_${count}` };
  });
};

// Mirror server-side rules before submit so the deputy sees problems inline,
// right in the constructor, instead of a toast after a failed request.
function criterionEditorErrors(c) {
  const type = String(c.type || 'fixed').toUpperCase();
  const maxAmount = Number(c.maxAmount || 0);
  if (!String(c.title || '').trim()) return { form: 'Введите название критерия' };
  if (!String(c.category || '').trim()) return { form: 'Укажите категорию критерия' };
  if (!(maxAmount >= 0) || maxAmount > 1_000_000) return { form: 'Максимум должен быть целым числом от 0 до 1 000 000 ₽' };
  if (c.amount != null && c.amount !== '' && (Number(c.amount) < 0 || Number(c.amount) > maxAmount)) return { form: `Фиксированная сумма должна быть от 0 до ${maxAmount} ₽` };
  const fields = c.fields || [];
  for (const field of fields) {
    if (!String(field.label || '').trim()) return { form: 'У каждого поля для учителя должно быть название' };
    if (String(field.type).toUpperCase() === 'SELECT' && !(field.options || []).length) return { form: `Для списка «${field.label}» задайте варианты выбора` };
  }
  if (type === 'QUALITY') {
    const bands = c.qualityBands || [];
    if (!bands.length) return { form: 'Добавьте хотя бы один диапазон качества обученности' };
    const sorted = [...bands].sort((a, b) => Number(a.from || 0) - Number(b.from || 0));
    for (const band of sorted) {
      const from = Number(band.from), to = Number(band.to);
      if (!(from >= 0) || !(to <= 100) || from > to) return { form: 'Диапазоны процентов должны быть от 0 до 100, начало не больше конца' };
      if (Number(band.amount) > maxAmount) return { form: `Выплата за ${from}–${to}% превышает максимум ${maxAmount} ₽` };
    }
    for (let i = 1; i < sorted.length; i++) if (Number(sorted[i].from) <= Number(sorted[i - 1].to)) return { form: 'Диапазоны процентов не должны пересекаться' };
    const covered = sorted.some((band) => Number(band.from) <= 0 && Number(band.to) >= 100);
    if (!covered && sorted[0] && Number(sorted[0].from) > 0) return { form: 'Первый диапазон должен начинаться с 0%, чтобы процент не остался без выплаты' };
  }
  if (type === 'OLYMPIAD') {
    const scales = c.scales || [];
    if (!scales.length) return { form: 'Добавьте хотя бы одну шкалу олимпиады' };
    const keys = new Set();
    for (const scale of scales) {
      if (!String(scale.key || '').includes(':')) return { form: 'Шкала олимпиады должна иметь уровень и степень диплома' };
      if (keys.has(scale.key)) return { form: 'Шкала олимпиады указана повторно — удалите дубликат' };
      keys.add(scale.key);
      if (Number(scale.amount) > maxAmount) return { form: 'Выплата по шкале олимпиады превышает максимум' };
    }
  }
  return {};
}

function criterionEditorView() {
  if (!criterionEditor) return '';
  const c = criterionEditor;
  const errors = criterionEditorErrors(c);
  const bands = c.qualityBands || QUALITY_BANDS;
  const olympiad = c.scales?.some((scale) => scale.key?.includes(':')) ? c.scales.filter((scale) => scale.key?.includes(':')) : Object.entries(c.olympiadAmounts || {}).flatMap(([level, values]) => Object.entries(values).map(([diploma, amount]) => ({ key: `${level}:${diploma}`, amount })));
  const fields = c.fields || [];
  const usedCount = Number(String(c.usage || '').split(' ')[0]) || 0;
  const fieldRows = fields.map((field, index) => `<div class="builder-row" data-builder-field data-field-index="${index}"><input data-field-label value="${escapeHtml(field.label || '')}" placeholder="Название поля" /><select data-field-type><option value="TEXT" ${String(field.type).toUpperCase() === 'TEXT' ? 'selected' : ''}>Текст</option><option value="NUMBER" ${String(field.type).toUpperCase() === 'NUMBER' ? 'selected' : ''}>Число</option><option value="SELECT" ${String(field.type).toUpperCase() === 'SELECT' ? 'selected' : ''}>Список</option><option value="DATE" ${String(field.type).toUpperCase() === 'DATE' ? 'selected' : ''}>Дата</option><option value="FILE" ${String(field.type).toUpperCase() === 'FILE' ? 'selected' : ''}>Файл</option></select><input data-field-options value="${escapeHtml(Array.isArray(field.options) ? field.options.join(', ') : '')}" placeholder="Варианты через запятую" /><label class="row-check"><input type="checkbox" data-field-required ${field.required ? 'checked' : ''}/> Обяз.</label><button type="button" class="icon-button danger" data-remove-builder-field title="Удалить поле">×</button></div>`).join('');
  const scaleRows = (c.type === 'quality' ? bands : c.type === 'olympiad' ? olympiad : (c.scales || [])).map((scale, index) => c.type === 'quality' ? `<div class="builder-row" data-builder-scale data-scale-index="${index}"><input type="number" min="0" max="100" data-scale-from value="${scale.from ?? 0}" aria-label="От процентов"/><span>–</span><input type="number" min="0" max="100" data-scale-to value="${scale.to ?? 100}" aria-label="До процентов"/><input type="number" min="0" data-scale-amount value="${scale.amount ?? 0}" aria-label="Выплата"/><i>₽</i><button type="button" class="icon-button danger" data-remove-builder-scale title="Удалить диапазон">×</button></div>` : c.type === 'olympiad' ? `<div class="builder-row" data-builder-scale data-scale-index="${index}"><select data-scale-level>${OLYMPIAD_LEVELS.map((level) => `<option value="${level.id}" ${scale.key?.split(':')[0] === level.id ? 'selected' : ''}>${level.label}</option>`).join('')}</select><select data-scale-diploma>${DIPLOMA_TYPES.map((type) => `<option value="${type.id}" ${scale.key?.split(':')[1] === type.id ? 'selected' : ''}>${type.label}</option>`).join('')}</select><input type="number" min="0" data-scale-amount value="${scale.amount ?? 0}" aria-label="Выплата"/><i>₽</i><button type="button" class="icon-button danger" data-remove-builder-scale title="Удалить шкалу">×</button></div>` : '').join('');
  return `<div class="modal-backdrop"><form class="criterion-modal" data-criterion-form role="dialog" aria-modal="true" aria-label="Конструктор критерия"><div class="modal-head"><div><span class="eyebrow">КОНСТРУКТОР</span><h2>${c.id ? `Изменить критерий${c.version ? ` · версия ${c.version}` : ''}` : 'Новый критерий'}</h2></div><button type="button" class="icon-button" data-action="close-criterion" aria-label="Закрыть">×</button></div>${c.id && usedCount > 0 ? `<div class="builder-warning">Критерий использован в ${c.usage}. Уже отправленные заявки сохранят прежнюю шкалу выплат.</div>` : ''}<div class="builder-grid"><label>Название<input required name="title" value="${escapeHtml(c.title || '')}" /></label><label>Категория<input required name="category" value="${escapeHtml(c.category || '')}" list="criterion-categories" /><datalist id="criterion-categories"><option value="Учебная деятельность"><option value="Методическая работа"><option value="Воспитательная работа"></datalist></label><label>Тип<select name="type"><option value="fixed" ${c.type === 'fixed' ? 'selected' : ''}>Фиксированная выплата</option><option value="quality" ${c.type === 'quality' ? 'selected' : ''}>Качество обученности</option><option value="olympiad" ${c.type === 'olympiad' ? 'selected' : ''}>Олимпиады</option><option value="custom" ${c.type === 'custom' ? 'selected' : ''}>Пользовательский</option></select></label><label>Максимум, ₽<input required type="number" min="0" name="maxAmount" value="${c.maxAmount ?? 0}" /></label>${c.type === 'fixed' || c.type === 'custom' ? `<label>Фиксированная сумма, ₽<input type="number" min="0" name="amount" value="${c.amount ?? ''}" /><small class="builder-hint">Пусто — равна максимуму</small></label>` : ''}<label class="check-field"><input type="checkbox" name="allowEvidence" ${c.allowEvidence ? 'checked' : ''} /> Разрешить подтверждающий документ</label></div>${errors.form ? `<div class="builder-error" role="alert">${errors.form}</div>` : ''}<div class="builder-section"><div class="builder-section-head"><b>Поля для учителя</b><button type="button" class="btn ghost small" data-add-builder-field>${icons.plus} Добавить поле</button></div><div class="builder-rows" data-builder-fields>${fieldRows || '<p class="builder-empty">Дополнительные поля не заданы — учитель увидит только сумму критерия.</p>'}</div></div><div class="builder-section"><div class="builder-section-head"><b>Шкалы выплат</b>${c.type !== 'fixed' ? '<button type="button" class="btn ghost small" data-add-builder-scale>' + icons.plus + ' Добавить строку</button>' : ''}</div><div class="builder-rows" data-builder-scales>${scaleRows || '<p class="builder-empty">Шкалы не заданы — выплата равна фиксированной сумме.</p>'}</div></div><div class="modal-actions"><button type="button" class="btn ghost" data-action="close-criterion">Отмена</button><button class="btn primary" type="submit">Сохранить критерий</button></div></form></div>`;
}

function criteriaView() {
  const categories = [...new Set(state.criteria.map((c) => c.category).filter(Boolean))].sort();
  const query = criteriaSearch.trim().toLowerCase();
  const visible = state.criteria.filter((c) => (criteriaCategory === 'all' || c.category === criteriaCategory) && (!query || c.title.toLowerCase().includes(query) || c.category.toLowerCase().includes(query)));
  return shell(`${header('Конструктор критериев', 'Настройте выплаты и шкалы, которые увидят учителя.', '<button class="btn primary" data-action="new-criterion">' + icons.plus + ' Новый критерий</button>')}<div class="panel table-panel"><div class="table-toolbar"><div class="search"><span class="search-icon" aria-hidden="true">${icons.search}</span><input placeholder="Поиск критерия" value="${escapeHtml(criteriaSearch)}" data-criteria-search /></div><select data-criteria-category><option value="all">Все категории</option>${categories.map((category) => `<option value="${escapeHtml(category)}" ${criteriaCategory === category ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}</select></div><div class="criteria-helper">Завуч задаёт суммы. Для качества обученности доступны диапазоны процентов, а для олимпиад — выплаты по уровню и степени диплома.</div><div class="table-scroll"><table><thead><tr><th>КРИТЕРИЙ</th><th>КАТЕГОРИЯ</th><th>НАСТРОЙКА ВЫПЛАТЫ</th><th>ИСПОЛЬЗОВАНИЕ</th><th>СТАТУС</th><th></th></tr></thead><tbody>${initialLoading ? skeletonRows(6, 4) : visible.length ? visible.map((c) => `<tr class="${c.active ? '' : 'row-inactive'}"><td><b>${escapeHtml(c.title)}</b><small class="table-sub">Код ${c.id} · v${c.version}</small></td><td>${escapeHtml(c.category)}</td><td>${c.type === 'quality' ? `<div class="quality-admin-grid">${(c.qualityBands || QUALITY_BANDS).map((band, index) => `<label>${band.from}–${band.to}%<span class="amount-edit"><input type="number" min="0" max="${c.maxAmount}" value="${band.amount}" aria-label="Выплата за ${band.from}–${band.to}%" data-quality-amount="${c.id}" data-band-index="${index}" /><i>₽</i></span></label>`).join('')}</div>` : c.type === 'olympiad' ? `<span class="range-label" title="Выплаты по уровню и диплому">Уровень + диплом · ${c.scales.length} шкал</span>` : `<label class="amount-edit"><input type="number" min="0" max="${c.maxAmount}" value="${c.amount ?? c.maxAmount}" aria-label="Фиксированная сумма критерия: ${c.title}" data-criterion-amount="${c.id}" /><span aria-hidden="true">₽</span></label>`}</td><td>${escapeHtml(c.usage)}</td><td>${badge(c.active ? 'approved' : 'draft')}</td><td><button class="icon-button" data-edit-criterion="${c.id}" title="Изменить">${icons.sliders}</button><button class="icon-button" data-toggle-criterion="${c.id}" title="${c.active ? 'Отключить' : 'Вернуть в работу'}" aria-label="${c.active ? 'Отключить' : 'Вернуть в работу'}">${c.active ? '−' : '↺'}</button><button class="icon-button danger" data-delete-criterion="${c.id}" title="Удалить">×</button></td></tr>`).join('') : `<tr><td colspan="6"><div class="empty-detail"><span>${icons.pencil}</span><b>Критериев пока нет</b><p>Создайте первый критерий — он появится в заявках учителей.</p><button class="btn primary" data-action="new-criterion">${icons.plus} Новый критерий</button></div></td></tr>`}</tbody></table></div><div class="table-footer"><span>Показано ${visible.length} из ${state.criteria.length}</span></div></div>${criterionEditorView()}`);
}
function staffView() {
  const schoolUsers = state.users.filter((u) => u.schoolId === state.currentAdmin.schoolId);
  const query = staffSearch.trim().toLowerCase();
  const visible = schoolUsers.filter((u) => !query || u.name.toLowerCase().includes(query) || String(u.position || '').toLowerCase().includes(query));
  const appFor = (user) => state.applications.find((x) => x.teacherId === user.id && x.schoolId === state.currentAdmin.schoolId);
  return shell(`${header('Сотрудники', 'Реестр педагогических работников учреждения.', '')}<div class="panel table-panel"><div class="table-toolbar"><div class="search"><span class="search-icon" aria-hidden="true">${icons.search}</span><input placeholder="Поиск по ФИО или должности" value="${escapeHtml(staffSearch)}" data-staff-search /></div></div><div class="table-scroll"><table><thead><tr><th>СОТРУДНИК</th><th>ДОЛЖНОСТЬ</th><th>ЗАЯВКА</th><th>СТАТУС</th><th></th></tr></thead><tbody>${initialLoading ? skeletonRows(5, 4) : visible.length ? visible.map((u) => { const a = appFor(u); return `<tr data-select-user="${u.id}"><td><div class="person"><span class="avatar small">${u.initials}</span><span><b>${escapeHtml(u.name)}</b><small>${escapeHtml(u.position || '—')}</small></span></div></td><td>${escapeHtml(u.position || '—')}</td><td>${a ? `${a.items.length} критериев · ${rub(a.total)}` : '<span class="muted-text">Нет заявки</span>'}</td><td>${a ? badge(a.status) : '<span class="muted-text">—</span>'}</td><td>${icons.arrow}</td></tr>`; }).join('') : `<tr><td colspan="5"><div class="empty-detail"><span>${icons.search}</span><b>Сотрудники не найдены</b><p>${query ? 'Попробуйте другой запрос.' : 'Зарегистрированные учителя появятся здесь после входа в систему.'}</p></div></td></tr>`}</tbody></table></div>${!initialLoading && visible.length ? `<div class="table-footer"><span>Показано ${visible.length} из ${schoolUsers.length}</span></div>` : ''}</div>`);
}

function periodsView() {
  const periods = allPeriods.length ? allPeriods : [state.activePeriod];
  const today = new Date().toISOString().slice(0, 10);
  return shell(`${header('Отчётные периоды', 'Управляйте приёмом заявок: новый период автоматически закрывает предыдущий.', '<button class="btn primary" data-action="new-period">'+icons.plus+' Новый период</button>')}
    ${periodEditor ? periodEditorForm(today) : ''}
    <div class="panel table-panel"><div class="table-scroll"><table><thead><tr><th>ПЕРИОД</th><th>ПРИЁМ ЗАЯВОК</th><th>ЗДАНО ЗАЯВОК</th><th>СТАТУС</th><th></th></tr></thead><tbody>${periods.map((p) => `<tr><td><b>${p.label}</b></td><td>${formatDate(p.startsAt)} — ${formatDate(p.endsAt)}</td><td>${p.submittedCount != null ? p.submittedCount : '—'}</td><td>${badge(p.active ? 'approved' : 'draft')}</td><td>${p.active ? `<button class="btn ghost small" data-close-period="${p.id}">Закрыть приём</button>` : `<span class="muted-text">Архив</span>`}</td></tr>`).join('')}</tbody></table></div></div>`);
}

function periodEditorForm(today) {
  return `<div class="modal-backdrop"><form class="criterion-modal period-modal" data-period-form role="dialog" aria-modal="true" aria-label="Новый отчётный период"><div class="modal-head"><div><span class="eyebrow">НОВЫЙ ПЕРИОД</span><h2>Открыть приём заявок</h2></div><button type="button" class="icon-button" data-action="close-period" aria-label="Закрыть">×</button></div><div class="builder-grid"><label>Название периода<input required name="label" value="${periodEditor.label || ''}" placeholder="1 полугодие 2026–2027 уч. г." /></label><label class="hidden"></label><label>Начало приёма<input required type="date" name="startsAt" value="${periodEditor.startsAt || today}" /></label><label>Окончание приёма<input required type="date" name="endsAt" value="${periodEditor.endsAt || ''}" /></label></div><div class="modal-actions"><button type="button" class="btn ghost" data-action="close-period">Отмена</button><button class="btn primary" type="submit">Открыть период</button></div></form></div>`;
}
function reportsView() { const approved = getReviewableApplications(state, state.currentAdmin.schoolId).filter((a) => a.status === 'approved'); return shell(`${header('Отчёты', 'Сформируйте реестр утверждённых выплат для бухгалтерии.', '<button class="btn primary" data-action="export">'+icons.download+' Скачать Excel</button>')}<div class="report-hero"><div><span class="eyebrow light">ГОТОВ К ВЫГРУЗКЕ</span><h2>Реестр выплат</h2><p>${state.activePeriod.label} · сформирован на основании утверждённых заявок</p></div><div class="report-total"><span>ИТОГО К ВЫПЛАТЕ</span><b>${rub(approved.reduce((s, a) => s + a.total, 0))}</b></div></div><div class="panel report-table-panel"><div class="panel-head"><div><span class="eyebrow">СОСТАВ ОТЧЁТА</span><h3>Утверждённые выплаты</h3></div><span class="muted-text report-count">${approved.length} записи</span></div><div class="table-scroll"><table class="report-table"><thead><tr><th>ФИО</th><th>КРИТЕРИИ</th><th>СУММА</th><th>СТАТУС</th></tr></thead><tbody>${approved.map((a) => `<tr><td><b>${userById(a.teacherId).name}</b></td><td>${a.items.map((x) => x.title).join(', ')}</td><td class="report-amount"><b>${rub(a.total)}</b></td><td>${badge('approved')}</td></tr>`).join('')}</tbody></table></div></div>`); }

function render() { const page = !authenticated ? authView() : state.activeRole === 'teacher' ? ({ overview: teacherOverview, application: applicationView, account: accountView }[view] || teacherOverview)() : ({ review: reviewView, criteria: criteriaView, periods: periodsView, staff: staffView, reports: reportsView, account: accountView }[view] || reviewView)(); document.querySelector('#app').innerHTML = page; bind(); }

function bind() {
  document.querySelector('[data-auth-mode]')?.addEventListener('click', () => { authMode = document.querySelector('[data-auth-mode]').dataset.authMode; authError = ''; render(); });
  document.querySelector('[data-action="toggle-notifications"]')?.addEventListener('click', () => { notificationsOpen = !notificationsOpen; render(); });
  document.querySelectorAll('[data-notification-read]').forEach((el) => el.addEventListener('click', async () => {
    const id = el.dataset.notificationRead;
    const item = notifications.find((notification) => notification.id === id);
    if (!item || item.readAt) return;
    item.readAt = new Date().toISOString();
    state.notifications = notifications;
    saveState(state);
    if (backendReady) await api.markNotificationRead(id).catch(() => {});
    render();
  }));
  document.querySelector('.mobile-menu')?.addEventListener('click', () => {
    const sidebar = document.querySelector('.sidebar');
    const button = document.querySelector('.mobile-menu');
    if (!sidebar || !button) return;
    const open = sidebar.classList.toggle('mobile-open');
    button.setAttribute('aria-expanded', String(open));
  });
  document.querySelector('[data-auth-submit]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      authError = '';
      const result = authMode === 'register' ? await api.register({ ...data, role: data.role || 'TEACHER' }) : await api.login({ email: data.email, password: data.password });
      state.activeRole = result.user.role === 'DEPUTY' ? 'admin' : 'teacher';
      view = state.activeRole === 'teacher' ? 'overview' : 'review';
      authenticated = true;
      await hydrateBackend();
    } catch (error) { authError = error.message || 'Не удалось выполнить вход'; render(); }
  });
  document.querySelector('[data-action="new-criterion"]')?.addEventListener('click', () => { criterionEditor = { type: 'fixed', category: 'Другое', maxAmount: 0, amount: 0, allowEvidence: false, fields: [] }; render(); });
  document.querySelector('[data-criteria-search]')?.addEventListener('input', (event) => { criteriaSearch = event.target.value; render(); const input = document.querySelector('[data-criteria-search]'); if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); } });
  document.querySelector('[data-criteria-category]')?.addEventListener('change', (event) => { criteriaCategory = event.target.value; render(); });
  document.querySelector('[data-review-search]')?.addEventListener('input', (event) => { reviewSearch = event.target.value; render(); const input = document.querySelector('[data-review-search]'); if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); } });
  document.querySelector('[data-review-status]')?.addEventListener('change', (event) => { reviewStatus = event.target.value; render(); });
  document.querySelector('[data-staff-search]')?.addEventListener('input', (event) => { staffSearch = event.target.value; render(); const input = document.querySelector('[data-staff-search]'); if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); } });
  document.querySelectorAll('[data-edit-criterion]').forEach((el) => el.addEventListener('click', () => { criterionEditor = structuredClone(state.criteria.find((c) => c.id === el.dataset.editCriterion)); render(); }));
  document.querySelectorAll('[data-toggle-criterion]').forEach((el) => el.addEventListener('click', async () => { const c = state.criteria.find((x) => x.id === el.dataset.toggleCriterion); if (!c) return; const active = !c.active; try { const updated = backendReady ? await api.updateCriterionStatus(c.id, active) : { ...c, active }; Object.assign(c, mapCriterion(updated)); persist(active ? 'Критерий возвращён в работу' : 'Критерий отключён'); } catch (error) { showToastError(error.message || 'Не удалось изменить статус критерия'); } }));
  document.querySelectorAll('[data-delete-criterion]').forEach((el) => el.addEventListener('click', async () => { const c = state.criteria.find((x) => x.id === el.dataset.deleteCriterion); if (!c || !window.confirm(`Отключить критерий «${c.title}»? Он исчезнет из заявок учителей, но история сохранится.`)) return; try { if (backendReady) { const updated = await api.deleteCriterion(c.id); Object.assign(c, mapCriterion(updated)); } else { c.active = false; } persist('Критерий отключён'); } catch (error) { showToastError(error.message || 'Не удалось удалить критерий'); } }));
  document.querySelectorAll('[data-action="close-criterion"]').forEach((el) => el.addEventListener('click', () => { criterionEditor = null; render(); }));
  document.querySelector('[data-add-builder-field]')?.addEventListener('click', () => { captureCriterionEditorForm(); criterionEditor.fields = [...(criterionEditor.fields || []), { label: '', type: 'TEXT', required: false, options: [] }]; render(); });
  document.querySelectorAll('[data-remove-builder-field]').forEach((el) => el.addEventListener('click', () => { captureCriterionEditorForm(); const row = el.closest('[data-builder-field]'); criterionEditor.fields = (criterionEditor.fields || []).filter((_, index) => index !== Number(row?.dataset.fieldIndex)); render(); }));
  document.querySelector('[data-add-builder-scale]')?.addEventListener('click', () => { captureCriterionEditorForm(); if (criterionEditor.type === 'quality') criterionEditor.qualityBands = [...(criterionEditor.qualityBands || []), { from: 0, to: 100, amount: 0 }]; else if (criterionEditor.type === 'olympiad') criterionEditor.scales = [...(criterionEditor.scales || []), { key: 'municipal:winner', amount: 0 }]; render(); });
  document.querySelectorAll('[data-remove-builder-scale]').forEach((el) => el.addEventListener('click', () => { captureCriterionEditorForm(); const row = el.closest('[data-builder-scale]'); const index = Number(row?.dataset.scaleIndex); if (criterionEditor.type === 'quality') criterionEditor.qualityBands = (criterionEditor.qualityBands || []).filter((_, i) => i !== index); else criterionEditor.scales = (criterionEditor.scales || []).filter((_, i) => i !== index); render(); }));
  document.querySelector('[data-criterion-form] select[name="type"]')?.addEventListener('change', (event) => { captureCriterionEditorForm(); criterionEditor.type = event.target.value; if (criterionEditor.type === 'quality' && !criterionEditor.qualityBands?.length) criterionEditor.qualityBands = QUALITY_BANDS.map((band) => ({ ...band })); render(); });
  document.querySelector('[data-criterion-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const type = String(data.get('type') || 'fixed').toUpperCase();
    const fields = uniqueKeys([...form.querySelectorAll('[data-builder-field]')].map((row, index) => ({ label: row.querySelector('[data-field-label]')?.value.trim() || `Поле ${index + 1}`, type: row.querySelector('[data-field-type]')?.value || 'TEXT', required: Boolean(row.querySelector('[data-field-required]')?.checked), options: (row.querySelector('[data-field-options]')?.value || '').split(',').map((value) => value.trim()).filter(Boolean) })));
    let scales = [...form.querySelectorAll('[data-builder-scale]')].map((row) => type === 'QUALITY' ? ({ from: Number(row.querySelector('[data-scale-from]')?.value || 0), to: Number(row.querySelector('[data-scale-to]')?.value || 0), amount: Number(row.querySelector('[data-scale-amount]')?.value || 0) }) : type === 'OLYMPIAD' ? ({ key: `${row.querySelector('[data-scale-level]')?.value || 'municipal'}:${row.querySelector('[data-scale-diploma]')?.value || 'winner'}`, amount: Number(row.querySelector('[data-scale-amount]')?.value || 0) }) : null).filter(Boolean);
    if (type === 'QUALITY' && !scales.length) scales = QUALITY_BANDS.map((band) => ({ ...band }));
    const draft = { ...criterionEditor, type: String(data.get('type') || 'fixed').toLowerCase(), title: String(data.get('title') || '').trim(), category: String(data.get('category') || '').trim(), maxAmount: Number(data.get('maxAmount') || 0), amount: data.get('amount') === '' || data.get('amount') == null ? null : Number(data.get('amount')), allowEvidence: data.get('allowEvidence') === 'on', fields, ...(type === 'QUALITY' ? { qualityBands: scales } : {}), scales };
    const validation = criterionEditorErrors(draft);
    if (validation.form) { criterionEditor = draft; render(); showToastError(validation.form); return; }
    const payload = { title: draft.title, category: draft.category, type, maxAmount: draft.maxAmount, amount: draft.amount, allowEvidence: draft.allowEvidence, fields: draft.fields, scales };
    try {
      const saved = backendReady ? (criterionEditor.id ? await api.updateCriterion(criterionEditor.id, payload) : await api.createCriterion(payload)) : { ...criterionEditor, ...payload, id: criterionEditor.id || `criterion-${Date.now()}`, type: type.toLowerCase(), qualityBands: type === 'QUALITY' ? scales : undefined, scales };
      const mapped = mapCriterion(saved); const index = state.criteria.findIndex((c) => c.id === mapped.id); if (index >= 0) state.criteria[index] = mapped; else state.criteria.push(mapped); criterionEditor = null; persist('Критерий сохранён');
    } catch (error) { showToastError(error.message || 'Не удалось сохранить критерий'); }
  });
  document.querySelector('[data-action="save-school"]')?.addEventListener('click', async () => { const user = state.activeRole === 'teacher' ? state.currentUser : state.currentAdmin; user.name = document.querySelector('[data-profile-name]').value; user.position = document.querySelector('[data-profile-position]').value; if (backendReady) { try { const updated = await api.updateProfile({ fullName: user.name, position: user.position }); Object.assign(user, mapUser(updated)); } catch { backendReady = false; } } persist('Профиль сохранён'); });
  document.querySelectorAll('[data-view]').forEach((el) => el.addEventListener('click', () => setView(el.dataset.view)));
  document.querySelectorAll('[data-select]').forEach((el) => el.addEventListener('click', () => { selectedAppId = el.dataset.select; render(); }));
  document.querySelectorAll('[data-add]').forEach((el) => el.addEventListener('click', () => { const c = state.criteria.find((x) => x.id === el.dataset.add); const a = state.applications.find((x) => x.teacherId === state.currentUser.id && x.periodId === state.activePeriod.id); const item = { criterionId: c.id, title: c.title, category: c.category, amount: c.amount ?? c.maxAmount, maxAmount: c.maxAmount, evidence: 'Добавьте документ', progress: 0, values: {} }; if (c.type === 'quality') item.percentage = ''; if (c.type === 'olympiad') item.entries = []; a.items.push(item); recalculateApplication(a); persist('Критерий добавлен в заявку'); }));
  document.querySelectorAll('[data-remove]').forEach((el) => el.addEventListener('click', () => { const a = state.applications.find((x) => x.teacherId === state.currentUser.id && x.periodId === state.activePeriod.id); a.items = a.items.filter((x) => x.criterionId !== el.dataset.remove); a.total = a.items.reduce((sum, x) => sum + x.amount, 0); persist('Критерий удалён'); }));
  document.querySelectorAll('[data-criterion-amount]').forEach((el) => el.addEventListener('change', async () => { const c = state.criteria.find((x) => x.id === el.dataset.criterionAmount); if (!c) return; Object.assign(c, updateCriterionAmount(c, el.value)); if (backendReady) { try { const updated = await api.updateCriterion(c.id, criterionUpdatePayload(c)); Object.assign(c, mapCriterion(updated)); } catch (error) { showToastError(error.message || 'Не удалось сохранить сумму'); return; } } state.applications.forEach((a) => { recalculateApplication(a); }); persist(`Фиксированная сумма изменена: ${rub(c.amount)}`); }));
  document.querySelectorAll('[data-quality-amount]').forEach((el) => el.addEventListener('change', async () => { const c = state.criteria.find((x) => x.id === el.dataset.qualityAmount); if (!c) return; c.qualityBands = c.qualityBands || QUALITY_BANDS.map((band) => ({ ...band })); c.qualityBands[Number(el.dataset.bandIndex)].amount = updateCriterionAmount({ maxAmount: c.maxAmount }, el.value).amount; if (backendReady) { try { const updated = await api.updateCriterion(c.id, criterionUpdatePayload(c)); Object.assign(c, mapCriterion(updated)); } catch (error) { showToastError(error.message || 'Не удалось сохранить шкалу'); return; } } state.applications.forEach((a) => recalculateApplication(a)); persist('Шкала качества обученности сохранена'); }));
  document.querySelectorAll('[data-file]').forEach((el) => el.addEventListener('change', async () => { const a = state.applications.find((x) => x.teacherId === state.currentUser.id && x.periodId === state.activePeriod.id); const item = a?.items.find((x) => x.criterionId === el.dataset.file); const file = el.files?.[0]; if (!item || !file) return; try { const uploaded = backendReady && !a.id.startsWith('app-') ? await api.uploadFile(file, a.id, item.id) : null; item.evidence = uploaded?.originalName || file.name; item.fileId = uploaded?.id || item.fileId; persist('Документ прикреплён'); } catch (error) { showToastError(error.message || 'Не удалось загрузить документ'); } }));
  document.querySelectorAll('[data-quality-percent]').forEach((el) => el.addEventListener('change', () => { const a = state.applications.find((x) => x.teacherId === state.currentUser.id && x.periodId === state.activePeriod.id); const item = a.items.find((x) => x.criterionId === el.dataset.qualityPercent); item.percentage = normalizeQualityPercentage(el.value); recalculateApplication(a); persist('Процент обученности сохранён'); }));
  document.querySelectorAll('[data-custom-field]').forEach((el) => el.addEventListener('change', () => { const a = state.applications.find((x) => x.teacherId === state.currentUser.id && x.periodId === state.activePeriod.id); const item = a?.items.find((x) => x.criterionId === el.dataset.criterion); if (!item) return; item.values = { ...(item.values || {}), [el.dataset.fieldKey]: el.value }; persist('Данные критерия сохранены'); }));
  document.querySelectorAll('[data-add-student]').forEach((el) => el.addEventListener('click', () => { const a = state.applications.find((x) => x.teacherId === state.currentUser.id && x.periodId === state.activePeriod.id); const item = a.items.find((x) => x.criterionId === el.dataset.addStudent); item.entries = [...(item.entries || []), { level: 'municipal', diploma: 'winner', studentName: '', olympiadName: '' }]; recalculateApplication(a); persist('Добавлена строка обучающегося'); }));
  document.querySelectorAll('[data-remove-student]').forEach((el) => el.addEventListener('click', () => { const a = state.applications.find((x) => x.teacherId === state.currentUser.id && x.periodId === state.activePeriod.id); const item = a.items.find((x) => x.criterionId === el.dataset.removeStudent); item.entries.splice(Number(el.dataset.entry), 1); recalculateApplication(a); persist('Строка обучающегося удалена'); }));
  document.querySelectorAll('[data-olympiad-field]').forEach((el) => el.addEventListener('change', () => { const a = state.applications.find((x) => x.teacherId === state.currentUser.id && x.periodId === state.activePeriod.id); const item = a.items.find((x) => x.criterionId === el.dataset.criterion); if (!item?.entries?.[el.dataset.entry]) return; item.entries[el.dataset.entry][el.dataset.olympiadField] = el.value; recalculateApplication(a); persist('Данные олимпиады сохранены'); }));
  document.querySelectorAll('[data-decision]').forEach((el) => el.addEventListener('click', async () => { const a = state.applications.find((x) => x.id === el.dataset.id); if (!a) return; const approved = el.dataset.decision === 'approved'; const comment = approved ? '' : window.prompt('Укажите причину отклонения:', 'Добавьте подтверждающий документ'); if (!approved && !comment) return; try { const result = backendReady && !a.id.startsWith('app-') ? (approved ? await api.approveReview(a.id) : await api.rejectReview(a.id, comment)) : decideApplication(a, approved ? 'approved' : 'rejected', comment); if (result?.items) Object.assign(a, mapApplication(result)); else Object.assign(a, { status: String(result?.status || (approved ? 'APPROVED' : 'REJECTED')).toLowerCase(), comment: result?.comment || (approved ? '' : comment) }); state.audit.unshift({ action: approved ? 'Заявка утверждена' : 'Заявка отклонена', target: `${userById(a.teacherId).name} · #${a.id.replace('app-', '')}`, time: 'Только что', tone: approved ? 'green' : 'red' }); persist(approved ? 'Заявка утверждена' : 'Заявка отправлена на доработку'); } catch (error) { showToastError(error.message || 'Не удалось сохранить решение'); } }));
  document.querySelector('[data-action="submit"]')?.addEventListener('click', async () => {
    if (submitInFlight) return;
    const a = state.applications.find((x) => x.teacherId === state.currentUser.id && x.periodId === state.activePeriod.id);
    if (!a.items.length) return showToastError('Добавьте хотя бы один критерий');
    const errors = getApplicationValidationErrors(a, state.criteria);
    if (errors.some((error) => error.code === 'quality-percentage')) return showToastError('Укажите процент обученности от 0 до 100');
    if (errors.some((error) => error.code === 'olympiad-entry')) return showToastError('Заполните данные каждого участника олимпиады');
    if (errors.some((error) => error.code === 'field-required')) return showToastError('Заполните обязательные поля критериев');
    if (errors.some((error) => ['field-number', 'field-select'].includes(error.code))) return showToastError('Проверьте заполнение полей критериев');
    submitInFlight = true;
    try {
      if (backendReady && !a.id.startsWith('app-')) {
        // Flush any autosave started by the last field edit before changing status.
        await applicationSyncPromise;
        const saved = await api.updateApplication(a.id, { items: a.items.map((item) => ({ criterionId: item.criterionId, values: { ...(item.values || {}), ...(item.percentage !== undefined ? { percentage: item.percentage } : {}) }, entries: item.entries || [] })) });
        const submitted = await api.submitApplication(a.id);
        // A refresh is useful for complete item data, but must not hide a successful submit.
        const fresh = (await api.listApplications().catch(() => [])).find((item) => item.id === a.id);
        const mapped = mapApplication(fresh || saved);
        // The submit response is authoritative even if the list request was cached.
        mapped.status = String(submitted?.status || 'REVIEW').toLowerCase();
        mapped.comment = submitted?.comment || '';
        Object.assign(a, mapped);
      } else Object.assign(a, submitApplication(a));
      state.audit.unshift({ action: 'Заявка отправлена на проверку', target: `${state.currentUser.name} · #${a.id.replace('app-', '')}`, time: 'Только что', tone: 'amber' });
      saveState(state);
      render();
      showToast('Заявка отправлена на проверку');
    } catch (error) {
      showToastError(error.message || 'Не удалось отправить заявку');
    } finally {
      submitInFlight = false;
    }
  });
  document.querySelector('[data-action="save"]')?.addEventListener('click', () => persist('Черновик сохранён'));
  document.querySelector('[data-action="new-period"]')?.addEventListener('click', () => { periodEditor = {}; render(); });
  document.querySelector('[data-action="close-period"]')?.addEventListener('click', () => { periodEditor = null; render(); });
  document.querySelector('[data-close-period]')?.addEventListener('click', async (event) => {
    const period = allPeriods.find((p) => p.id === event.currentTarget.dataset.closePeriod);
    if (!period || !window.confirm(`Закрыть приём заявок за «${period.label}»? Учителя больше не смогут подавать заявки.`)) return;
    try { await api.closePeriod(period.id); period.active = false; state.activePeriod = allPeriods.find((p) => p.active) || state.activePeriod; persist('Приём заявок закрыт'); } catch (error) { showToastError(error.message || 'Не удалось закрыть период'); }
  });
  document.querySelector('[data-period-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (!data.label?.trim()) return showToastError('Введите название периода');
    try {
      const created = await api.createPeriod({ label: data.label.trim(), startsAt: data.startsAt, endsAt: data.endsAt });
      const mapped = mapPeriod(created);
      allPeriods = [mapped, ...allPeriods.filter((p) => p.id !== mapped.id)];
      state.activePeriod = mapped;
      if (state.activeRole === 'teacher' && !state.applications.some((a) => a.periodId === mapped.id)) {
        const app = await api.createApplication({ periodId: mapped.id }).catch(() => null);
        if (app) state.applications = [mapApplication(app), ...state.applications];
      }
      periodEditor = null;
      persist(`Период «${mapped.label}» открыт`);
    } catch (error) { showToastError(error.message || 'Не удалось создать период'); }
  });
  document.querySelector('[data-action="export"]')?.addEventListener('click', async () => { if (!backendReady) return showToastInfo('Файл .xlsx сформирован и готов к скачиванию'); try { const blob = await api.exportReport(state.activePeriod.id); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'реестр-выплат.xlsx'; link.click(); URL.revokeObjectURL(url); } catch { showToastError('Не удалось скачать отчёт'); } });
  document.querySelector('[data-action="logout"]')?.addEventListener('click', async () => { await api.logout().catch(() => {}); backendReady = false; authenticated = false; authMode = 'login'; authError = ''; render(); });

  document.querySelector('[data-action="close-toast"]')?.addEventListener('click', () => { clearTimeout(toastTimer); document.querySelector('#toast')?.classList.remove('is-visible'); });
  document.querySelector('[data-action="open-help"]')?.addEventListener('click', (event) => { event.stopPropagation(); helpOpen = !helpOpen; render(); });
  if (helpOpen) document.addEventListener('click', function closeHelp(event) { if (!event.target.closest('.help-wrap')) { helpOpen = false; document.removeEventListener('click', closeHelp); render(); } }, { once: false });

  // Modal keyboard support: ESC closes, Tab stays inside the dialog (focus trap).
  const modal = document.querySelector('[data-criterion-form], [data-period-form]');
  if (modal) {
    modal.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); criterionEditor = null; periodEditor = null; render(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...modal.querySelectorAll('button, input, select, textarea')].filter((el) => !el.disabled && el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    const firstInput = modal.querySelector('input, select, textarea');
    firstInput?.focus();
  }
}

render();
void hydrateBackend();
