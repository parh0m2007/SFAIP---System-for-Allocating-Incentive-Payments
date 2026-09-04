import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication, submitApplication, calculateReward, canCreateApplication, getReviewableApplications, updateCriterionAmount, getQualityBand, getOlympiadReward, calculateOlympiadTotal, normalizeQualityPercentage, getApplicationValidationErrors, criterionUpdatePayload } from '../src/domain.js';

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
