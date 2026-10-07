# Platform scenarios for implementation and tests

## Invoice overdue
```text
Tenant T, invoice I
  due 10 Oct
  grace ends 17 Oct
11 Oct: I has balance → tenant GRACE_PERIOD (if no stronger block)
17 Oct at configured boundary: I unpaid → tenant SUSPENDED
18 Oct: Admin records full payment → reevaluate all invoices + manual blocks
```
Do not use these dates as hardcoded production policy.

## Multiple blocking invoices
```text
August invoice: unpaid, beyond grace
September invoice: paid
Expected tenant access: SUSPENDED
```

## Manual suspension priority
```text
Tenant manual suspension ACTIVE
All tenant invoices PAID
Expected tenant access: SUSPENDED
```

## Mark-as-paid command
```text
Input: tenantId, invoiceId, amount, receivedAt, method, reference
Actor: authorized PlatformAdminUser
Effect: payment record + allocation + invoice reconciliation + access evaluation + audit
```

## Plan limit
```text
tenant has 5 active staff
plan max 5
two concurrent CREATE_STAFF requests
both must not succeed in creating staff beyond policy cap
```

## Changing plan
New plan/terms effective date must be explicit; historical issued invoices remain unchanged. Downgrade overage policy is separately defined from payment suspension.
