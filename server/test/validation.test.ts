import test from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { assertCriterionPayload, assertApplicationItems, assertOlympiadEntry, assertCustomFields, assertTeacherRole } from '../src/validation.js';

const responseOf = (fn: () => unknown) => {
  try { fn(); return null; } catch (error) { return error instanceof BadRequestException ? error.getResponse() as any : null; }
};

test('критерий отклоняет пересекающиеся диапазоны и сумму выше максимума', () => {
  const result = responseOf(() => assertCriterionPayload({
    title: 'Качество', category: 'Результаты', type: 'QUALITY', maxAmount: 2000,
    scales: [{ from: 0, to: 60, amount: 1000 }, { from: 50, to: 80, amount: 2500 }], fields: [],
  }));
  assert.equal(result?.code, 'SCALES_INVALID');
});

test('олимпиадные шкалы отклоняют дубликаты ключей', () => {
  const result = responseOf(() => assertCriterionPayload({
    title: 'Олимпиады', category: 'Результаты', type: 'OLYMPIAD', maxAmount: 7000,
    scales: [{ key: 'municipal:winner', amount: 1000 }, { key: 'municipal:winner', amount: 2000 }], fields: [],
  }));
  assert.equal(result?.code, 'SCALES_INVALID');
});

test('поля конструктора должны иметь уникальные ключи и допустимый тип', () => {
  const result = responseOf(() => assertCriterionPayload({
    title: 'Критерий', category: 'Другое', type: 'CUSTOM', maxAmount: 1000,
    fields: [{ key: 'x', label: 'X', type: 'TEXT' }, { key: 'x', label: 'Y', type: 'BAD' }], scales: [],
  }));
  assert.equal(result?.code, 'FIELDS_INVALID');
});

test('заявка не принимает дубликаты критериев и критерии другой школы', () => {
  const result = responseOf(() => assertApplicationItems([
    { criterionId: 'c1', values: {} }, { criterionId: 'c1', values: {} },
  ], [{ id: 'c1', schoolId: 'school-2', type: 'FIXED' }], 'school-1'));
  assert.equal(result?.code, 'CRITERION_INVALID');
});

test('олимпиадная запись требует допустимые уровень, диплом, ФИО и название', () => {
  const result = responseOf(() => assertOlympiadEntry({ level: 'unknown', diploma: 'winner', studentName: '', olympiadName: '' }));
  assert.equal(result?.code, 'OLYMPIAD_ENTRY');
});

test('обязательное пользовательское поле должно быть заполнено', () => {
  const result = responseOf(() => assertCustomFields([{ key: 'note', label: 'Комментарий', type: 'TEXT', required: true }], {}));
  assert.equal(result?.code, 'FIELD_REQUIRED');
});

test('черновик допускает незаполненные специальные поля до отправки', () => {
  assert.doesNotThrow(() => assertApplicationItems([
    { criterionId: 'quality', values: { percentage: '' } },
    { criterionId: 'olympiad', values: {}, entries: [] },
  ], [
    { id: 'quality', schoolId: 'school-1', type: 'QUALITY', fields: [] },
    { id: 'olympiad', schoolId: 'school-1', type: 'OLYMPIAD', fields: [] },
  ], 'school-1', { strict: false }));
});

test('редактирование и отправка заявки разрешены только учителю', () => {
  assert.throws(() => assertTeacherRole('DEPUTY'), BadRequestException);
  assert.doesNotThrow(() => assertTeacherRole('TEACHER'));
});
