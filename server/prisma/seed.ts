import { PrismaClient, Role, CriterionType, FieldType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const db = new PrismaClient();
async function main() {
  const schools = [
    { id: 'school-101', name: 'МАОУ «СОШ №101» г. Перми' },
    { id: 'school-12', name: 'МАОУ «Гимназия №12» г. Перми' },
  ];
  for (const school of schools) await db.school.upsert({ where: { id: school.id }, update: { name: school.name }, create: school });
  const pass = await bcrypt.hash('demo1234', 12);
  const deputy = await db.user.upsert({ where: { email: 'deputy@school101.local' }, update: {}, create: { fullName: 'Алексей Воронов', email: 'deputy@school101.local', passwordHash: pass, role: Role.DEPUTY, position: 'Заместитель директора', schoolId: 'school-101' } });
  await db.user.upsert({ where: { email: 'teacher@school101.local' }, update: {}, create: { fullName: 'Кристина Обухова', email: 'teacher@school101.local', passwordHash: pass, role: Role.TEACHER, position: 'Учитель математики', schoolId: 'school-101' } });
  const period = await db.period.upsert({ where: { id: 'period-2025-2' }, update: { active: true }, create: { id: 'period-2025-2', label: '2 полугодие 2025–2026 уч. г.', startsAt: new Date('2026-02-01'), endsAt: new Date('2026-09-15'), active: true } });
  const quality = await db.criterion.upsert({ where: { id: 'criterion-quality' }, update: {}, create: { id: 'criterion-quality', schoolId: 'school-101', title: 'Качество обученности', category: 'Учебная деятельность', type: CriterionType.QUALITY, maxAmount: 4000, allowEvidence: true, scales: { create: [{ key: '0-50', fromValue: 0, toValue: 50, amount: 2000 }, { key: '50-75', fromValue: 50.01, toValue: 75, amount: 3000 }, { key: '75-90', fromValue: 75.01, toValue: 90, amount: 4000 }], }, fields: { create: [{ key: 'percentage', label: 'Процент обученности', type: FieldType.NUMBER, required: true, order: 0 }] } } });
  await db.criterion.upsert({ where: { id: 'criterion-olympiad' }, update: {}, create: { id: 'criterion-olympiad', schoolId: 'school-101', title: 'Подготовка победителей и призёров предметных олимпиад', category: 'Результаты обучающихся', type: CriterionType.OLYMPIAD, maxAmount: 7000, allowEvidence: true, scales: { create: [{ key: 'municipal:winner', amount: 1500 }, { key: 'municipal:prize', amount: 1000 }, { key: 'regional:winner', amount: 2500 }, { key: 'regional:prize', amount: 1800 }, { key: 'krai:winner', amount: 3500 }, { key: 'krai:prize', amount: 2600 }, { key: 'federal:winner', amount: 4500 }, { key: 'federal:prize', amount: 3500 }] } } });
  await db.criterion.upsert({ where: { id: 'criterion-method', }, update: {}, create: { id: 'criterion-method', schoolId: 'school-101', title: 'Конкурс профессионального мастерства', category: 'Методическая работа', type: CriterionType.FIXED, maxAmount: 25000, allowEvidence: true } });
  console.log(`Seeded ${deputy.email}, period ${period.id}, criterion ${quality.title}`);
}
main().finally(() => db.$disconnect());
