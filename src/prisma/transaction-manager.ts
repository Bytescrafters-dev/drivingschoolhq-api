import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from './prisma.service.js';

export type DbClient = Prisma.TransactionClient;

/**
 * Runs a use case inside one Prisma interactive transaction. Repositories read
 * `client`, which resolves to the active transaction client when called inside
 * `run()` and to the root client otherwise, so every repository call in a use
 * case participates in the same transaction without passing `tx` around.
 *
 * Do not perform network calls (email, HTTP, etc.) inside `run()`.
 */
@Injectable()
export class TransactionManager {
  private readonly storage = new AsyncLocalStorage<DbClient>();

  constructor(private readonly prisma: PrismaService) {}

  get client(): DbClient {
    return this.storage.getStore() ?? this.prisma;
  }

  run<T>(work: () => Promise<T>): Promise<T> {
    if (this.storage.getStore()) {
      return work();
    }
    return this.prisma.$transaction((tx) => this.storage.run(tx, work));
  }
}
