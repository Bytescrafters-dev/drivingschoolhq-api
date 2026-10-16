import type {
  BillingPeriod,
  District,
  TenantAccessStatus,
  TenantStatus,
} from '../../../generated/prisma/enums.js';

export const TENANT_REPOSITORY = Symbol('TENANT_REPOSITORY');

export interface Tenant {
  id: string;
  dsCode: string;
  name: string;
  displayName: string;
  address: string;
  district: District;
  phone: string;
  status: TenantStatus;
  closedAt: Date | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantAccess {
  status: TenantAccessStatus;
  statusChangedAt: Date;
}

export interface TenantListItem extends Tenant {
  accessStatus: TenantAccessStatus | null;
  currentPlan: { planName: string; billingPeriod: BillingPeriod } | null;
}

export interface NewTenant {
  dsCode: string;
  name: string;
  displayName: string;
  address: string;
  district: District;
  phone: string;
  createdById: string;
}

export interface TenantProfileChange {
  dsCode?: string;
  name?: string;
  displayName?: string;
  address?: string;
  district?: District;
  phone?: string;
}

export interface TenantListFilter {
  status?: TenantStatus;
  district?: District;
  accessStatus?: TenantAccessStatus;
  /** Case-insensitive match on DS code, name or display name. */
  search?: string;
}

export interface TenantRepository {
  /** Throws AppError TENANT_DS_CODE_TAKEN when the DS code is already used. */
  create(tenant: NewTenant): Promise<Tenant>;
  findById(id: string): Promise<Tenant | null>;
  /** SELECT ... FOR UPDATE; call inside a transaction. */
  lockById(id: string): Promise<Tenant | null>;
  list(
    filter: TenantListFilter,
    page: { skip: number; take: number },
  ): Promise<{ items: TenantListItem[]; total: number }>;
  /** Throws AppError TENANT_DS_CODE_TAKEN when the DS code is already used. */
  updateProfile(id: string, change: TenantProfileChange): Promise<Tenant>;
  setStatus(
    id: string,
    status: TenantStatus,
    closedAt: Date | null,
  ): Promise<Tenant>;

  createAccess(tenantId: string, at: Date): Promise<TenantAccess>;
  findAccess(tenantId: string): Promise<TenantAccess | null>;
  setAccessStatus(
    tenantId: string,
    status: TenantAccessStatus,
    at: Date,
  ): Promise<TenantAccess>;
}
