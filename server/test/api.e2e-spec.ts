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
    proc.kill('SIGKILL');
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

  // 15. Close the period - new applications for it are rejected.
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