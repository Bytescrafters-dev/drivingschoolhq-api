# Multi-tenant security scenarios

## Bad
```ts
return this.prisma.customer.findUnique({ where: { id: customerId } });
```
Caller supplied `customerId` does not prove tenant ownership.

## Better contract
```ts
const actor = requestContext.requireTenantUser();
return customers.findByIdForTenant(actor.tenantId, customerId);
```
Use the actual application's request context and repository abstractions rather than copying this literally.

## Regression test table

| Request | Expectation |
| --- | --- |
| Tenant A reads customer from A | allowed with permission |
| Tenant A reads customer from B | denied without revealing B's data |
| Tenant A updates trial attempt from B | denied and unchanged |
| Tenant A creates training session using B instructor | denied |
| Tenant A passes B's branchId | denied |
| Platform billing admin attempts tenant operation | allowed only through explicitly authorized platform endpoint |
| Tenant suspended for billing | operations blocked, designated billing/support routes accessible |
| Tenant active but staff quota exceeded | new staff creation denied |
