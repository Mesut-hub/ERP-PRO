import type { PrismaConfig } from 'prisma';

export default {
  schema: './prisma/schema.prisma',
  seed: 'ts-node --transpile-only prisma/seed.ts',
} satisfies PrismaConfig;
