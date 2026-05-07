// --- User & Role Types ---

export interface User {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  can_checkout_quantifiable: boolean;
  created_at: Date;
}

export interface UserRole {
  user_id: string;
  role_id: string;
  assigned_at: Date;
  assigned_by: string | null;
}

export interface SafeUser {
  id: string;
  email: string;
  display_name: string;
  is_active: boolean;
  created_at: Date;
  roles: string[];
  can_checkout_quantifiable: boolean;
}

export interface UserRoleDetail {
  id: string;
  name: string;
  description: string | null;
}

export interface UserWithRoles {
  id: string;
  email: string;
  display_name: string;
  is_active: boolean;
  created_at: Date;
  roles: UserRoleDetail[];
  can_checkout_quantifiable: boolean;
}

export interface PaginatedUsers {
  users: UserWithRoles[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

// --- Document Types ---

export interface Folder {
  id: string;
  parent_id: string | null;
  name: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface Document {
  id: string;
  folder_id: string | null;
  name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  version: number;
  uploaded_by: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface DocumentVersion {
  id: string;
  document_id: string;
  version: number;
  storage_path: string;
  size_bytes: number;
  uploaded_by: string;
  created_at: Date;
}

export type PermissionLevel = 'viewer' | 'editor' | 'manager';

export interface DocumentPermission {
  id: string;
  document_id: string | null;
  folder_id: string | null;
  user_id: string | null;
  role_id: string | null;
  permission: PermissionLevel;
  inherit: boolean;
  granted_by: string;
  granted_at: Date;
  // JOINed from users/roles
  user_display_name?: string;
  user_email?: string;
  role_name?: string;
}

export interface DocumentActivityLog {
  id: string;
  document_id: string | null;
  folder_id: string | null;
  actor_id: string;
  action: string;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

// --- Inventory Types ---

export type ItemType = 'trackable' | 'quantifiable';
export type ItemStatus = 'active' | 'inactive' | 'maintenance';

export interface Item {
  id: string;
  item_type: ItemType;
  name: string;
  sku: string | null;
  category: string | null;
  description: string | null;
  status: ItemStatus;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface ItemLot {
  id: string;
  item_id: string;
  lot_code: string;
  quantity_total: number;
  quantity_on_hand: number;
  quantity_out: number;
  purchased_at: Date | null;
  expires_at: Date | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export type CheckoutStatus = 'pending_approval' | 'open' | 'partially_returned' | 'closed' | 'cancelled' | 'rejected';

export interface CheckoutTransaction {
  id: string;
  checked_out_by: string;
  checked_out_by_name?: string;
  processed_by: string | null;
  status: CheckoutStatus;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CheckoutTransactionItem {
  id: string;
  transaction_id: string;
  item_id: string;
  lot_id: string;
  quantity_out: number;
  quantity_returned: number;
  created_at: Date;
}

export interface ReturnTransaction {
  id: string;
  checkout_transaction_id: string;
  returned_by: string;
  processed_by: string | null;
  notes: string | null;
  created_at: Date;
}

export interface ReturnTransactionItem {
  id: string;
  return_transaction_id: string;
  checkout_item_id: string;
  quantity_returned: number;
  created_at: Date;
}

// --- API Types ---

export interface ApiError {
  error: string;
  code: string;
}

export interface AuthenticatedRequest extends Express.Request {
  user?: SafeUser;
}
