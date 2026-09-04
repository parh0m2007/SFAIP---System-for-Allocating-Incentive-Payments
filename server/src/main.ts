import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Body, Controller, Delete, Get, Injectable, Module, Param, Patch, Post, Req, Res, UnauthorizedException, UseGuards, UseInterceptors, UploadedFile, BadRequestException, ForbiddenException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PrismaService } from './prisma.service.js';
import { AuthGuard, Session } from './auth.guard.js';
import { Prisma, Role, CriterionType, ApplicationStatus, FieldType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { assertApplicationItems, assertCriterionPayload, assertOlympiadEntry, assertRegisterPayload, assertWritableEvidence, assertTeacherRole } from './validation.js';

// Keep the no-Docker start command self-contained: load server/.env when present.
if (existsSync(path.resolve(process.cwd(), '.env'))) {
  for (const line of readFileSync(path.resolve(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*[\"']?([^\"']*)[\"']?\s*$/);
    if (match && process.env[match[1]] == null) process.env[match[1]] = match[2];
  }
}

const accessSecret = () => process.env.JWT_ACCESS_SECRET || 'dev-access';
const refreshSecret = () => process.env.JWT_REFRESH_SECRET || 'dev-refresh';
const signAccess = (u: any) => jwt.sign({ userId: u.id, role: u.role, schoolId: u.schoolId }, accessSecret(), { expiresIn: '15m' });
const publicUser = (u: any) => ({ id: u.id, fullName: u.fullName, email: u.email, role: u.role, position: u.position, school: u.school });
const parseJson = (value: string | null | undefined, fallback: any = {}) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } };

@Controller('api')
export class ApiController {
  // tsx/esbuild does not emit constructor parameter metadata; keep the API
  // self-contained for the no-Docker MVP by creating the Prisma client here.
  private readonly db: PrismaService;
  constructor() { this.db = new PrismaService(); }

  @Get('schools')
  async schools() { return this.db.school.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }); }

  @Post('auth/register')
  async register(@Body() b: any) {
    assertRegisterPayload(b);
    if (!Object.values(Role).includes(b.role)) throw new BadRequestException({ code: 'ROLE_INVALID', message: 'Недопустимая роль' });
    const school = await this.db.school.findUnique({ where: { id: b.schoolId } });
    if (!school?.active) throw new BadRequestException({ code: 'SCHOOL_INVALID', message: 'Школа не найдена' });
    if (b.role === Role.DEPUTY && await this.db.user.findFirst({ where: { schoolId: school.id, role: Role.DEPUTY } })) throw new BadRequestException({ code: 'DEPUTY_EXISTS', message: 'В школе уже зарегистрирован завуч' });
    if (await this.db.user.findUnique({ where: { email: String(b.email).trim().toLowerCase() } })) throw new BadRequestException({ code: 'EMAIL_EXISTS', message: 'Пользователь с таким email уже зарегистрирован' });
    const user = await this.db.user.create({ data: { fullName: b.fullName.trim(), email: b.email.trim().toLowerCase(), passwordHash: await bcrypt.hash(b.password, 12), role: b.role, position: b.position || null, schoolId: school.id }, include: { school: true } });
    const result = await this.issueTokens(user);
    await this.audit(user.id, school.id, 'REGISTER', 'User', user.id);
    return result;
  }

  @Post('auth/login')
  async login(@Body() b: any) {
    const user = await this.db.user.findUnique({ where: { email: String(b?.email || '').toLowerCase() }, include: { school: true } });
    if (!user || !(await bcrypt.compare(String(b?.password || ''), user.passwordHash))) throw new UnauthorizedException({ code: 'LOGIN_FAILED', message: 'Неверный email или пароль' });
    const result = await this.issueTokens(user);
    await this.audit(user.id, user.schoolId, 'LOGIN', 'User', user.id);
    return result;
  }

  @Post('auth/refresh')
  async refresh(@Body() b: any) {
    try {
      const payload = jwt.verify(String(b?.refreshToken || ''), refreshSecret()) as { userId: string; nonce: string };
      const tokens = await this.db.refreshToken.findMany({ where: { userId: payload.userId, revokedAt: null } });
      const match = await tokens.reduce(async (found, token) => (await found) || (await bcrypt.compare(String(b.refreshToken), token.tokenHash) ? token : null), Promise.resolve<any>(null));
      if (!match || match.expiresAt < new Date()) throw new Error('invalid');
      await this.db.refreshToken.update({ where: { id: match.id }, data: { revokedAt: new Date() } });
      const user = await this.db.user.findUnique({ where: { id: payload.userId }, include: { school: true } });
      if (!user) throw new Error('missing');
      return this.issueTokens(user);
    } catch { throw new UnauthorizedException({ code: 'REFRESH_INVALID', message: 'Refresh-токен недействителен' }); }
  }

  @UseGuards(AuthGuard) @Post('auth/logout')
  async logout(@Req() req: any) { await this.db.refreshToken.updateMany({ where: { userId: req.user.userId, revokedAt: null }, data: { revokedAt: new Date() } }); await this.audit(req.user.userId, req.user.schoolId, 'LOGOUT', 'User', req.user.userId); return { ok: true }; }

  @UseGuards(AuthGuard) @Get('profile')
  async profile(@Req() req: any) { return publicUser(await this.db.user.findUnique({ where: { id: req.user.userId }, include: { school: true } })); }

  @UseGuards(AuthGuard) @Patch('profile')
  async updateProfile(@Req() req: any, @Body() b: any) { const data: any = {}; if (b.fullName !== undefined) data.fullName = String(b.fullName).trim(); if (b.position !== undefined) data.position = String(b.position).trim() || null; if (!data.fullName && data.fullName !== undefined) throw new BadRequestException({ code: 'VALIDATION', message: 'Укажите ФИО' }); const user = await this.db.user.update({ where: { id: req.user.userId }, data, include: { school: true } }); await this.audit(req.user.userId, req.user.schoolId, 'PROFILE_UPDATE', 'User', req.user.userId); return publicUser(user); }

  @UseGuards(AuthGuard) @Get('criteria')
  async listCriteria(@Req() req: any) { return this.db.criterion.findMany({ where: { schoolId: req.user.schoolId, ...(req.user.role === Role.TEACHER ? { active: true } : {}) }, include: { fields: { orderBy: { order: 'asc' } }, scales: true }, orderBy: { createdAt: 'asc' } }); }

  @UseGuards(AuthGuard) @Get('users')
  async listUsers(@Req() req: any) { this.onlyDeputy(req.user); return this.db.user.findMany({ where: { schoolId: req.user.schoolId, role: Role.TEACHER }, select: { id: true, fullName: true, email: true, position: true, school: true }, orderBy: { fullName: 'asc' } }); }

  @UseGuards(AuthGuard) @Post('criteria')
  async createCriterion(@Req() req: any, @Body() b: any) { this.onlyDeputy(req.user); const result = await this.saveCriterion(req.user.schoolId, b); await this.audit(req.user.userId, req.user.schoolId, 'CRITERION_CREATE', 'Criterion', result.id); return result; }

  @UseGuards(AuthGuard) @Patch('criteria/:id')
  async updateCriterion(@Req() req: any, @Param('id') id: string, @Body() b: any) { this.onlyDeputy(req.user); const c = await this.db.criterion.findFirst({ where: { id, schoolId: req.user.schoolId } }); if (!c) throw new BadRequestException({ code: 'NOT_FOUND', message: 'Критерий не найден' }); const result = await this.saveCriterion(req.user.schoolId, b, id, c.version + 1); await this.audit(req.user.userId, req.user.schoolId, 'CRITERION_UPDATE', 'Criterion', id, { version: result.version }); return result; }

  @UseGuards(AuthGuard) @Patch('criteria/:id/status')
  async updateCriterionStatus(@Req() req: any, @Param('id') id: string, @Body() b: any) { this.onlyDeputy(req.user); if (typeof b?.active !== 'boolean') throw new BadRequestException({ code: 'STATUS_INVALID', message: 'Укажите статус критерия' }); const c = await this.db.criterion.findFirst({ where: { id, schoolId: req.user.schoolId } }); if (!c) throw new BadRequestException({ code: 'NOT_FOUND', message: 'Критерий не найден' }); const result = await this.db.criterion.update({ where: { id }, data: { active: b.active, version: c.version + 1 }, include: { fields: { orderBy: { order: 'asc' } }, scales: true } }); await this.audit(req.user.userId, req.user.schoolId, 'CRITERION_STATUS_UPDATE', 'Criterion', id, { active: b.active, version: result.version }); return result; }

  @UseGuards(AuthGuard) @Delete('criteria/:id')
  async deleteCriterion(@Req() req: any, @Param('id') id: string) { this.onlyDeputy(req.user); const c = await this.db.criterion.findFirst({ where: { id, schoolId: req.user.schoolId } }); if (!c) throw new BadRequestException({ code: 'NOT_FOUND', message: 'Критерий не найден' }); const result = await this.db.criterion.update({ where: { id }, data: { active: false } }); await this.audit(req.user.userId, req.user.schoolId, 'CRITERION_DELETE', 'Criterion', id); return result; }

  @UseGuards(AuthGuard) @Get('applications')
  async listApplications(@Req() req: any) { const where = req.user.role === Role.TEACHER ? { teacherId: req.user.userId } : { schoolId: req.user.schoolId }; return this.db.application.findMany({ where, include: { items: { include: { olympiadEntries: true, files: true } }, period: true, teacher: { select: { id: true, fullName: true, position: true } } }, orderBy: { updatedAt: 'desc' } }); }

  @UseGuards(AuthGuard) @Post('applications')
  async createApplication(@Req() req: any, @Body() b: any) { if (req.user.role !== Role.TEACHER) throw new ForbiddenException(); const period = await this.db.period.findFirst({ where: { id: b.periodId || undefined, active: true } }); if (!period) throw new BadRequestException({ code: 'PERIOD_INVALID', message: 'Отчётный период не найден' }); try { return await this.db.application.create({ data: { teacherId: req.user.userId, schoolId: req.user.schoolId, periodId: period.id } }); } catch { throw new BadRequestException({ code: 'ONE_APPLICATION', message: 'На этот период уже есть заявка' }); } }

  @UseGuards(AuthGuard) @Get('applications/:id')
  async getApplication(@Req() req: any, @Param('id') id: string) { const a = await this.db.application.findFirst({ where: { id, ...(req.user.role === Role.TEACHER ? { teacherId: req.user.userId } : { schoolId: req.user.schoolId }) }, include: { items: { include: { olympiadEntries: true, files: true } }, period: true, teacher: { select: { id: true, fullName: true, email: true, role: true, position: true, school: true } } } }); if (!a) throw new BadRequestException({ code: 'NOT_FOUND', message: 'Заявка не найдена' }); return a; }

  @UseGuards(AuthGuard) @Patch('applications/:id')
  async patchApplication(@Req() req: any, @Param('id') id: string, @Body() b: any) {
    assertTeacherRole(req.user.role);
    const a = await this.getWritableApplication(req.user, id);
    const criteria = await this.db.criterion.findMany({ where: { schoolId: req.user.schoolId, active: true }, include: { fields: true, scales: true } });
    const incoming = Array.isArray(b.items) ? b.items : [];
    assertApplicationItems(incoming, criteria, req.user.schoolId, { strict: false });
    const items = incoming.map((i: any) => this.calculateItem(i, criteria.find((c) => c.id === i.criterionId)));
    const total = items.reduce((s: number, i: any) => s + i.amount, 0);
    return this.db.$transaction(async (tx) => {
      // Keep evidence files while replacing items, then attach them to the
      // newly-created item with the same criterion. The unique criterion
      // constraint in assertApplicationItems makes this mapping unambiguous.
      const oldItems = await tx.applicationItem.findMany({
        where: { applicationId: a.id },
        select: { criterionId: true, files: { select: { id: true } } },
      });
      const oldFilesByCriterion = new Map(oldItems.map((item: any) => [
        item.criterionId,
        item.files.map((file: any) => file.id),
      ]));
      await tx.evidenceFile.updateMany({ where: { applicationId: a.id }, data: { itemId: null } });
      await tx.applicationItem.deleteMany({ where: { applicationId: a.id } });
      const updated = await tx.application.update({
        where: { id: a.id },
        data: {
          total,
          items: {
            create: items.map((i: any) => ({
              criterionId: i.criterionId,
              criterionVersion: i.criterionVersion,
              titleSnapshot: i.titleSnapshot,
              amount: i.amount,
              valuesJson: JSON.stringify(i.values || {}),
              olympiadEntries: {
                create: (i.entries || []).map((e: any) => ({
                  level: e.level,
                  diploma: e.diploma,
                  studentName: e.studentName || '',
                  olympiadName: e.olympiadName || '',
                  amount: e.amount || 0,
                })),
              },
            })),
          },
        },
        include: { items: { include: { olympiadEntries: true, files: true } } },
      });
      for (const item of updated.items) {
        const fileIds = oldFilesByCriterion.get(item.criterionId) || [];
        if (fileIds.length) {
          await tx.evidenceFile.updateMany({
            where: { id: { in: fileIds }, applicationId: a.id },
            data: { itemId: item.id },
          });
        }
      }
      return tx.application.findUnique({
        where: { id: a.id },
        include: { items: { include: { olympiadEntries: true, files: true } } },
      });
    });
  }

  @UseGuards(AuthGuard) @Post('applications/:id/submit')
  async submit(@Req() req: any, @Param('id') id: string) { assertTeacherRole(req.user.role); const a = await this.getWritableApplication(req.user, id); const full = await this.db.application.findUnique({ where: { id: a.id }, include: { items: { include: { olympiadEntries: true } }, teacher: { select: { fullName: true } } } }); if (!full?.items.length) throw new BadRequestException({ code: 'EMPTY_APPLICATION', message: 'Добавьте хотя бы один критерий' }); const criteria = await this.db.criterion.findMany({ where: { schoolId: req.user.schoolId, active: true }, include: { fields: true, scales: true } }); const items = full.items.map((item: any) => ({ criterionId: item.criterionId, values: parseJson(item.valuesJson, {}), entries: item.olympiadEntries })); assertApplicationItems(items, criteria, req.user.schoolId); const updated = await this.db.application.update({ where: { id: a.id }, data: { status: ApplicationStatus.REVIEW, submittedAt: new Date(), comment: null } }); const deputies = await this.db.user.findMany({ where: { schoolId: req.user.schoolId, role: Role.DEPUTY }, select: { id: true } }); await Promise.all(deputies.map((d) => this.db.notification.create({ data: { userId: d.id, type: 'submitted', title: 'Новая заявка на проверку', body: `${full.teacher.fullName} отправил(а) заявку`, link: `/applications/${a.id}` } }))); await this.audit(req.user.userId, req.user.schoolId, 'APPLICATION_SUBMIT', 'Application', a.id); return updated; }

  @UseGuards(AuthGuard) @Get('reviews')
  async reviews(@Req() req: any) { this.onlyDeputy(req.user); return this.db.application.findMany({ where: { schoolId: req.user.schoolId, status: ApplicationStatus.REVIEW }, include: { teacher: { select: { id: true, fullName: true, email: true, position: true } }, items: true }, orderBy: { submittedAt: 'asc' } }); }

  @UseGuards(AuthGuard) @Post('reviews/:id/approve')
  async approve(@Req() req: any, @Param('id') id: string) { this.onlyDeputy(req.user); return this.decide(req.user, id, ApplicationStatus.APPROVED); }

  @UseGuards(AuthGuard) @Post('reviews/:id/reject')
  async reject(@Req() req: any, @Param('id') id: string, @Body() b: any) { this.onlyDeputy(req.user); if (!String(b?.comment || '').trim()) throw new BadRequestException({ code: 'COMMENT_REQUIRED', message: 'Укажите причину отклонения' }); return this.decide(req.user, id, ApplicationStatus.REJECTED, b.comment); }

  @UseGuards(AuthGuard) @Get('notifications')
  async notifications(@Req() req: any) { return this.db.notification.findMany({ where: { userId: req.user.userId }, orderBy: { createdAt: 'desc' }, take: 50 }); }
  @UseGuards(AuthGuard) @Post('notifications/:id/read')
  async readNotification(@Req() req: any, @Param('id') id: string) { return this.db.notification.updateMany({ where: { id, userId: req.user.userId }, data: { readAt: new Date() } }); }

  @UseGuards(AuthGuard) @Post('files') @UseInterceptors(FileInterceptor('file'))
  async upload(@Req() req: any, @UploadedFile() file: Express.Multer.File, @Body() b: any) { if (!file || !b.applicationId) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Выберите файл и заявку' }); const a = await this.db.application.findFirst({ where: { id: b.applicationId, schoolId: req.user.schoolId, ...(req.user.role === Role.TEACHER ? { teacherId: req.user.userId } : {}) } }); if (!a) throw new ForbiddenException(); const item = b.itemId ? await this.db.applicationItem.findFirst({ where: { id: b.itemId, applicationId: a.id }, include: { criterion: true } }) : null; if (b.itemId && !item) throw new BadRequestException({ code: 'ITEM_INVALID', message: 'Элемент заявки не найден' }); if (item) assertWritableEvidence(a, item.criterion, item, req.user.role); else if (req.user.role === Role.TEACHER && !['DRAFT', 'REJECTED'].includes(a.status)) throw new BadRequestException({ code: 'STATUS_LOCKED', message: 'Заявка уже отправлена на проверку' }); if (file.size > 10 * 1024 * 1024) throw new BadRequestException({ code: 'FILE_TOO_LARGE', message: 'Файл больше 10 МБ' }); const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']; if (!allowed.includes(file.mimetype)) throw new BadRequestException({ code: 'FILE_TYPE', message: 'Недопустимый тип файла' }); const dir = path.resolve(process.cwd(), 'storage'); await mkdir(dir, { recursive: true }); const stored = `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`; await writeFile(path.join(dir, stored), file.buffer); const result = await this.db.evidenceFile.create({ data: { originalName: file.originalname, mimeType: file.mimetype, size: file.size, path: stored, uploadedById: req.user.userId, applicationId: a.id, itemId: item?.id || null } }); await this.audit(req.user.userId, req.user.schoolId, 'FILE_UPLOAD', 'EvidenceFile', result.id, { applicationId: a.id }); return result; }

  @UseGuards(AuthGuard) @Get('files/:id')
  async download(@Req() req: any, @Param('id') id: string, @Res() res: any) { const f = await this.db.evidenceFile.findUnique({ where: { id }, include: { application: true } }); if (!f || f.application.schoolId !== req.user.schoolId || (req.user.role === Role.TEACHER && f.application.teacherId !== req.user.userId)) throw new ForbiddenException(); res.setHeader('Content-Type', f.mimeType); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.originalName)}`); res.send(await readFile(path.resolve(process.cwd(), 'storage', f.path))); }

  @UseGuards(AuthGuard) @Get('reports/:periodId/export.xlsx')
  async export(@Req() req: any, @Param('periodId') periodId: string, @Res() res: any) { this.onlyDeputy(req.user); const apps = await this.db.application.findMany({ where: { periodId, schoolId: req.user.schoolId, status: ApplicationStatus.APPROVED }, include: { teacher: { select: { fullName: true } }, items: true } }); const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Заявки'); ws.columns = [{ header: 'Учитель', key: 'teacher', width: 28 }, { header: 'Статус', key: 'status', width: 14 }, { header: 'Сумма, ₽', key: 'total', width: 14 }]; apps.forEach((a) => ws.addRow({ teacher: a.teacher.fullName, status: 'Утверждена', total: a.total })); const cs = wb.addWorksheet('Критерии'); cs.columns = [{ header: 'Критерий', key: 'title', width: 45 }, { header: 'Сумма, ₽', key: 'amount', width: 14 }]; const criteria = await this.db.criterion.findMany({ where: { schoolId: req.user.schoolId } }); criteria.forEach((c) => cs.addRow({ title: c.title, amount: c.maxAmount })); const totals = wb.addWorksheet('Итоги'); totals.columns = [{ header: 'Показатель', key: 'metric', width: 32 }, { header: 'Значение', key: 'value', width: 18 }]; totals.addRow({ metric: 'Утверждённых заявок', value: apps.length }); totals.addRow({ metric: 'Итого к выплате, ₽', value: apps.reduce((sum, a) => sum + a.total, 0) }); await this.audit(req.user.userId, req.user.schoolId, 'REPORT_EXPORT', 'Period', periodId, { applications: apps.length }); res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="report-${periodId}.xlsx"`); await wb.xlsx.write(res); res.end(); }

  private onlyDeputy(u: Session) { if (u.role !== Role.DEPUTY) throw new ForbiddenException({ code: 'DEPUTY_ONLY', message: 'Доступ только завучу' }); }
  private async issueTokens(user: any) { const refreshToken = jwt.sign({ userId: user.id, nonce: randomBytes(8).toString('hex') }, refreshSecret(), { expiresIn: '30d' }); await this.db.refreshToken.create({ data: { tokenHash: await bcrypt.hash(refreshToken, 10), userId: user.id, expiresAt: new Date(Date.now() + 30 * 86400000) } }); return { accessToken: signAccess(user), refreshToken, user: publicUser(user) }; }
  private async saveCriterion(schoolId: string, b: any, id?: string, version = 1) { const normalized = { ...b, type: String(b?.type || '').toUpperCase(), title: String(b?.title || '').trim(), category: String(b?.category || 'Другое').trim(), maxAmount: Number(b?.maxAmount), amount: b?.amount == null || b?.amount === '' ? null : Number(b.amount), fields: Array.isArray(b?.fields) ? b.fields : [], scales: Array.isArray(b?.scales) ? b.scales : [] }; assertCriterionPayload(normalized); const maxAmount = normalized.maxAmount; const rawAmount = normalized.amount == null ? (normalized.type === CriterionType.FIXED ? maxAmount : null) : normalized.amount; const data: any = { title: normalized.title, category: normalized.category, type: normalized.type, amount: rawAmount == null ? null : Math.min(rawAmount, maxAmount), maxAmount, allowEvidence: Boolean(normalized.allowEvidence), version, fields: { create: normalized.fields.map((f: any, idx: number) => ({ key: String(f.key).trim(), label: String(f.label).trim(), type: String(f.type || FieldType.TEXT).toUpperCase(), required: Boolean(f.required), order: idx, optionsJson: f.options ? JSON.stringify(f.options) : f.optionsJson || null })) }, scales: { create: normalized.scales.map((s: any) => ({ key: s.key || randomUUID(), fromValue: s.from == null ? null : Number(s.from), toValue: s.to == null ? null : Number(s.to), amount: Number(s.amount), metadataJson: s.metadata ? JSON.stringify(s.metadata) : null })) } }; const include = { fields: { orderBy: { order: 'asc' as const } }, scales: true }; if (id) { await this.db.criterionField.deleteMany({ where: { criterionId: id } }); await this.db.criterionScale.deleteMany({ where: { criterionId: id } }); return this.db.criterion.update({ where: { id }, data, include }); } return this.db.criterion.create({ data: { ...data, schoolId }, include }); }
  private async getWritableApplication(u: Session, id: string) { const a = await this.db.application.findFirst({ where: { id, schoolId: u.schoolId, ...(u.role === Role.TEACHER ? { teacherId: u.userId } : {}) } }); if (!a) throw new BadRequestException({ code: 'NOT_FOUND', message: 'Заявка не найдена' }); if (u.role === Role.TEACHER && a.status !== ApplicationStatus.DRAFT && a.status !== ApplicationStatus.REJECTED) throw new BadRequestException({ code: 'STATUS_LOCKED', message: 'Заявка уже отправлена на проверку' }); return a; }
  private calculateItem(i: any, c: any) { if (!c) throw new BadRequestException({ code: 'CRITERION_INVALID', message: 'Критерий недоступен' }); const values = i.values || {}; let amount = 0; if (c.type === CriterionType.QUALITY) { const p = Number(values.percentage); const matches = c.scales.filter((x: any) => p >= (x.fromValue ?? -Infinity) && p <= (x.toValue ?? Infinity)).sort((a: any, b: any) => (b.fromValue ?? -Infinity) - (a.fromValue ?? -Infinity)); amount = matches[0]?.amount || 0; } else if (c.type === CriterionType.OLYMPIAD) { amount = (i.entries || []).reduce((sum: number, e: any) => sum + (c.scales.find((s: any) => s.key === `${e.level}:${e.diploma}`)?.amount || 0), 0); } else amount = c.amount ?? c.maxAmount; return { criterionId: c.id, criterionVersion: c.version, titleSnapshot: c.title, amount, values, entries: i.entries || [] }; }
  private async decide(u: Session, id: string, status: ApplicationStatus, comment = '') { const a = await this.db.application.findFirst({ where: { id, schoolId: u.schoolId, status: ApplicationStatus.REVIEW } }); if (!a) throw new BadRequestException({ code: 'STATUS_INVALID', message: 'Заявка не находится на проверке' }); const updated = await this.db.application.update({ where: { id }, data: { status, comment: status === ApplicationStatus.REJECTED ? comment.trim() : null, decidedAt: new Date() } }); await this.db.notification.create({ data: { userId: a.teacherId, type: status.toLowerCase(), title: status === ApplicationStatus.APPROVED ? 'Заявка утверждена' : 'Нужно исправить заявку', body: status === ApplicationStatus.APPROVED ? `Сумма выплаты: ${a.total} ₽` : comment, link: `/applications/${a.id}` } }); await this.audit(u.userId, u.schoolId, status === ApplicationStatus.APPROVED ? 'APPLICATION_APPROVE' : 'APPLICATION_REJECT', 'Application', a.id, { comment: comment || undefined }); return updated; }
  private async audit(userId: string | null, schoolId: string | null, action: string, entity: string, entityId?: string, details?: any) { await this.db.auditLog.create({ data: { userId: userId || undefined, schoolId: schoolId || undefined, action, entity, entityId, detailsJson: details ? JSON.stringify(details) : undefined } }); }
}

@Module({ controllers: [ApiController], providers: [PrismaService, AuthGuard] })
export class AppModule {}

async function bootstrap() { const app = await NestFactory.create(AppModule); app.enableCors(); app.setGlobalPrefix(''); await app.listen(Number(process.env.PORT || 3001)); console.log(`API listening on http://localhost:${process.env.PORT || 3001}`); }
bootstrap();
