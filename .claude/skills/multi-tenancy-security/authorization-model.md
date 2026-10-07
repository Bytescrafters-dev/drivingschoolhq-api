# Actor and authorization model

| Actor | Domain | Allowed scope | Authorization source |
| --- | --- | --- | --- |
| PlatformAdminUser | SaaS platform | explicit platform operations | platform roles and permissions |
| TenantUser | driving-school business | trusted tenant; optionally branch | tenant RBAC + entitlements + tenant access |
| Customer | business identity record | no implicit API access | customer portal auth only if built separately |
| Background worker | trusted system operation | explicit job scope, revalidated | system job policy + ownership checks |

## Entitlement vs permission vs tenant access
Three independent questions:
1. **Access**: is the tenant active/grace/suspended?
2. **Entitlement**: is the feature enabled or quota available?
3. **RBAC**: is this staff member allowed to perform the action?

All relevant checks must pass. Preventing a user from creating a branch should not depend on hidden frontend controls.

## Admin operations
Platform admin may suspend a tenant or record payment only with platform permissions and audit. Avoid implicit bypass paths in operational endpoints. An impersonation/support flow, if ever introduced, needs explicit scoped grants, traceability and revocation.

## Billing suspension policy
Recalculate effective access using billing state and active manual suspensions. Payment of one invoice must not override other overdue invoices or manual restrictions.
