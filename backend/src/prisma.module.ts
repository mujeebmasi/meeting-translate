import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// @Global means every other module can inject PrismaService without
// having to import this module. Without it we would create a separate
// database connection pool for each module that used Prisma.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
