import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { PrismaService } from './prisma.service.js';

export type Session = { userId: string; role: 'TEACHER' | 'DEPUTY'; schoolId: string };
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly prisma: PrismaService;
  constructor() { this.prisma = new PrismaService(); }
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: 'Требуется вход в систему' });
    try {
      const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET || 'dev-access') as Session;
      const user = await this.prisma.user.findUnique({ where: { id: payload.userId } });
      if (!user) throw new Error('missing');
      req.user = { userId: user.id, role: user.role, schoolId: user.schoolId } satisfies Session;
      return true;
    } catch { throw new UnauthorizedException({ code: 'AUTH_INVALID', message: 'Сессия истекла, войдите снова' }); }
  }
}
