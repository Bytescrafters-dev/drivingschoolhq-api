import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error.js';
import { normalizeEmail } from '../../common/text/email.js';
import {
  normalizeNic,
  normalizeSriLankanPhone,
} from '../../common/text/sri-lanka.js';
import {
  TenantSessionRevokedReason,
  TenantUserStatus,
} from '../../generated/prisma/enums.js';
import { TenantSessionsService } from '../sessions/tenant-sessions.service.js';
import {
  TENANT_USER_REPOSITORY,
  type TenantOwnerProfileChange,
  type TenantUser,
  type TenantUserRepository,
} from './interfaces/tenant-user.repository.js';

export interface ProvisionTenantOwnerInput {
  tenantId: string;
  email: string;
  fullName: string;
  phone: string;
  nic: string;
  /** Already hashed by the caller (hashing stays outside transactions). */
  passwordHash: string;
  createdByPlatformAdminId: string;
}

export interface TenantOwnerProfileInput {
  fullName?: string;
  email?: string;
  phone?: string;
  nic?: string;
}

/**
 * Tenant OWNER provisioning and management. The OWNER is managed only by platform admins, so
 * this is the entry point the platform domain uses; tenant staff management
 * (later) must never create or modify the OWNER. Mutating methods expect the
 * caller's transaction to hold the tenant row lock; they lock the owner row.
 *
 * Password reset, disable and email change end the owner's sessions.
 */
@Injectable()
export class TenantOwnersService {
  constructor(
    @Inject(TENANT_USER_REPOSITORY)
    private readonly users: TenantUserRepository,
    private readonly sessions: TenantSessionsService,
  ) {}

  /** Creates the tenant's single OWNER with a temporary password. */
  provisionOwner(input: ProvisionTenantOwnerInput): Promise<TenantUser> {
    const phone = normalizeSriLankanPhone(input.phone);
    if (!phone) {
      throw new AppError(
        'BAD_REQUEST',
        'INVALID_PHONE',
        'Invalid phone number',
      );
    }
    const nic = normalizeNic(input.nic);
    if (!nic) {
      throw new AppError('BAD_REQUEST', 'INVALID_NIC', 'Invalid NIC number');
    }
    return this.users.createOwner({
      tenantId: input.tenantId,
      email: normalizeEmail(input.email),
      fullName: input.fullName.trim(),
      phone,
      nic,
      passwordHash: input.passwordHash,
      createdByPlatformAdminId: input.createdByPlatformAdminId,
    });
  }

  findOwner(tenantId: string): Promise<TenantUser | null> {
    return this.users.findOwner(tenantId);
  }

  /** Locks and returns the owner; TENANT_OWNER_NOT_FOUND if there is none. */
  async lockOwner(tenantId: string): Promise<TenantUser> {
    const owner = await this.users.lockOwner(tenantId);
    if (!owner) throw ownerNotFound();
    return owner;
  }

  /** Normalises and applies a profile change; returns the updated owner. */
  async updateProfile(
    owner: TenantUser,
    change: TenantOwnerProfileChange,
  ): Promise<TenantUser> {
    const updated = await this.users.updateOwnerProfile(owner.tenantId, change);
    if (updated.email !== owner.email) {
      // The login identifier changed: existing sessions must sign in again.
      await this.sessions.revokeAllForUser(
        owner.tenantId,
        owner.id,
        TenantSessionRevokedReason.EMAIL_CHANGED,
      );
    }
    return updated;
  }

  /** Sets a new temporary password the owner must change at next login. */
  async resetPassword(
    owner: TenantUser,
    passwordHash: string,
  ): Promise<TenantUser> {
    const updated = await this.users.setOwnerPassword(
      owner.tenantId,
      passwordHash,
    );
    await this.sessions.revokeAllForUser(
      owner.tenantId,
      owner.id,
      TenantSessionRevokedReason.PASSWORD_RESET,
    );
    return updated;
  }

  async disable(owner: TenantUser, at: Date): Promise<TenantUser> {
    if (owner.status === TenantUserStatus.DISABLED) {
      throw new AppError(
        'CONFLICT',
        'OWNER_ALREADY_DISABLED',
        'The tenant owner is already disabled',
      );
    }
    const updated = await this.users.disableOwner(owner.tenantId, at);
    await this.sessions.revokeAllForUser(
      owner.tenantId,
      owner.id,
      TenantSessionRevokedReason.USER_DISABLED,
    );
    return updated;
  }

  enable(owner: TenantUser): Promise<TenantUser> {
    if (owner.status === TenantUserStatus.ACTIVE) {
      throw new AppError(
        'CONFLICT',
        'OWNER_ALREADY_ACTIVE',
        'The tenant owner is already active',
      );
    }
    return this.users.enableOwner(owner.tenantId);
  }
}

/** Trims/normalises given fields; invalid phone or NIC → BAD_REQUEST. */
export function normalizeOwnerProfile(
  input: TenantOwnerProfileInput,
): TenantOwnerProfileChange {
  const change: TenantOwnerProfileChange = {};
  if (input.fullName !== undefined) change.fullName = input.fullName.trim();
  if (input.email !== undefined) change.email = normalizeEmail(input.email);
  if (input.phone !== undefined) {
    const phone = normalizeSriLankanPhone(input.phone);
    if (!phone) {
      throw new AppError(
        'BAD_REQUEST',
        'INVALID_PHONE',
        'Invalid phone number',
      );
    }
    change.phone = phone;
  }
  if (input.nic !== undefined) {
    const nic = normalizeNic(input.nic);
    if (!nic) {
      throw new AppError('BAD_REQUEST', 'INVALID_NIC', 'Invalid NIC number');
    }
    change.nic = nic;
  }
  return change;
}

function ownerNotFound(): AppError {
  return new AppError(
    'NOT_FOUND',
    'TENANT_OWNER_NOT_FOUND',
    'Tenant owner not found',
  );
}
