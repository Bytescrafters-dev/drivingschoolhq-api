# Repository examples

## Interface boundary
```ts
export interface LicenceApplicationRepository {
  findByIdForTenant(tenantId: string, id: string): Promise<LicenceApplication | null>;
  getForStatusTransition(tenantId: string, id: string): Promise<LicenceApplication | null>;
}
```

## Prisma implementation
```ts
@Injectable()
export class PrismaLicenceApplicationRepository implements LicenceApplicationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByIdForTenant(tenantId: string, id: string) {
    const record = await this.prisma.licenceApplication.findFirst({
      where: { id, tenantId },
    });
    return record ? mapApplication(record) : null;
  }
}
```

**Adapt this example to the actual project's models, Prisma casing and mapper conventions.** Injection token/provider registration belongs to the owning Nest module.

## Transaction guardrail
Unsafe:
```ts
await prisma.tenantInvoice.update({ where: { id }, data: { status: 'PAID' } });
```
Safe intent: record payment in the correct tenant scope, reconcile amounts, atomically persist invoice/payment state, and reevaluate tenant access. See `transactions.md` and `platform-saas`.
