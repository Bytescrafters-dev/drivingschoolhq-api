-- Sessions of SELECTED users are revoked when their last ACTIVE branch closes.
ALTER TYPE "TenantSessionRevokedReason" ADD VALUE 'NO_ACTIVE_BRANCH';
