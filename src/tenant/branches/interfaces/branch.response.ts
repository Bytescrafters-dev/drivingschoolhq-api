import type {
  BranchStatus,
  District,
} from '../../../generated/prisma/enums.js';
import type { Branch } from './branch.repository.js';

export interface BranchResponse {
  id: string;
  name: string;
  address: string;
  district: District;
  phone: string;
  status: BranchStatus;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BranchListItemResponse extends BranchResponse {
  /** The branch the user starts in after login. */
  isDefault: boolean;
}

export function toBranchResponse(branch: Branch): BranchResponse {
  return {
    id: branch.id,
    name: branch.name,
    address: branch.address,
    district: branch.district,
    phone: branch.phone,
    status: branch.status,
    closedAt: branch.closedAt,
    createdAt: branch.createdAt,
    updatedAt: branch.updatedAt,
  };
}
