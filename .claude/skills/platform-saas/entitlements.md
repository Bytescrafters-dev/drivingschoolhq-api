# SaaS limits and feature entitlements

## Types
**Quota**: `STAFF_USERS`, `BRANCHES`, `INSTRUCTORS`, `VEHICLES`, `STORAGE_BYTES`, `ACTIVE_CUSTOMERS`.
**Feature**: `ADVANCED_REPORTING`, `SMS_NOTIFICATIONS`, `API_ACCESS`, `MULTI_BRANCH`.

Use stable feature/metric codes, not display names. Limits are policy values; choose a clear representation for unlimited, disabled and no override.

## Effective policy
```text
base plan/version → subscription's effective terms → tenant override (if active)
```
Plan catalogue edits must not retroactively mutate a tenant's agreed terms without an explicit plan-change policy.

## Enforcement
Operations that consume a quota must check capacity on the backend. RBAC permission is a separate requirement. To avoid concurrent requests exceeding hard caps, validate and reserve atomically (transaction, lock/counter or serializable retry), not just count before insert.

## Example
```text
Plan: max branches = 3
Tenant branches: 3
Actor has BRANCH_CREATE
Result: PLAN_LIMIT_REACHED (not success)
```

## Downgrade behavior
Default recommendation: preserve existing records, reject new over-limit creations, and show overage until usage is reduced. Do not randomly deactivate existing staff/branches on downgrade unless explicitly required and clearly communicated.

## Usage counting
Define what counts for each metric (ACTIVE users vs all invitations, soft-deleted branches vs all branches, storage after deletions). Use DB counts initially for bounded resources; use a metered aggregate only when performance or product semantics justify it.

## Tenant activation
Entitlement and access are different. A suspended tenant may own a Professional subscription yet be unable to use business features. A user may have RBAC permission and still fail a plan quota check.
