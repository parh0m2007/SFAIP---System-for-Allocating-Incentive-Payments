import { BadRequestException } from '@nestjs/common';
import { CriterionType, FieldType, Role } from '@prisma/client';

const OLYMPIAD_LEVELS = new Set(['municipal', 'regional', 'krai', 'federal', 'all-russian', 'international']);
const DIPLOMA_TYPES = new Set(['winner', 'prize']);
const FIELD_TYPES = new Set(Object.values(FieldType));
const CRITERION_TYPES = new Set(Object.values(CriterionType));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fail = (code: string, message: string): never => { throw new BadRequestException({ code, message }); };

export function assertPeriodPayload(payload: any) {
  const label = String(payload?.label || '').trim();
  if (!label || label.length > 160) fail('PERIOD_INVALID', 'Укажите название периода (до 160 символов)');
  const startsAt = new Date(payload?.startsAt);
  const endsAt = new Date(payload?.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) fail('PERIOD_INVALID', 'Укажите даты начала и окончания периода');
  if (startsAt >= endsAt) fail('PERIOD_INVALID', 'Дата окончания должна быть позже даты начала');
}

export function assertTeacherRole(role: unknown): asserts role is typeof Role.TEACHER {
  if (role !== Role.TEACHER) fail('TEACHER_ONLY', 'Операция доступна только учителю');
}
const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const amount = (value: unknown, max: number, code = 'AMOUNT_INVALID') => {
  if (!finiteNumber(value) || !Number.isInteger(value) || value < 0 || value > max) fail(code, `Сумма должна быть целым числом от 0 до ${max} ₽`);
};

export function assertRegisterPayload(payload: any) {
  const fullName = String(payload?.fullName || '').trim();
  const email = String(payload?.email || '').trim();
  const password = String(payload?.password || '');
  if (fullName.length < 2 || fullName.length > 120) fail('VALIDATION', 'Укажите корректные ФИО');
  if (!EMAIL_RE.test(email) || email.length > 160) fail('EMAIL_INVALID', 'Укажите корректный email');
  if (password.length < 8 || password.length > 128) fail('PASSWORD_INVALID', 'Пароль должен содержать от 8 до 128 символов');
  if (!String(payload?.schoolId || '').trim()) fail('SCHOOL_INVALID', 'Выберите школу');
  if (!Object.values(Role).includes(payload?.role)) fail('ROLE_INVALID', 'Недопустимая роль');
}

export function assertCriterionPayload(payload: any) {
  const title = String(payload?.title || '').trim();
  const category = String(payload?.category || '').trim();
  const type = String(payload?.type || '').toUpperCase();
  const maxAmount = payload?.maxAmount;
  if (!title || title.length > 200 || !category || category.length > 120) fail('VALIDATION', 'Название и категория обязательны');
  if (!CRITERION_TYPES.has(type as CriterionType)) fail('TYPE_INVALID', 'Недопустимый тип критерия');
  if (!finiteNumber(maxAmount) || !Number.isInteger(maxAmount) || maxAmount < 0 || maxAmount > 1_000_000) fail('AMOUNT_INVALID', 'Максимум должен быть целым числом от 0 до 1 000 000 ₽');
  if (payload?.amount != null) amount(payload.amount, maxAmount);

  const fields = payload?.fields == null ? [] : payload.fields;
  if (!Array.isArray(fields) || fields.length > 30) fail('FIELDS_INVALID', 'Поля критерия заданы некорректно');
  const keys = new Set<string>();
  fields.forEach((field: any) => {
    const key = String(field?.key || '').trim();
    const label = String(field?.label || '').trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(key) || keys.has(key) || !label || label.length > 120 || !FIELD_TYPES.has(String(field?.type || 'TEXT').toUpperCase() as FieldType)) fail('FIELDS_INVALID', 'Проверьте ключи, подписи и типы полей');
    keys.add(key);
    if (String(field?.type || '').toUpperCase() === FieldType.SELECT && (!Array.isArray(field.options) || !field.options.length || field.options.length > 50)) fail('FIELDS_INVALID', 'Для списка добавьте варианты выбора');
  });

  const scales = payload?.scales == null ? [] : payload.scales;
  if (!Array.isArray(scales) || scales.length > 100) fail('SCALES_INVALID', 'Шкалы заданы некорректно');
  const ranges = scales.filter((scale: any) => scale?.from != null || scale?.to != null);
  const sorted = [...ranges].sort((a, b) => Number(a.from ?? -Infinity) - Number(b.from ?? -Infinity));
  sorted.forEach((scale: any, index: number) => {
    const from = scale.from == null ? 0 : Number(scale.from);
    const to = scale.to == null ? 100 : Number(scale.to);
    if (!finiteNumber(from) || !finiteNumber(to) || from < 0 || to > 100 || from > to) fail('SCALES_INVALID', 'Диапазоны процентов должны быть от 0 до 100 без пересечений');
    amount(Number(scale.amount), maxAmount, 'SCALES_INVALID');
    const previous = sorted[index - 1];
    if (previous) {
      const previousTo = previous.to == null ? 100 : Number(previous.to);
      if (from < previousTo) fail('SCALES_INVALID', 'Диапазоны процентов не должны пересекаться');
    }
  });
  scales.filter((scale: any) => !ranges.includes(scale)).forEach((scale: any) => {
    if (!String(scale?.key || '').trim()) fail('SCALES_INVALID', 'Укажите ключ шкалы');
    amount(Number(scale.amount), maxAmount, 'SCALES_INVALID');
  });
  const scaleKeys = new Set<string>();
  scales.forEach((scale: any) => {
    const key = String(scale?.key || '').trim();
    if (key && scaleKeys.has(key)) fail('SCALES_INVALID', `Шкала «${key}» указана повторно`);
    if (key) scaleKeys.add(key);
  });
}

export function assertCustomFields(fields: any[] = [], values: any = {}, strict = true) {
  if (!Array.isArray(fields)) fail('FIELDS_INVALID', 'Поля критерия заданы некорректно');
  fields.forEach((field: any) => {
    const value = values?.[field.key];
    if (strict && field.required && (value == null || String(value).trim() === '')) fail('FIELD_REQUIRED', `Заполните поле «${field.label}»`);
    if (value == null || value === '') return;
    if (String(field.type).toUpperCase() === FieldType.NUMBER && (!finiteNumber(Number(value)) || String(value).trim() === '')) fail('FIELD_INVALID', `Поле «${field.label}» должно быть числом`);
    if (String(field.type).toUpperCase() === FieldType.SELECT && Array.isArray(field.options) && !field.options.map(String).includes(String(value))) fail('FIELD_INVALID', `Выберите допустимое значение поля «${field.label}»`);
  });
}

export function assertOlympiadEntry(entry: any) {
  if (!OLYMPIAD_LEVELS.has(String(entry?.level || '')) || !DIPLOMA_TYPES.has(String(entry?.diploma || '')) || String(entry?.studentName || '').trim().length < 2 || String(entry?.olympiadName || '').trim().length < 2) fail('OLYMPIAD_ENTRY', 'Заполните уровень, степень, ФИО ученика и название олимпиады');
}

export function assertApplicationItems(items: any[], criteria: any[], schoolId: string, options: { strict?: boolean } = {}) {
  const strict = options.strict !== false;
  if (!Array.isArray(items)) fail('ITEMS_INVALID', 'Критерии заявки заданы некорректно');
  const seen = new Set<string>();
  items.forEach((item: any) => {
    const criterion = criteria.find((candidate: any) => candidate.id === item?.criterionId);
    if (!criterion || criterion.schoolId !== schoolId || seen.has(item.criterionId)) fail('CRITERION_INVALID', 'Критерий недоступен или добавлен повторно');
    seen.add(item.criterionId);
    const values = item.values || {};
    assertCustomFields((criterion.fields || []).map((field: any) => ({ ...field, options: field.options || (field.optionsJson ? parseOptions(field.optionsJson) : []) })), values, strict);
    if (criterion.type === CriterionType.QUALITY) {
      const percentage = Number(values.percentage);
      if (strict && (!Number.isFinite(percentage) || percentage < 0 || percentage > 100)) fail('QUALITY_PERCENTAGE', 'Процент обученности должен быть от 0 до 100');
      if (!strict && values.percentage !== '' && values.percentage != null && (!Number.isFinite(percentage) || percentage < 0 || percentage > 100)) fail('QUALITY_PERCENTAGE', 'Процент обученности должен быть от 0 до 100');
    }
    if (criterion.type === CriterionType.OLYMPIAD) {
      if (strict && (!Array.isArray(item.entries) || !item.entries.length)) fail('OLYMPIAD_ENTRY', 'Добавьте хотя бы одного участника олимпиады');
      if (Array.isArray(item.entries)) item.entries.forEach((entry: any) => {
        if (!strict && !entry?.studentName && !entry?.olympiadName) return;
        assertOlympiadEntry(entry);
      });
    }
  });
}

const parseOptions = (value: string) => { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; } };

export function assertWritableEvidence(application: any, criterion: any, item: any, role: Role) {
  if (!item || item.applicationId !== application.id) fail('ITEM_INVALID', 'Элемент заявки не найден');
  if (!criterion?.allowEvidence) fail('EVIDENCE_DISABLED', 'Для этого критерия подтверждающий документ не требуется');
  if (role === Role.TEACHER && !['DRAFT', 'REJECTED'].includes(application.status)) fail('STATUS_LOCKED', 'Заявка уже отправлена на проверку');
}
