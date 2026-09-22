import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication, submitApplication, calculateReward, canCreateApplication, getReviewableApplications, updateCriterionAmount, getQualityBand, getOlympiadReward, calculateOlympiadTotal, normalizeQualityPercentage, getApplicationValidationErrors, criterionUpdatePayload, criterionLevels, criterionDiplomas, hasBandScales, customBandMode, calculatePayouts, DEFAULT_CATEGORY_BANDS, OLYMPIAD_LEVELS, DIPLOMA_TYPES } from '../src/domain.js';

test('расчёт выплаты не превышает максимальный лимит критерия', () => {
  assert.equal(calculateReward({ maxAmount: 5000, requestedAmount: 7200 }), 5000);
  assert.equal(calculateReward({ maxAmount: 5000, requestedAmount: 2400 }), 2400);
});

test('на период разрешена только одна заявка', () => {
  const state = { applications: [{ periodId: '2025-2', teacherId: 'teacher-1', status: 'draft' }] };
  assert.equal(canCreateApplication(state, 'teacher-1', '2025-2'), false);
  assert.equal(canCreateApplication(state, 'teacher-2', '2025-2'), true);
});

test('отклонённую заявку можно повторно отправить, статус сбрасывается на проверку', () => {
  const rejected = createApplication({ id: 'app-1', periodId: '2025-2', teacherId: 'teacher-1' });
  rejected.status = 'rejected';
  rejected.comment = 'Добавьте подтверждение';
  const resubmitted = submitApplication(rejected);
  assert.equal(resubmitted.status, 'review');
  assert.equal(resubmitted.comment, '');
  assert.ok(resubmitted.updatedAt);
});

test('завуч видит только заявки своей школы', () => {
  const state = {
    applications: [
      { id: 'a1', teacherId: 't1', schoolId: 'school-101', status: 'review' },
      { id: 'a2', teacherId: 't2', schoolId: 'school-202', status: 'review' },
    ],
  };
  assert.deepEqual(getReviewableApplications(state, 'school-101').map((app) => app.id), ['a1']);
});

test('сумма критерия задаётся завучем и ограничена диапазоном', () => {
  assert.equal(updateCriterionAmount({ id: 'c1', amount: 1000, maxAmount: 2000 }, 1500).amount, 1500);
  assert.equal(updateCriterionAmount({ id: 'c1', amount: 1000, maxAmount: 2000 }, 2800).amount, 2000);
  assert.equal(updateCriterionAmount({ id: 'c1', amount: 1000, maxAmount: 2000 }, -10).amount, 0);
});

test('качество обученности выбирает выплату по процентному диапазону', () => {
  const bands = [
    { from: 0, to: 50, amount: 1000 },
    { from: 50, to: 75, amount: 2000 },
    { from: 75, to: 90, amount: 3000 },
  ];
  assert.equal(getQualityBand(bands, 50).amount, 1000);
  assert.equal(getQualityBand(bands, 50.1).amount, 2000);
  assert.equal(getQualityBand(bands, 75).amount, 2000);
  assert.equal(getQualityBand(bands, 75.1).amount, 3000);
  assert.equal(getQualityBand(bands, 90).amount, 3000);
  assert.equal(getQualityBand(bands, 91), null);
});

test('процент качества принимает значения до 100 без начисления выше шкалы', () => {
  assert.equal(normalizeQualityPercentage(''), null);
  assert.equal(normalizeQualityPercentage(105), 100);
  assert.equal(normalizeQualityPercentage(91), 91);
  assert.equal(getQualityBand([{ from: 0, to: 50, amount: 1000 }, { from: 50, to: 75, amount: 2000 }, { from: 75, to: 90, amount: 3000 }], normalizeQualityPercentage(91)), null);
  assert.equal(getQualityBand([{ from: 0, to: 50, amount: 1000 }], ''), null);
});

test('олимпиада начисляет фиксированную сумму за каждого обучающегося', () => {
  const criterion = { olympiadAmounts: { municipal: { winner: 500, prize: 300 }, regional: { winner: 1000, prize: 700 } } };
  const entries = [
    { level: 'municipal', diploma: 'winner', studentName: 'Иванов Иван', olympiadName: 'Математика' },
    { level: 'regional', diploma: 'prize', studentName: 'Петрова Анна', olympiadName: 'Физика' },
  ];
  assert.equal(getOlympiadReward(criterion, entries[0]), 500);
  assert.equal(calculateOlympiadTotal(criterion, entries), 1200);
  assert.equal(calculateOlympiadTotal(criterion, [...entries, { level: 'municipal', diploma: 'winner' }]), 1200);
});

test('специальные критерии нельзя отправить без обязательных данных', () => {
  const criteria = [
    { id: '1.1', type: 'quality', qualityBands: [{ from: 0, to: 50, amount: 1000 }] },
    { id: '2.2', type: 'olympiad' },
  ];
  const errors = getApplicationValidationErrors({ items: [
    { criterionId: '1.1', percentage: '' },
    { criterionId: '2.2', entries: [{ level: 'municipal', diploma: 'winner', studentName: '', olympiadName: '' }] },
  ] }, criteria);
  assert.deepEqual(errors.map((error) => error.code), ['quality-percentage', 'olympiad-entry']);
});

test('быстрое изменение суммы сохраняет поля и шкалы критерия', () => {
  const payload = criterionUpdatePayload({
    title: 'Обобщение опыта', category: 'Методическая работа', type: 'fixed', amount: 1000, maxAmount: 2000, allowEvidence: true,
    fields: [{ key: 'event', label: 'Мероприятие', type: 'TEXT', required: true }],
    scales: [{ key: 'base', fromValue: 0, toValue: 50, amount: 1000 }],
  }, { amount: 1500 });

  assert.equal(payload.amount, 1500);
  assert.deepEqual(payload.fields, [{ key: 'event', label: 'Мероприятие', type: 'TEXT', required: true }]);
  assert.deepEqual(payload.scales, [{ key: 'base', from: 0, to: 50, amount: 1000 }]);
});

test('качество обученности выбирает выплату по категории педагога', () => {
  const criterion = { categoryBands: DEFAULT_CATEGORY_BANDS };
  // Учитель-предметник: 70–100% — 2000, 50–69% — 1000.
  assert.equal(getQualityBand(criterion, 82, 'subject').amount, 2000);
  assert.equal(getQualityBand(criterion, 70, 'subject').amount, 2000);
  assert.equal(getQualityBand(criterion, 55, 'subject').amount, 1000);
  assert.equal(getQualityBand(criterion, 40, 'subject'), null);
  // Учитель начальных классов: 80–100% — 2000, 65–79% — 1000.
  assert.equal(getQualityBand(criterion, 85, 'elementary').amount, 2000);
  assert.equal(getQualityBand(criterion, 72, 'elementary').amount, 1000);
  // Учитель ИЗО, физкультуры, технологии, музыки: 90–100% — 1500.
  assert.equal(getQualityBand(criterion, 95, 'creative').amount, 1500);
  assert.equal(getQualityBand(criterion, 89, 'creative'), null);
});

test('категорийные шкалы сериализуются в scales с ключом-категорией', () => {
  const payload = criterionUpdatePayload({
    title: 'Качество обученности', category: 'Учебная деятельность', type: 'quality', maxAmount: 2000,
    categoryBands: DEFAULT_CATEGORY_BANDS,
  });
  const elementaryTop = payload.scales.find((scale) => scale.key === 'ELEMENTARY' && scale.from === 80);
  assert.deepEqual(elementaryTop, { key: 'ELEMENTARY', from: 80, to: 100, amount: 2000 });
  const creative = payload.scales.find((scale) => scale.key === 'CREATIVE');
  assert.equal(creative.amount, 1500);
});

test('устаревший критерий с плоской шкалой не теряет диапазоны', () => {
  const payload = criterionUpdatePayload({
    title: 'Старое качество', category: 'Учебная деятельность', type: 'quality', maxAmount: 4000,
    qualityBands: [{ from: 0, to: 50, amount: 1000 }, { from: 50, to: 90, amount: 3000 }],
  });
  assert.equal(payload.scales.length, 2);
  assert.equal(payload.scales[0].from, 0);
  assert.equal(payload.scales[1].amount, 3000);
});

test('справочники олимпиадного критерия по умолчанию совпадают со стандартными', () => {
  assert.equal(criterionLevels({}), OLYMPIAD_LEVELS);
  assert.equal(criterionDiplomas({}), DIPLOMA_TYPES);
  assert.deepEqual(criterionLevels({ levelsJson: '[{"id":"ege","label":"ЕГЭ"}]' }), [{ id: 'ege', label: 'ЕГЭ' }]);
  // битый JSON не ломает справочник
  assert.equal(criterionDiplomas({ diplomasJson: 'not-json' }), DIPLOMA_TYPES);
});

test('олимпиадный критерий считает выплаты по настраиваемому справочнику (баллы ОГЭ/ЕГЭ)', () => {
  // Строка 1.3 ТЗ: наличие обучающихся с баллами ОГЭ/ЕГЭ и ВПР — выплата за каждого.
  const criterion = {
    levels: [{ id: 'ege', label: 'ЕГЭ' }, { id: 'vpr', label: 'ВПР (4 класс)' }],
    diplomas: [{ id: 'score100', label: '100 баллов' }, { id: 'score90', label: '90–99 баллов' }, { id: 'pass', label: 'Положительный результат' }],
    olympiadAmounts: { ege: { score100: 5000, score90: 3500 }, vpr: { pass: 3000 } },
  };
  const entries = [
    { level: 'ege', diploma: 'score100', studentName: 'Иванов Иван', olympiadName: 'ЕГЭ, математика' },
    { level: 'ege', diploma: 'score90', studentName: 'Петрова Анна', olympiadName: 'ЕГЭ, русский язык' },
    { level: 'vpr', diploma: 'pass', studentName: 'Сидоров Олег', olympiadName: 'ВПР, 4 класс' },
  ];
  // 5000 + 3500 + 3000 = 11500 — начисление за каждого обучающегося.
  assert.equal(calculateOlympiadTotal(criterion, entries), 11500);
  assert.equal(getOlympiadReward(criterion, { level: 'ege', diploma: 'score100' }), 5000);
  // незаполненная строка ученика не учитывается
  assert.equal(calculateOlympiadTotal(criterion, [...entries, { level: 'ege', diploma: 'score100', studentName: '', olympiadName: '' }]), 11500);
});

test('коэффициент фонда масштабирует выплаты при превышении фонда', () => {
  const applications = [{ id: 'a1', total: 300000 }, { id: 'a2', total: 100000 }];
  // Потенциальная сумма 400 000 ₽ не превышает фонд — K = 1.
  const exact = calculatePayouts(applications, 400000);
  assert.equal(exact.coefficient, 1);
  assert.equal(exact.total, 400000);
  assert.equal(exact.rows[0].payout, 300000);
  // Фонд 300 000 ₽ при потенциале 400 000 ₽ — K = 0,75, выплаты пропорциональны.
  const over = calculatePayouts(applications, 300000);
  assert.equal(over.coefficient, 0.75);
  assert.equal(over.rows[0].payout, 225000);
  assert.equal(over.rows[1].payout, 75000);
  assert.equal(over.total, 300000);
  // Фонд не задан — коэффициент не применяется.
  const noFund = calculatePayouts(applications, 0);
  assert.equal(noFund.coefficient, 1);
  assert.equal(noFund.total, 400000);
});

test('пользовательский критерий распознаёт процентную шкалу и её режим', () => {
  // Только варианты — процентной шкалы нет.
  const variantsOnly = { type: 'custom', scales: [{ key: 'winner', amount: 8000, metadata: { label: 'Победитель' } }] };
  assert.equal(hasBandScales(variantsOnly), false);
  assert.equal(customBandMode(variantsOnly), 'common');
  // Диапазоны с общим ключом — режим «общие проценты».
  const common = { type: 'custom', scales: [{ key: 'COMMON', from: 0, to: 60, amount: 1000 }, { key: 'COMMON', from: 61, to: 100, amount: 2000 }] };
  assert.equal(hasBandScales(common), true);
  assert.equal(customBandMode(common), 'common');
  // Диапазоны с ключом-категорией — режим «по категориям педагогов».
  const byCategory = { type: 'custom', scales: [{ key: 'SUBJECT', from: 0, to: 69, amount: 1000 }, { key: 'ELEMENTARY', from: 0, to: 79, amount: 500 }] };
  assert.equal(customBandMode(byCategory), 'category');
});

test('пользовательский критерий считает выплату по процентным диапазонам', () => {
  // Общие диапазоны доступны педагогу любой категории (как после mapCriterion:
  // общие диапазоны попадают в qualityBands, когда нет диапазонов по категории).
  const common = { type: 'custom', categoryBands: {}, qualityBands: [{ from: 0, to: 60, amount: 1000 }, { from: 61, to: 100, amount: 2000 }] };
  assert.equal(getQualityBand(common, 45, 'subject')?.amount, 1000);
  assert.equal(getQualityBand(common, 90, 'creative')?.amount, 2000);
  assert.equal(getQualityBand(common, '', 'subject'), null);
  // По категориям: каждый педагог видит свою шкалу.
  const byCategory = { type: 'custom', categoryBands: { subject: [{ from: 0, to: 69, amount: 1000 }], elementary: [{ from: 0, to: 79, amount: 500 }] } };
  assert.equal(getQualityBand(byCategory, 50, 'subject')?.amount, 1000);
  assert.equal(getQualityBand(byCategory, 50, 'elementary')?.amount, 500);
});

test('отправка пользовательского критерия с процентной шкалой требует процент', () => {
  const bandCriterion = { id: 'c1', type: 'custom', scales: [{ key: 'COMMON', from: 0, to: 100, amount: 1000 }], fields: [] };
  assert.deepEqual(getApplicationValidationErrors({ items: [{ criterionId: 'c1', percentage: 55, values: { percentage: 55 } }] }, [bandCriterion]), []);
  assert.deepEqual(getApplicationValidationErrors({ items: [{ criterionId: 'c1', percentage: '', values: {} }] }, [bandCriterion]), [{ criterionId: 'c1', code: 'custom-percentage' }]);
  assert.deepEqual(getApplicationValidationErrors({ items: [{ criterionId: 'c1', percentage: 150, values: { percentage: 150 } }] }, [bandCriterion]), [{ criterionId: 'c1', code: 'custom-percentage' }]);
  // Критерий с вариантами процентов не требует — сумма берётся из варианта.
  const variantCriterion = { id: 'c2', type: 'custom', scales: [{ key: 'winner', amount: 8000, metadata: { label: 'Победитель' } }], fields: [] };
  assert.deepEqual(getApplicationValidationErrors({ items: [{ criterionId: 'c2', values: {} }] }, [variantCriterion]), []);
});
