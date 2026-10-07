# Architecture examples (illustrative, adapt to repository conventions)

## DI token and provider
```ts
export const CUSTOMER_REPOSITORY = Symbol('CUSTOMER_REPOSITORY');

export interface CustomerRepository {
  findByIdForTenant(tenantId: string, customerId: string): Promise<Customer | null>;
}

@Injectable()
export class FindCustomerService {
  constructor(@Inject(CUSTOMER_REPOSITORY) private readonly customers: CustomerRepository) {}

  async execute(tenantId: string, customerId: string) {
    const customer = await this.customers.findByIdForTenant(tenantId, customerId);
    if (!customer) throw new NotFoundException('CUSTOMER_NOT_FOUND');
    return customer;
  }
}

@Module({
  providers: [
    FindCustomerService,
    { provide: CUSTOMER_REPOSITORY, useClass: PrismaCustomerRepository },
  ],
  exports: [FindCustomerService],
})
export class CustomersModule {}
```

This illustrates the *direction* of dependencies; reuse the project's real interface, token, constructor and module patterns.

## Cross-module use case
```text
CreateBranchService
  → TenantAccessService.assertBusinessAccess(tenantId)
  → EntitlementService.assertWithinLimit(tenantId, BRANCHES)
  → BranchRepository.createScoped(tenantId, payload)
```

The entitlement check by itself may race under concurrent requests. When a hard maximum must never be exceeded, serialize/reserve quota or check-and-write atomically within the correct transaction/locking strategy. Consult Prisma and security skills.

## Anti-patterns
```ts
// Do not do this in a controller:
await prisma.customer.findUnique({ where: { id: params.id } });

// Do not inspect commercial plans in the licence domain:
if (tenant.plan.name === 'PRO') { /* ... */ }
```
