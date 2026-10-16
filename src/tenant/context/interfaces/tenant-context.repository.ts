import type {
  TenantAccessStatus,
  TenantStatus,
} from '../../../generated/prisma/enums.js';

export const TENANT_CONTEXT_REPOSITORY = Symbol('TENANT_CONTEXT_REPOSITORY');

/**
 * The tenant as the driving-school domain sees it. Read-only: tenants are
 * created and changed by the platform domain only.
 */
export interface TenantContext {
  id: string;
  dsCode: string;
  displayName: string;
  status: TenantStatus;
  /** Null only if the access record is missing. */
  accessStatus: TenantAccessStatus | null;
}

export interface TenantContextRepository {
  findByDsCode(dsCode: string): Promise<TenantContext | null>;
  findById(id: string): Promise<TenantContext | null>;
}
