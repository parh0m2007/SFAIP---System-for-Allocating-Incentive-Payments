import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('блок фиксированной выплаты не переполняет колонку загрузки документов', () => {
  assert.match(styles, /\.criterion-detail\{[^}]*grid-template-columns:minmax\(150px,180px\) minmax\(0,1fr\) 30px/);
  assert.match(styles, /\.file-field\{min-width:0\}/);
});

test('карточка дедлайна закреплена вместе с предварительным расчётом', () => {
  assert.match(styles, /\.application-layout > aside\{[^}]*position:sticky;top:100px/);
  assert.match(styles, /\.side-summary\{position:static\}/);
  assert.match(styles, /@media\(max-width:850px\)\{\.application-layout > aside\{position:static/);
});

test('реестр выплат удерживает сумму и счётчик внутри карточки', () => {
  assert.match(app, /class="panel report-table-panel"/);
  assert.match(app, /class="muted-text report-count"/);
  assert.match(app, /class="report-table"/);
  assert.match(styles, /\.report-table-panel \.panel-head\{[^}]*padding:/);
  assert.match(styles, /\.report-count\{[^}]*white-space:nowrap/);
  assert.match(styles, /\.report-table\{[^}]*table-layout:fixed/);
  assert.match(styles, /\.report-table td:nth-child\(3\)\{[^}]*white-space:nowrap/);
});

test('таблица очереди не растягивается по высоте панели деталей', () => {
  assert.match(styles, /\.review-layout\{[^}]*align-items:start/);
});

test('денежные значения и блок очереди сохраняют читаемые отступы', () => {
  assert.match(styles, /\.evidence-list strong\{[^}]*white-space:nowrap/);
  assert.match(styles, /\.review-layout\{[^}]*margin-top:15px/);
});

test('интерфейс использует нейтральное название образовательной системы', () => {
  assert.match(app, /brand-mark">ОС<\/div>/);
  assert.match(app, /<b>Образовательная<\/b><span>система<\/span>/);
  assert.doesNotMatch(app, /ЭПОС/);
  assert.match(index, /<title>Образовательная система · Стимулирующие выплаты<\/title>/);
  assert.doesNotMatch(index, /ЭПОС/);
  assert.match(styles, /\.brand b\{font:600 15px\/1\.15 'DM Sans';letter-spacing:-\.02em\}/);
  assert.match(styles, /\.brand span\{font-size:11px;letter-spacing:\.08em;margin-top:3px\}/);
});

test('завучские решения и документы подключены к API', () => {
  assert.match(app, /api\.approveReview\(a\.id\)/);
  assert.match(app, /api\.rejectReview\(a\.id, comment\)/);
  assert.match(app, /api\.uploadFile\(file, a\.id, item\.id\)/);
});

test('конструктор критериев содержит форму создания и редактирования', () => {
  assert.match(app, /data-action="new-criterion"/);
  assert.match(app, /data-action="save-criterion"/);
  assert.match(app, /api\.createCriterion\(/);
  assert.match(app, /api\.updateCriterion\(/);
});

test('критерий можно отключить и вернуть без удаления', () => {
  assert.match(app, /active: c\.active !== false/);
  assert.match(app, /badge\(c\.active \? 'approved' : 'draft'\)/);
  assert.match(app, /data-toggle-criterion/);
  assert.match(app, /api\.updateCriterionStatus\(/);
  assert.match(app, /data-delete-criterion/);
  assert.match(app, /api\.deleteCriterion\(/);
});

test('конструктор не требует ввода JSON для полей и шкал', () => {
  assert.doesNotMatch(app, /name="fields"[^>]*textarea/);
  assert.doesNotMatch(app, /name="scales"[^>]*textarea/);
  assert.match(app, /data-builder-field/);
  assert.match(app, /data-builder-scale/);
});

test('добавление поля сохраняет ранее введённые значения конструктора', () => {
  assert.match(app, /function captureCriterionEditorForm\(/);
  assert.match(app, /captureCriterionEditorForm\(\); criterionEditor\.fields = \[/);
});

test('кастомные поля имеют единое адаптивное оформление', () => {
  assert.match(styles, /\.custom-fields\{[^}]*display:grid/);
  assert.match(styles, /\.custom-field\{[^}]*min-width:0/);
  assert.match(styles, /\.custom-field input/);
  assert.match(styles, /\.custom-field select/);
  assert.match(styles, /@media\(max-width:700px\)\{\.custom-fields\{grid-template-columns:1fr/);
});

test('кастомные поля сохраняются после завершения ввода, без перерисовки на каждый символ', () => {
  assert.match(app, /querySelectorAll\('\[data-custom-field\]'\)\.forEach\(\(el\) => el\.addEventListener\('change'/);
  assert.doesNotMatch(app, /querySelectorAll\('\[data-custom-field\]'\)\.forEach\(\(el\) => el\.addEventListener\('input'/);
});

test('отправка заявки защищена от устаревшего фонового автосохранения', () => {
  assert.match(app, /let submitInFlight = false/);
  assert.match(app, /submitInFlight = true/);
  assert.match(app, /submitInFlight = false/);
});

test('ошибка автосохранения не переводит отправку заявки в локальный режим', () => {
  assert.match(app, /void scheduleApplicationSync\(\)\.catch\(\(\) => \{\}\);/);
  const queueStart = app.indexOf('applicationSyncPromise = applicationSyncPromise');
  const queueCatch = app.indexOf('.catch(() => {})', queueStart);
  const queueThen = app.indexOf('.then(() => syncCurrentApplication())', queueCatch);
  assert.ok(queueStart >= 0 && queueCatch > queueStart && queueThen > queueCatch);
  assert.match(app, /catch \(error\) \{[\s\S]*?throw error;[\s\S]*?finally \{ backendSyncBusy = false; \}/);
});

test('после отправки заявка синхронизируется с API перед сохранением локального состояния', () => {
  assert.match(app, /await api\.listApplications\(\)/);
  assert.match(app, /hydrateBackend\(\)/);
});

test('экран входа и регистрации не зависит от демо-переключателя', () => {
  assert.match(app, /authView/);
  assert.match(app, /data-auth-submit/);
  assert.match(app, /data-auth-mode/);
  assert.doesNotMatch(app, /Демо: \$\{isTeacher \? 'Завуч' : 'Учитель'\}/);
});
