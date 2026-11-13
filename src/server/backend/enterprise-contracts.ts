// @ts-nocheck -- imported School Hub source, kept as-is
export const CRUD_PERMISSIONS = [
  { operation: 'View', action: 'read', meaning: 'Read authorised records' },
  { operation: 'Add', action: 'create', meaning: 'Create validated records' },
  { operation: 'Edit', action: 'update', meaning: 'Modify permitted fields' },
  { operation: 'Delete', action: 'delete', meaning: 'Remove, archive or soft-delete according to retention rules' },
] as const;

export const PAYMENT_ADAPTERS = [
  { provider: 'paystack', status: 'placeholder', requiredControls: ['server-side credentials', 'signed webhook verification', 'provider status lookup', 'idempotency', 'settlement reconciliation'] },
  { provider: 'hubtel', status: 'placeholder', requiredControls: ['merchant onboarding', 'server-side credentials', 'callback verification', 'provider status lookup', 'reconciliation'] },
  { provider: 'mtn-momo', status: 'placeholder', requiredControls: ['merchant onboarding', 'callback verification', 'transaction status lookup', 'idempotency', 'reconciliation'] },
] as const;

export const ENTERPRISE_CAPABILITIES = {
  serverFramework: { target: 'Java 21 + Spring Boot modular monolith', status: 'planned', note: 'AppDeploy currently runs its TypeScript serverless API; Spring Boot requires a separate runtime deployment.' },
  relationalDatabase: { target: 'PostgreSQL', status: 'schema-blueprint', note: 'DDL is supplied under database/postgresql; no relational database is connected yet.' },
  api: { target: 'Versioned REST + OpenAPI', status: 'contract-blueprint', note: 'Existing platform routes are live; domain routes are staged in the API roadmap.' },
  businessLogic: { target: 'Central domain/application services', status: 'foundation', note: 'New modules must consume shared services and configuration contracts.' },
  authorization: { target: 'Tenant-aware RBAC + ABAC', status: 'foundation', note: 'Default deny; scoped CRUD conditions and teaching-assignment checks are available to API handlers. PostgreSQL RLS is a migration blueprint and is not active until PostgreSQL is connected.' },
  payments: { target: 'Provider-neutral payment adapters', status: 'placeholder', note: 'No live provider credentials or payment processing are enabled.' },
} as const;
