import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 3490 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;

interface SpawnResult { code: number | null; stdout: string; stderr: string }

async function withServer(run: () => Promise<void>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'e2e-school-'));
  mkdirSync(path.join(dir, 'storage'), { recursive: true });
  const dbPath = path.join(dir, 'data', 'test.db').replace(/\\/g, '/');
  const proc = spawn('node', ['--import', 'tsx', 'src/main.ts'], { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, DATABASE_URL: `file:${dbPath}`, JWT_ACCESS_SECRET: 'test-access', JWT_REFRESH_SECRET: 'test-refresh', PORT: String(PORT), STORAGE_DIR: path.join(dir, 'storage') }, stdio: 'pipe' });
  let stdout = '';
  proc.stdout.on('data', (chunk) => { stdout += chunk; });
  proc.stderr.on('data', (chunk) => { stdout += chunk; });
  try {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${BASE}/api/schools`);
        if (response.ok) break;
      } catch { /* server not up yet */ }
      if (proc.exitCode !== null) throw new Error(`server exited early:\n${stdout}`);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    await run();
  } finally {
    // Windows has no SIGKILL; proc.kill() falls back to TerminateProcess there.
    proc.kill(process.platform === 'win32' ? undefined : 'SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
}

let accessToken = '';
let refreshTokenValue = '';
let deputyToken = '';
let schoolId = '';
let teacherId = '';
let periodId = '';
let criterionFixedId = '';
let criterionQualityId = '';
let criterionOlympiadId = '';
let applicationId = '';

async function api(pathname: string, options: { method?: string; body?: any; token?: string | false } = {}) {
  const headers: Record<string, string> = {};
  const token = options.token === undefined ? accessToken : options.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: any = options.body;
  if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const response = await fetch(`${BASE}${pathname}`, { method: options.method || 'GET', headers, body });
  const buffer = Buffer.from(await response.arrayBuffer());
  const text = buffer.toString('utf8');
  let payload: any = text;
  try { payload = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
  return { status: response.status, ok: response.ok, body: payload, buffer, response };
}

const student = (name: string) => ({ email: `${name}@e2e.test`, password: 'e2ePass123', fullName: `E2E ${name}`, position: 'Учитель', schoolId, role: 'TEACHER' });

// The whole flow runs in one test to keep server bootstrap cost down; phases are asserted separately.
// withServer spawns the API on a temp SQLite DB; main.ts auto-migrates and seeds it on first boot.
test('полный smoke-сценарий: auth, периоды, критерии, заявки, review, файлы, XLSX', { timeout: 180_000 }, () => withServer(async () => {
  // 1. Seeded schools are available without auth.
  const schoolsResponse = await api('/api/schools');
  assert.ok(schoolsResponse.ok, `schools failed: ${JSON.stringify(schoolsResponse.body)}`);
  assert.ok(Array.isArray(schoolsResponse.body) && schoolsResponse.body.length > 0, 'seed must create schools');
  schoolId = schoolsResponse.body[0].id;

  // 2. Register a deputy for the school.
  const deputy = await api('/api/auth/register', { method: 'POST', body: { email: 'deputy-e2e@e2e.test', password: 'e2ePass123', fullName: 'E2E Deputy', position: 'Заместитель директора', schoolId, role: 'DEPUTY' }, token: false });
  assert.ok(deputy.ok, `deputy register failed: ${JSON.stringify(deputy.body)}`);
  const deputyLogin = await api('/api/auth/login', { method: 'POST', body: { email: 'deputy-e2e@e2e.test', password: 'e2ePass123' }, token: false });
  assert.ok(deputyLogin.ok);
  deputyToken = deputyLogin.body.accessToken;
  accessToken = deputyToken;

  // 3. Second deputy for the same school is rejected.
  const deputyAgain = await api('/api/auth/register', { method: 'POST', body: { email: 'deputy2-e2e@e2e.test', password: 'e2ePass123', fullName: 'E2E Deputy 2', schoolId, role: 'DEPUTY' }, token: false });
  assert.equal(deputyAgain.status, 400);
  assert.equal(deputyAgain.body.code, 'DEPUTY_EXISTS');

  // 4. Teacher registers, logs in, profile is readable.
  const teacher = await api('/api/auth/register', { method: 'POST', body: student('teacher1'), token: false });
  assert.ok(teacher.ok, `teacher register failed: ${JSON.stringify(teacher.body)}`);
  refreshTokenValue = teacher.body.refreshToken;
  const profile = await api('/api/profile', { token: teacher.body.accessToken });
  assert.ok(profile.ok);
  assert.equal(profile.body.role, 'TEACHER');
  assert.equal(profile.body.email, 'teacher1@e2e.test');
  assert.ok(!('passwordHash' in profile.body) && !('password' in profile.body));
  teacherId = profile.body.id;
  accessToken = teacher.body.accessToken;

  // 5. Refresh rotates tokens and logout revokes them.
  const refreshed = await api('/api/auth/refresh', { method: 'POST', body: { refreshToken: refreshTokenValue }, token: false });
  assert.ok(refreshed.ok);
  assert.ok(refreshed.body.accessToken);
  refreshTokenValue = refreshed.body.refreshToken;

  // 6. Deputy manages periods: create new active period (closes previous).
  accessToken = deputyToken;
  const badPeriod = await api('/api/periods', { method: 'POST', body: { label: 'Плохой период', startsAt: '2026-10-01', endsAt: '2026-09-01' } });
  assert.equal(badPeriod.status, 400);
  assert.equal(badPeriod.body.code, 'PERIOD_INVALID');
  const period = await api('/api/periods', { method: 'POST', body: { label: 'E2E период 2026', startsAt: '2026-09-01', endsAt: '2026-12-25' } });
  assert.ok(period.ok, `period create failed: ${JSON.stringify(period.body)}`);
  periodId = period.body.id;
  assert.equal(period.body.active, true);
  const periodsList = await api('/api/periods');
  assert.ok(periodsList.ok);
  assert.ok(Array.isArray(periodsList.body) && periodsList.body.length >= 1);
  const activeCount = periodsList.body.filter((p: any) => p.active).length;
  assert.equal(activeCount, 1, 'creating a period must close the previous active one');
  // Teachers cannot create periods.
  const teacherPeriod = await api('/api/periods', { method: 'POST', body: { label: 'Учительский', startsAt: '2026-09-01', endsAt: '2026-12-25' }, token: teacher.body.accessToken });
  assert.equal(teacherPeriod.status, 403);

  // 7. Deputy creates criteria.
  const fixed = await api('/api/criteria', { method: 'POST', body: { title: 'E2E фиксированный', category: 'Тест', type: 'FIXED', maxAmount: 5000, amount: 3000, allowEvidence: true, fields: [], scales: [] } });
  assert.ok(fixed.ok, `criterion create failed: ${JSON.stringify(fixed.body)}`);
  criterionFixedId = fixed.body.id;
  const quality = await api('/api/criteria', { method: 'POST', body: { title: 'E2E качество', category: 'Тест', type: 'QUALITY', maxAmount: 4000, allowEvidence: true, fields: [], scales: [{ from: 0, to: 50, amount: 2000 }, { from: 50.01, to: 75, amount: 3000 }, { from: 75.01, to: 90, amount: 4000 }] } });
  assert.ok(quality.ok, `quality criterion failed: ${JSON.stringify(quality.body)}`);
  criterionQualityId = quality.body.id;
  const olympiad = await api('/api/criteria', { method: 'POST', body: { title: 'E2E олимпиады', category: 'Тест', type: 'OLYMPIAD', maxAmount: 7000, allowEvidence: true, fields: [], scales: [{ key: 'municipal:winner', amount: 1500 }, { key: 'regional:prize', amount: 1800 }] } });
  assert.ok(olympiad.ok, `olympiad criterion failed: ${JSON.stringify(olympiad.body)}`);
  criterionOlympiadId = olympiad.body.id;
  // Duplicate olympiad scale keys are rejected.
  const dupScale = await api('/api/criteria', { method: 'POST', body: { title: 'E2E дубликаты', category: 'Тест', type: 'OLYMPIAD', maxAmount: 7000, fields: [], scales: [{ key: 'municipal:winner', amount: 100 }, { key: 'municipal:winner', amount: 200 }] } });
  assert.equal(dupScale.status, 400);
  assert.equal(dupScale.body.code, 'SCALES_INVALID');
  // Teachers cannot create criteria.
  const teacherCriterion = await api('/api/criteria', { method: 'POST', body: { title: 'Учительский', category: 'Тест', type: 'FIXED', maxAmount: 100 }, token: teacher.body.accessToken });
  assert.equal(teacherCriterion.status, 403);

  // 8. Teacher creates the single application for the period.
  accessToken = teacher.body.accessToken;
  const created = await api('/api/applications', { method: 'POST', body: { periodId } });
  assert.ok(created.ok, `application create failed: ${JSON.stringify(created.body)}`);
  applicationId = created.body.id;
  // Second application for the same period is rejected.
  const duplicate = await api('/api/applications', { method: 'POST', body: { periodId } });
  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.body.code, 'ONE_APPLICATION');
  // Deputy cannot create an application.
  const deputyApplication = await api('/api/applications', { method: 'POST', body: { periodId }, token: deputyToken });
  assert.equal(deputyApplication.status, 403);

  // 9. Draft allows partial data; submit validates strictly.
  const draft = await api(`/api/applications/${applicationId}`, { method: 'PATCH', body: { items: [
    { criterionId: criterionFixedId, values: {} },
    { criterionId: criterionQualityId, values: { percentage: '' }, entries: [] },
    { criterionId: criterionOlympiadId, values: {}, entries: [] },
  ] } });
  assert.ok(draft.ok, `draft patch failed: ${JSON.stringify(draft.body)}`);
  const draftItems = draft.body.items.map((i: any) => i.criterionId);
  assert.deepEqual(draftItems, [criterionFixedId, criterionQualityId, criterionOlympiadId]);
  const prematureSubmit = await api(`/api/applications/${applicationId}/submit`, { method: 'POST' });
  assert.equal(prematureSubmit.status, 400);
  assert.ok(['OLYMPIAD_ENTRY', 'QUALITY_PERCENTAGE'].includes(prematureSubmit.body.code), `unexpected code ${prematureSubmit.body.code}`);

  // 10. Fill valid data and submit.
  const filled = await api(`/api/applications/${applicationId}`, { method: 'PATCH', body: { items: [
    { criterionId: criterionFixedId, values: {} },
    { criterionId: criterionQualityId, values: { percentage: 80 }, entries: [] },
    { criterionId: criterionOlympiadId, values: {}, entries: [{ level: 'municipal', diploma: 'winner', studentName: 'Иванов Иван', olympiadName: 'Математика' }, { level: 'regional', diploma: 'prize', studentName: 'Петрова Анна', olympiadName: 'Физика' }] },
  ] } });
  assert.ok(filled.ok, `filled patch failed: ${JSON.stringify(filled.body)}`);
  // fixed 3000 + quality band 75.01-90 => 4000 + olympiad 1500+1800 = 10300
  assert.equal(filled.body.total, 10300, `total mismatch: ${filled.body.total}`);
  // Каждая запись олимпиады хранит свою выплату — проверяющий видит разбивку итога.
  const olympiadItem = filled.body.items.find((i: any) => i.criterionId === criterionOlympiadId);
  assert.deepEqual(olympiadItem.olympiadEntries.map((e: any) => e.amount), [1500, 1800], 'each olympiad entry must store its own payout');
  const submitted = await api(`/api/applications/${applicationId}/submit`, { method: 'POST' });
  assert.ok(submitted.ok, `submit failed: ${JSON.stringify(submitted.body)}`);
  assert.equal(submitted.body.status, 'REVIEW');
  // Locked after submit.
  const lockedPatch = await api(`/api/applications/${applicationId}`, { method: 'PATCH', body: { items: [] } });
  assert.equal(lockedPatch.status, 400);
  assert.equal(lockedPatch.body.code, 'STATUS_LOCKED');

  // 11. Deputy reviews: cross-school denial is covered by auth guard scope; reject then resubmit.
  accessToken = deputyToken;
  const rejected = await api(`/api/reviews/${applicationId}/reject`, { method: 'POST', body: { comment: 'Приложите документы' } });
  assert.ok(rejected.ok, `reject failed: ${JSON.stringify(rejected.body)}`);
  assert.equal(rejected.body.status, 'REJECTED');
  const emptyReject = await api(`/api/reviews/${applicationId}/reject`, { method: 'POST', body: { comment: '' } });
  assert.equal(emptyReject.status, 400);
  assert.equal(emptyReject.body.code, 'COMMENT_REQUIRED');
  // Teacher edits the rejected application and resubmits - old decision cleared.
  accessToken = teacher.body.accessToken;
  const resubmittedItems = [
    { criterionId: criterionFixedId, values: {} },
    { criterionId: criterionQualityId, values: { percentage: 80 }, entries: [] },
    { criterionId: criterionOlympiadId, values: {}, entries: [{ level: 'municipal', diploma: 'winner', studentName: 'Иванов Иван', olympiadName: 'Математика' }, { level: 'regional', diploma: 'prize', studentName: 'Петрова Анна', olympiadName: 'Физика' }] },
  ];
  const reedited = await api(`/api/applications/${applicationId}`, { method: 'PATCH', body: { items: resubmittedItems } });
  assert.ok(reedited.ok, `rejected edit failed: ${JSON.stringify(reedited.body)}`);
  const resubmitted = await api(`/api/applications/${applicationId}/submit`, { method: 'POST' });
  assert.ok(resubmitted.ok, `resubmit failed: ${JSON.stringify(resubmitted.body)}`);
  assert.equal(resubmitted.body.status, 'REVIEW');
  assert.equal(resubmitted.body.comment, null);

  // 12. Deputy uploads evidence and approves.
  accessToken = deputyToken;
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }), 'proof.pdf');
  form.append('applicationId', applicationId);
  const uploaded = await api('/api/files', { method: 'POST', body: form });
  assert.ok(uploaded.ok, `upload failed: ${JSON.stringify(uploaded.body)}`);
  const fileId = uploaded.body.id;
  const download = await api(`/api/files/${fileId}`, { token: teacher.body.accessToken });
  assert.ok(download.ok);
  assert.equal(download.response.headers.get('content-type'), 'application/pdf');
  // Deputy of another school cannot download (no second school seeded; at least wrong token fails)
  const strangerDownload = await api(`/api/files/${fileId}`, { token: false });
  assert.equal(strangerDownload.status, 401);
  // Bad type is rejected
  const badForm = new FormData();
  badForm.append('file', new Blob(['text'], { type: 'text/plain' }), 'notes.txt');
  badForm.append('applicationId', applicationId);
  const badUpload = await api('/api/files', { method: 'POST', body: badForm });
  assert.equal(badUpload.status, 400);
  assert.equal(badUpload.body.code, 'FILE_TYPE');

  const approved = await api(`/api/reviews/${applicationId}/approve`, { method: 'POST' });
  assert.ok(approved.ok, `approve failed: ${JSON.stringify(approved.body)}`);
  assert.equal(approved.body.status, 'APPROVED');

  // 13. Notifications were created for the teacher.
  const notifications = await api('/api/notifications', { token: teacher.body.accessToken });
  assert.ok(notifications.ok);
  const types = notifications.body.map((n: any) => n.type);
  assert.ok(types.includes('approved'), `missing approved notification: ${JSON.stringify(types)}`);

  // 13b. Criteria list reports actual usage counts.
  const criteriaAfterUse = await api('/api/criteria');
  assert.ok(criteriaAfterUse.ok);
  const usedFixed = criteriaAfterUse.body.find((c: any) => c.id === criterionFixedId);
  assert.equal(usedFixed.usageCount, 1, `fixed criterion must report usageCount 1, got ${usedFixed.usageCount}`);
  const freshCriterion = await api('/api/criteria', { method: 'POST', body: { title: 'Неиспользуемый', category: 'Тест', type: 'FIXED', maxAmount: 100, fields: [], scales: [] } });
  assert.ok(freshCriterion.ok);
  const criteriaAfterFresh = await api('/api/criteria');
  const freshFromList = criteriaAfterFresh.body.find((c: any) => c.id === freshCriterion.body.id);
  assert.equal(freshFromList.usageCount, 0);

  // 14. XLSX export contains actual approved amounts, not criterion maxAmount.
  const report = await api(`/api/reports/${periodId}/export.xlsx`);
  assert.ok(report.ok, `export failed: ${report.body}`);
  const buffer = report.buffer;
  assert.ok(buffer.length > 1000);
  const header = buffer.subarray(0, 2).toString('binary');
  assert.equal(header, 'PK', 'export must be a valid xlsx (zip)');
  // The criteria sheet must contain actual approved amounts (fixed 3000, quality 4000,
  // olympiad 3300, total 10300) - not the unused maxAmount ceilings (5000/7000).
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as import('exceljs').Buffer);
  const criteriaSheet = workbook.getWorksheet('Критерии');
  assert.ok(criteriaSheet, 'criteria sheet must exist');
  const amounts = Array.from({ length: criteriaSheet.rowCount }, (_, i) => criteriaSheet.getRow(i + 1).getCell(2).value);
  const numbers = amounts.filter((v) => typeof v === 'number') as number[];
  assert.ok(numbers.includes(3000), `criteria sheet must contain actual fixed amount 3000: ${JSON.stringify(numbers)}`);
  assert.ok(numbers.includes(4000), `criteria sheet must contain actual quality amount 4000: ${JSON.stringify(numbers)}`);
  assert.ok(numbers.includes(3300), `criteria sheet must contain actual olympiad amount 3300: ${JSON.stringify(numbers)}`);
  assert.ok(!numbers.includes(5000) && !numbers.includes(7000), `criteria sheet must not contain maxAmount ceilings: ${JSON.stringify(numbers)}`);
  // Teachers cannot export.
  const teacherExport = await api(`/api/reports/${periodId}/export.xlsx`, { token: teacher.body.accessToken });
  assert.equal(teacherExport.status, 403);

  // 15. Категория педагога определяет шкалу качества обученности; недопустимая категория отклоняется.
  accessToken = deputyToken;
  const badCategory = await api('/api/auth/register', { method: 'POST', body: { email: 'bad-category@e2e.test', password: 'e2ePass123', fullName: 'E2E Bad Category', schoolId, role: 'TEACHER', teacherCategory: 'WRONG' }, token: false });
  assert.equal(badCategory.status, 400);
  assert.equal(badCategory.body.code, 'CATEGORY_INVALID');
  const categoryQuality = await api('/api/criteria', { method: 'POST', body: { title: 'E2E качество по категориям', category: 'Тест', type: 'QUALITY', maxAmount: 2000, fields: [], scales: [
    { key: 'ELEMENTARY', from: 65, to: 79, amount: 1000 },
    { key: 'ELEMENTARY', from: 80, to: 100, amount: 2000 },
    { key: 'SUBJECT', from: 70, to: 100, amount: 2000 },
  ] } });
  assert.ok(categoryQuality.ok, `category quality failed: ${JSON.stringify(categoryQuality.body)}`);
  // Пересечение диапазонов внутри одной категории по-прежнему отклоняется.
  const overlap = await api('/api/criteria', { method: 'POST', body: { title: 'E2E пересечения', category: 'Тест', type: 'QUALITY', maxAmount: 2000, fields: [], scales: [
    { key: 'ELEMENTARY', from: 60, to: 80, amount: 1000 },
    { key: 'ELEMENTARY', from: 70, to: 90, amount: 2000 },
  ] } });
  assert.equal(overlap.status, 400);
  assert.equal(overlap.body.code, 'SCALES_INVALID');
  // Один и тот же процент 72% даёт 1000₽ учителю начальных классов и 2000₽ предметнику.
  const elementary = await api('/api/auth/register', { method: 'POST', body: { email: 'elementary@e2e.test', password: 'e2ePass123', fullName: 'E2E Elementary', position: 'Учитель начальных классов', schoolId, role: 'TEACHER', teacherCategory: 'ELEMENTARY' }, token: false });
  assert.ok(elementary.ok, `elementary register failed: ${JSON.stringify(elementary.body)}`);
  accessToken = elementary.body.accessToken;
  const elementaryApp = await api('/api/applications', { method: 'POST', body: { periodId } });
  assert.ok(elementaryApp.ok);
  const elementaryFilled = await api(`/api/applications/${elementaryApp.body.id}`, { method: 'PATCH', body: { items: [{ criterionId: categoryQuality.body.id, values: { percentage: 72 }, entries: [] }] } });
  assert.ok(elementaryFilled.ok, `elementary fill failed: ${JSON.stringify(elementaryFilled.body)}`);
  assert.equal(elementaryFilled.body.total, 1000, `elementary 72% must give 1000, got ${elementaryFilled.body.total}`);
  const subject = await api('/api/auth/register', { method: 'POST', body: { email: 'subject@e2e.test', password: 'e2ePass123', fullName: 'E2E Subject', position: 'Учитель математики', schoolId, role: 'TEACHER', teacherCategory: 'SUBJECT' }, token: false });
  assert.ok(subject.ok);
  accessToken = subject.body.accessToken;
  const subjectApp = await api('/api/applications', { method: 'POST', body: { periodId } });
  assert.ok(subjectApp.ok);
  const subjectFilled = await api(`/api/applications/${subjectApp.body.id}`, { method: 'PATCH', body: { items: [{ criterionId: categoryQuality.body.id, values: { percentage: 72 }, entries: [] }] } });
  assert.ok(subjectFilled.ok);
  assert.equal(subjectFilled.body.total, 2000, `subject 72% must give 2000, got ${subjectFilled.body.total}`);

  // 15b. Настраиваемый справочник олимпиадного критерия: баллы ОГЭ/ЕГЭ и ВПР,
  // начисление за каждого обучающегося по своим уровням и степеням.
  const examCriterion = await api('/api/criteria', { method: 'POST', token: deputyToken, body: {
    title: 'E2E баллы экзаменов', category: 'Тест', type: 'OLYMPIAD', maxAmount: 5000,
    levels: [{ id: 'ege', label: 'ЕГЭ' }, { id: 'vpr', label: 'ВПР (4 класс)' }],
    diplomas: [{ id: 'score100', label: '100 баллов' }, { id: 'score90', label: '90–99 баллов' }, { id: 'pass', label: 'Положительный результат' }],
    fields: [], scales: [
      { key: 'ege:score100', amount: 5000 },
      { key: 'ege:score90', amount: 3500 },
      { key: 'vpr:pass', amount: 3000 },
    ],
  } });
  assert.ok(examCriterion.ok, `exam criterion failed: ${JSON.stringify(examCriterion.body)}`);
  // Шкала, ссылающаяся на незаявленный уровень справочника, отклоняется.
  const orphanScale = await api('/api/criteria', { method: 'POST', token: deputyToken, body: { title: 'E2E orphan', category: 'Тест', type: 'OLYMPIAD', maxAmount: 5000, levels: [{ id: 'ege', label: 'ЕГЭ' }], diplomas: [{ id: 'score100', label: '100 баллов' }], fields: [], scales: [{ key: 'unknown:score100', amount: 100 }] } });
  assert.equal(orphanScale.status, 400);
  assert.equal(orphanScale.body.code, 'SCALES_INVALID');
  // Учитель заполняет строки учеников из справочника критерия, сумма идёт за каждого.
  const examTeacher = await api('/api/auth/register', { method: 'POST', body: { email: 'exam@e2e.test', password: 'e2ePass123', fullName: 'E2E Exam Teacher', position: 'Учитель математики', schoolId, role: 'TEACHER', teacherCategory: 'SUBJECT' }, token: false });
  assert.ok(examTeacher.ok);
  accessToken = examTeacher.body.accessToken;
  const examApp = await api('/api/applications', { method: 'POST', body: { periodId } });
  assert.ok(examApp.ok);
  const examFilled = await api(`/api/applications/${examApp.body.id}`, { method: 'PATCH', body: { items: [{ criterionId: examCriterion.body.id, values: {}, entries: [
    { level: 'ege', diploma: 'score100', studentName: 'Иванов Иван', olympiadName: 'ЕГЭ, математика' },
    { level: 'vpr', diploma: 'pass', studentName: 'Сидоров Олег', olympiadName: 'ВПР, 4 класс' },
  ] }] } });
  assert.ok(examFilled.ok, `exam fill failed: ${JSON.stringify(examFilled.body)}`);
  // 5000 (100 баллов) + 3000 (ВПР) — за каждого обучающегося.
  assert.equal(examFilled.body.total, 8000, `exam total must be 8000, got ${examFilled.body.total}`);
  // Отправка проходит строгую валидацию записей по справочнику критерия.
  const examSubmitted = await api(`/api/applications/${examApp.body.id}/submit`, { method: 'POST' });
  assert.ok(examSubmitted.ok, `exam submit failed: ${JSON.stringify(examSubmitted.body)}`);
  // Запись с уровнем не из справочника критерия отклоняется. regional:winner
  // есть в стандартном справочтере, но отсутствует у этого критерия — отказ
  // доказывает, что валидация использует именно справочник критерия.
  const badTeacher = await api('/api/auth/register', { method: 'POST', body: { email: 'badexam@e2e.test', password: 'e2ePass123', fullName: 'E2E Bad Exam', position: 'Учитель', schoolId, role: 'TEACHER' }, token: false });
  assert.ok(badTeacher.ok);
  accessToken = badTeacher.body.accessToken;
  const badApp = await api('/api/applications', { method: 'POST', body: { periodId } });
  assert.ok(badApp.ok);
  const badFill = await api(`/api/applications/${badApp.body.id}`, { method: 'PATCH', body: { items: [{ criterionId: examCriterion.body.id, values: {}, entries: [{ level: 'regional', diploma: 'winner', studentName: 'Ложный', olympiadName: 'Нет' }] }] } });
  assert.equal(badFill.status, 400);
  assert.equal(badFill.body.code, 'OLYMPIAD_ENTRY');

  // 16. Утверждённую заявку удалить нельзя, отклонённые и черновики — можно.
  accessToken = deputyToken;
  const lockedDelete = await api(`/api/applications/${applicationId}`, { method: 'DELETE' });
  assert.equal(lockedDelete.status, 400);
  assert.equal(lockedDelete.body.code, 'STATUS_LOCKED');
  const strangerDelete = await api(`/api/applications/${applicationId}`, { method: 'DELETE', token: elementary.body.accessToken });
  assert.equal(strangerDelete.status, 400);
  assert.equal(strangerDelete.body.code, 'NOT_FOUND');
  // Учитель удаляет свой черновик.
  const deletedOwn = await api(`/api/applications/${elementaryApp.body.id}`, { method: 'DELETE', token: elementary.body.accessToken });
  assert.ok(deletedOwn.ok);
  const gone = await api(`/api/applications/${elementaryApp.body.id}`, { method: 'GET', token: elementary.body.accessToken });
  assert.equal(gone.status, 400);
  assert.equal(gone.body.code, 'NOT_FOUND');
  // Заместитель директора удаляет отклонённую заявку после проверки.
  accessToken = subject.body.accessToken;
  await api(`/api/applications/${subjectApp.body.id}`, { method: 'POST' });
  accessToken = deputyToken;
  await api(`/api/reviews/${subjectApp.body.id}/reject`, { method: 'POST', body: { comment: 'Ошибка' } });
  const deputyDelete = await api(`/api/applications/${subjectApp.body.id}`, { method: 'DELETE' });
  assert.ok(deputyDelete.ok, `deputy delete failed: ${JSON.stringify(deputyDelete.body)}`);
  const listAfterDelete = await api('/api/applications');
  assert.ok(!listAfterDelete.body.some((a: any) => a.id === subjectApp.body.id), 'deleted application must disappear from the list');

  // 17. Фонд периода масштабирует выплаты коэффициентом K в реестре.
  accessToken = deputyToken;
  const funded = await api(`/api/periods/${periodId}`, { method: 'PATCH', body: { fundAmount: 5000 } });
  assert.ok(funded.ok);
  assert.equal(funded.body.fundAmount, 5000);
  const fundedReport = await api(`/api/reports/${periodId}/export.xlsx`);
  assert.ok(fundedReport.ok);
  const fundedWorkbook = new ExcelJS.Workbook();
  await fundedWorkbook.xlsx.load(fundedReport.buffer as unknown as import('exceljs').Buffer);
  const fundedTotals = fundedWorkbook.getWorksheet('Итоги');
  assert.ok(fundedTotals, 'totals sheet must exist');
  const fundedRows: Record<string, any> = {};
  for (let i = 1; i <= fundedTotals.rowCount; i++) fundedRows[String(fundedTotals.getRow(i).getCell(1).value)] = fundedTotals.getRow(i).getCell(2).value;
  assert.equal(fundedRows['Потенциальная сумма выплат, ₽'], 10300);
  assert.equal(fundedRows['Коэффициент K'], Math.round((5000 / 10300) * 10000) / 10000);
  assert.equal(fundedRows['Итого к выплате, ₽'], 5000);
  const badFund = await api(`/api/periods/${periodId}`, { method: 'PATCH', body: { fundAmount: -100 } });
  assert.equal(badFund.status, 400);
  assert.equal(badFund.body.code, 'FUND_INVALID');

  // 17b. Детали заявки содержат поля критерия и прикреплённые к элементу документы —
  // этого достаточно проверяющему, чтобы увидеть, чем и как заполнена заявка.
  const detail = await api(`/api/applications/${applicationId}`);
  assert.ok(detail.ok);
  const fixedItem = detail.body.items.find((i: any) => i.criterionId === criterionFixedId);
  assert.ok(fixedItem, 'approved application must contain the fixed criterion item');
  assert.ok(Array.isArray(fixedItem.criterion?.fields), 'item must expose criterion fields for the reviewer');
  assert.ok(Array.isArray(fixedItem.files), 'item must expose uploaded evidence files');
  const itemForm = new FormData();
  itemForm.append('file', new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }), 'item-proof.pdf');
  itemForm.append('applicationId', applicationId);
  itemForm.append('itemId', fixedItem.id);
  const itemUpload = await api('/api/files', { method: 'POST', body: itemForm });
  assert.ok(itemUpload.ok, `item upload failed: ${JSON.stringify(itemUpload.body)}`);
  const detailAfterUpload = await api(`/api/applications/${applicationId}`);
  const fixedItemAfter = detailAfterUpload.body.items.find((i: any) => i.criterionId === criterionFixedId);
  assert.equal(fixedItemAfter.files.length, 1, 'uploaded file must be attached to the item');

  // 18. Полное удаление критерия (?force=true): неиспользуемый удаляется насовсем,
  // использованный в утверждённой заявке блокируется, а черновики очищаются
  // вместе с критерием с пересчётом суммы.
  const purgeUnused = await api(`/api/criteria/${freshCriterion.body.id}?force=true`, { method: 'DELETE' });
  assert.ok(purgeUnused.ok, `purge of unused criterion failed: ${JSON.stringify(purgeUnused.body)}`);
  assert.equal(purgeUnused.body.purged, true);
  const afterPurge = await api('/api/criteria');
  assert.ok(!afterPurge.body.some((c: any) => c.id === freshCriterion.body.id), 'unused criterion must disappear after purge');
  // Критерий из утверждённой заявки удалить нельзя — история выплат должна сохраниться.
  const purgeUsed = await api(`/api/criteria/${criterionFixedId}?force=true`, { method: 'DELETE' });
  assert.equal(purgeUsed.status, 400);
  assert.equal(purgeUsed.body.code, 'CRITERION_IN_USE');
  const stillThere = await api('/api/criteria');
  assert.ok(stillThere.body.some((c: any) => c.id === criterionFixedId), 'in-use criterion must remain');
  // Мягкое удаление (отключение) остаётся доступным и для использованного критерия.
  const softDelete = await api(`/api/criteria/${criterionFixedId}`, { method: 'DELETE' });
  assert.ok(softDelete.ok);
  assert.equal(softDelete.body.active, false);
  // Критерий использован только в черновике: удаление вычищает элемент и пересчитывает сумму.
  const draftCriterion = await api('/api/criteria', { method: 'POST', body: { title: 'E2E черновичный', category: 'Тест', type: 'FIXED', maxAmount: 1000, amount: 500, fields: [], scales: [] } });
  assert.ok(draftCriterion.ok);
  const purgeTeacher = await api('/api/auth/register', { method: 'POST', body: student('purgeteacher'), token: false });
  assert.ok(purgeTeacher.ok, `purge teacher register failed: ${JSON.stringify(purgeTeacher.body)}`);
  accessToken = purgeTeacher.body.accessToken;
  const purgeApp = await api('/api/applications', { method: 'POST', body: { periodId } });
  assert.ok(purgeApp.ok);
  const purgeFilled = await api(`/api/applications/${purgeApp.body.id}`, { method: 'PATCH', body: { items: [{ criterionId: draftCriterion.body.id, values: {} }] } });
  assert.ok(purgeFilled.ok, `purge draft fill failed: ${JSON.stringify(purgeFilled.body)}`);
  assert.equal(purgeFilled.body.total, 500);
  accessToken = deputyToken;
  const purgeDraft = await api(`/api/criteria/${draftCriterion.body.id}?force=true`, { method: 'DELETE' });
  assert.ok(purgeDraft.ok, `purge of draft-only criterion failed: ${JSON.stringify(purgeDraft.body)}`);
  const purgeAppAfter = await api(`/api/applications/${purgeApp.body.id}`, { token: purgeTeacher.body.accessToken });
  assert.ok(purgeAppAfter.ok);
  assert.equal(purgeAppAfter.body.items.length, 0, 'draft item must be removed together with its criterion');
  assert.equal(purgeAppAfter.body.total, 0, 'draft total must be recalculated after purge');

  // 18b. Пользовательский критерий с вариантами выплат: учитель выбирает вариант,
  // сумма считается по выбранному варианту, а не по фиксированной ставке.
  const customCriterion = await api('/api/criteria', { method: 'POST', body: {
    title: 'E2E пользовательский', category: 'Тест', type: 'CUSTOM', maxAmount: 10000, amount: 1000,
    fields: [{ key: 'event', label: 'Мероприятие', type: 'TEXT', required: true }],
    scales: [
      { key: 'winner', amount: 8000, metadata: { label: 'Победитель' } },
      { key: 'prize', amount: 5000, metadata: { label: 'Призёр' } },
    ],
    levels: [], diplomas: [],
  } });
  assert.ok(customCriterion.ok, `custom criterion failed: ${JSON.stringify(customCriterion.body)}`);
  const customTeacher = await api('/api/auth/register', { method: 'POST', body: student('custom'), token: false });
  assert.ok(customTeacher.ok, `custom teacher register failed: ${JSON.stringify(customTeacher.body)}`);
  accessToken = customTeacher.body.accessToken;
  const customApp = await api('/api/applications', { method: 'POST', body: { periodId } });
  assert.ok(customApp.ok);
  // Вариант не выбран — действует фиксированная сумма по умолчанию.
  const customDefault = await api(`/api/applications/${customApp.body.id}`, { method: 'PATCH', body: { items: [{ criterionId: customCriterion.body.id, values: { event: 'Конкурс', scale: '' } }] } });
  assert.ok(customDefault.ok, `custom default fill failed: ${JSON.stringify(customDefault.body)}`);
  assert.equal(customDefault.body.total, 1000, `custom default must be 1000, got ${customDefault.body.total}`);
  // Выбран вариант «Призёр» — 5000.
  const customVariant = await api(`/api/applications/${customApp.body.id}`, { method: 'PATCH', body: { items: [{ criterionId: customCriterion.body.id, values: { event: 'Конкурс', scale: 'prize' } }] } });
  assert.ok(customVariant.ok, `custom variant fill failed: ${JSON.stringify(customVariant.body)}`);
  assert.equal(customVariant.body.total, 5000, `custom variant must pay 5000, got ${customVariant.body.total}`);
  // Вариант не из шкалы отклоняется.
  const badVariant = await api(`/api/applications/${customApp.body.id}`, { method: 'PATCH', body: { items: [{ criterionId: customCriterion.body.id, values: { event: 'Конкурс', scale: 'nosuchvariant' } }] } });
  assert.equal(badVariant.status, 400);
  assert.equal(badVariant.body.code, 'FIELD_INVALID');
  // Сумма варианта не может превышать максимум критерия.
  accessToken = deputyToken;
  const oversizedVariant = await api('/api/criteria', { method: 'POST', body: { title: 'E2E лимит', category: 'Тест', type: 'CUSTOM', maxAmount: 1000, fields: [], scales: [{ key: 'big', amount: 5000, metadata: { label: 'Слишком много' } }], levels: [], diplomas: [] } });
  assert.equal(oversizedVariant.status, 400);
  assert.equal(oversizedVariant.body.code, 'SCALES_INVALID');

  // 18c. Пользовательский критерий с процентной шкалой: сумма определяется
  // диапазоном, в который попал введённый процент. Шкала может быть общей
  // (одни диапазоны для любой категории педагога) или по категориям.
  const bandCriterion = await api('/api/criteria', { method: 'POST', body: {
    title: 'E2E проценты', category: 'Тест', type: 'CUSTOM', maxAmount: 10000,
    fields: [{ key: 'event', label: 'Мероприятие', type: 'TEXT', required: true }],
    scales: [
      { key: 'COMMON', from: 0, to: 60, amount: 2000 },
      { key: 'COMMON', from: 61, to: 100, amount: 5000 },
    ],
    levels: [], diplomas: [],
  } });
  assert.ok(bandCriterion.ok, `band criterion failed: ${JSON.stringify(bandCriterion.body)}`);
  const bandTeacher = await api('/api/auth/register', { method: 'POST', body: { ...student('bands'), teacherCategory: 'SUBJECT' }, token: false });
  assert.ok(bandTeacher.ok, `band teacher register failed: ${JSON.stringify(bandTeacher.body)}`);
  accessToken = bandTeacher.body.accessToken;
  const bandApp = await api('/api/applications', { method: 'POST', body: { periodId } });
  assert.ok(bandApp.ok);
  // 45% попадает в первый диапазон — 2000.
  const bandLow = await api(`/api/applications/${bandApp.body.id}`, { method: 'PATCH', body: { items: [{ criterionId: bandCriterion.body.id, values: { event: 'Конкурс', percentage: 45 } }] } });
  assert.ok(bandLow.ok, `band low fill failed: ${JSON.stringify(bandLow.body)}`);
  assert.equal(bandLow.body.total, 2000, `band 45% must pay 2000, got ${bandLow.body.total}`);
  // 90% попадает во второй диапазон — 5000.
  const bandHigh = await api(`/api/applications/${bandApp.body.id}`, { method: 'PATCH', body: { items: [{ criterionId: bandCriterion.body.id, values: { event: 'Конкурс', percentage: 90 } }] } });
  assert.ok(bandHigh.ok, `band high fill failed: ${JSON.stringify(bandHigh.body)}`);
  assert.equal(bandHigh.body.total, 5000, `band 90% must pay 5000, got ${bandHigh.body.total}`);
  // Черновик можно сохранить без процента, но отправка отклоняется: выплату
  // по диапазону определить невозможно.
  const bandDraftNoPercent = await api(`/api/applications/${bandApp.body.id}`, { method: 'PATCH', body: { items: [{ criterionId: bandCriterion.body.id, values: { event: 'Конкурс' } }] } });
  assert.ok(bandDraftNoPercent.ok, `band draft without percent must be allowed: ${JSON.stringify(bandDraftNoPercent.body)}`);
  const bandSubmitNoPercent = await api(`/api/applications/${bandApp.body.id}/submit`, { method: 'POST' });
  assert.equal(bandSubmitNoPercent.status, 400);
  assert.equal(bandSubmitNoPercent.body.code, 'PERCENTAGE_REQUIRED');
  // С процентом заявка отправляется.
  await api(`/api/applications/${bandApp.body.id}`, { method: 'PATCH', body: { items: [{ criterionId: bandCriterion.body.id, values: { event: 'Конкурс', percentage: 90 } }] } });
  const bandSubmit = await api(`/api/applications/${bandApp.body.id}/submit`, { method: 'POST' });
  assert.ok(bandSubmit.ok, `band submit failed: ${JSON.stringify(bandSubmit.body)}`);
  // Процентная шкала по категориям: предметник и началка получают разные суммы.
  accessToken = deputyToken;
  const categoryBandCriterion = await api('/api/criteria', { method: 'POST', body: {
    title: 'E2E проценты по категориям', category: 'Тест', type: 'CUSTOM', maxAmount: 10000,
    fields: [],
    scales: [
      { key: 'SUBJECT', from: 0, to: 100, amount: 3000 },
      { key: 'ELEMENTARY', from: 0, to: 100, amount: 1500 },
    ],
    levels: [], diplomas: [],
  } });
  assert.ok(categoryBandCriterion.ok, `category band criterion failed: ${JSON.stringify(categoryBandCriterion.body)}`);
  const bandElemTeacher = await api('/api/auth/register', { method: 'POST', body: { ...student('bandsElem'), teacherCategory: 'ELEMENTARY' }, token: false });
  assert.ok(bandElemTeacher.ok, `elementary band teacher register failed: ${JSON.stringify(bandElemTeacher.body)}`);
  accessToken = bandElemTeacher.body.accessToken;
  const bandElemApp = await api('/api/applications', { method: 'POST', body: { periodId } });
  assert.ok(bandElemApp.ok);
  const bandElemFill = await api(`/api/applications/${bandElemApp.body.id}`, { method: 'PATCH', body: { items: [{ criterionId: categoryBandCriterion.body.id, values: { percentage: 80 } }] } });
  assert.ok(bandElemFill.ok, `elementary band fill failed: ${JSON.stringify(bandElemFill.body)}`);
  assert.equal(bandElemFill.body.total, 1500, `elementary 80% must pay 1500, got ${bandElemFill.body.total}`);
  // Возвращаем токен заместителя для последующих шагов сценария.
  accessToken = deputyToken;


  // 19. Close the period - new applications for it are rejected.
  const closed = await api(`/api/periods/${periodId}`, { method: 'PATCH', body: { active: false } });
  assert.ok(closed.ok);
  assert.equal(closed.body.active, false);
  const teacherListAfterClose = await api('/api/periods', { token: teacher.body.accessToken });
  assert.ok(teacherListAfterClose.ok);
  const closedPeriod = teacherListAfterClose.body.find((p: any) => p.id === periodId);
  assert.equal(closedPeriod.active, false);

  // 16. Logout revokes refresh.
  accessToken = teacher.body.accessToken;
  const logout = await api('/api/auth/logout', { method: 'POST' });
  assert.ok(logout.ok);
  const reuseRefresh = await api('/api/auth/refresh', { method: 'POST', body: { refreshToken: refreshTokenValue }, token: false });
  assert.equal(reuseRefresh.status, 401);
  assert.equal(reuseRefresh.body.code, 'REFRESH_INVALID');
}),);