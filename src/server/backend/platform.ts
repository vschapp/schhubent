// @ts-nocheck -- imported School Hub source, kept as-is
import { db, error, isAppDatabaseError, json, requireAuth, router } from '@/server/appdeploy-sdk';

type ConfigDefinition = {
  key: string;
  label: string;
  category: string;
  valueType: 'string' | 'number' | 'boolean' | 'object';
  description: string;
  defaultValue: unknown;
};

const CONFIG_DEFINITIONS: ConfigDefinition[] = [
  { key: 'school.timezone', label: 'School time zone', category: 'Organisation', valueType: 'string', description: 'Authoritative time zone used by school calendars, attendance and scheduled operations.', defaultValue: 'Africa/Accra' },
  { key: 'school.locale', label: 'School locale', category: 'Organisation', valueType: 'string', description: 'Locale used for dates, numbers and user-facing formatting.', defaultValue: 'en-GH' },
  { key: 'finance.currency', label: 'Financial currency', category: 'Finance', valueType: 'string', description: 'Base currency for school financial records and reports.', defaultValue: 'GHS' },
  { key: 'finance.receiptPrefix', label: 'Receipt number prefix', category: 'Finance', valueType: 'string', description: 'Central prefix used by the receipt-numbering service.', defaultValue: 'RCPT' },
  { key: 'finance.allowPartialPayments', label: 'Allow partial payments', category: 'Finance', valueType: 'boolean', description: 'Whether the receivables service may allocate payments below an invoice balance.', defaultValue: true },
  { key: 'academic.currentYearId', label: 'Current academic year', category: 'Academics', valueType: 'string', description: 'Authoritative academic year selection, resolved through the school academic registry.', defaultValue: '' },
  { key: 'academic.termStructure', label: 'Term structure', category: 'Academics', valueType: 'object', description: 'School-defined academic term structure consumed by academic workflows.', defaultValue: { terms: [] } },
  { key: 'attendance.mode', label: 'Attendance mode', category: 'Academics', valueType: 'string', description: 'Attendance mode consumed by attendance registers and reports.', defaultValue: 'daily' },
  { key: 'assessment.gradingScaleId', label: 'Active grading scale', category: 'Assessment', valueType: 'string', description: 'Legacy tenant-wide grading scale selection retained for backward compatibility.', defaultValue: '' },
  { key: 'assessment.gradingScaleBySchool', label: 'Active grading scale by school', category: 'Assessment', valueType: 'object', description: 'Central mapping from each school registry ID to its active grading scale registry ID. The workspace presents names while the platform stores validated references.', defaultValue: {} },
  { key: 'assessment.weightingPolicy', label: 'Assessment and examination weighting policy', category: 'Assessment', valueType: 'object', description: 'Central policy for combining moderated assessment and examination components. recorded_weights preserves existing component weighting; category_weighted applies the configured category percentages.', defaultValue: { mode: 'recorded_weights', assessmentWeight: 70, examinationWeight: 30 } },
  { key: 'attendance.maxBackdateDays', label: 'Maximum attendance backdating window', category: 'Academics', valueType: 'number', description: 'Maximum number of calendar days in the past that attendance sessions may be created. Existing behaviour is preserved by the 3650-day default.', defaultValue: 3650 },
  { key: 'security.requireMfa', label: 'Require multi-factor authentication', category: 'Security', valueType: 'boolean', description: 'Policy intent only. Enabling enforcement is blocked until the connected identity provider exposes verifiable MFA assurance.', defaultValue: false },
  { key: 'integrations.sms', label: 'SMS integration settings', category: 'Integrations', valueType: 'object', description: 'Provider-neutral SMS integration configuration; credentials belong in secrets.', defaultValue: { enabled: false, provider: '' } },
  { key: 'organisation.schoolType', label: 'School type', category: 'Organisation', valueType: 'string', description: 'School classification used by local operating workflows; values require tenant validation.', defaultValue: 'secondary' },
  { key: 'organisation.educationalLevels', label: 'Educational levels', category: 'Organisation', valueType: 'object', description: 'Configured educational levels and labels for the organisation.', defaultValue: { levels: ['basic', 'secondary', 'tertiary'] } },
  { key: 'organisation.branding', label: 'Organisation branding', category: 'Organisation', valueType: 'object', description: 'Approved organisation name, logo reference and brand colours; binary assets belong in storage.', defaultValue: { displayName: '', logoRef: '', primaryColor: '', secondaryColor: '' } },
  { key: 'academic.calendar', label: 'Academic calendar rules', category: 'Academics', valueType: 'object', description: 'Academic calendar settings and local school-day conventions.', defaultValue: { weekStartsOn: 'monday', schoolDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] } },
  { key: 'academic.promotion', label: 'Promotion rules', category: 'Academics', valueType: 'object', description: 'Promotion criteria references; domain services remain responsible for decisions.', defaultValue: { policyRef: '' } },
  { key: 'attendance.correctionApproval', label: 'Attendance correction approval', category: 'Academics', valueType: 'boolean', description: 'Require an approval workflow for attendance corrections.', defaultValue: true },
  { key: 'admissions.applicationPrefix', label: 'Admissions application prefix', category: 'Admissions', valueType: 'string', description: 'Prefix used by the admissions identifier service.', defaultValue: 'APP' },
  { key: 'admissions.documentChecklist', label: 'Admissions document checklist', category: 'Admissions', valueType: 'object', description: 'Required document categories for admission review.', defaultValue: { required: [] } },
  { key: 'assessment.resultPublicationRequiresApproval', label: 'Require result publication approval', category: 'Assessment', valueType: 'boolean', description: 'Require an authorised workflow before results become visible.', defaultValue: true },
  { key: 'finance.tax', label: 'Finance tax settings', category: 'Finance', valueType: 'object', description: 'Tax configuration references and inclusive/exclusive display preference.', defaultValue: { registrationNumber: '', mode: 'exclusive', taxCodeRef: '' } },
  { key: 'finance.invoicePrefix', label: 'Invoice number prefix', category: 'Finance', valueType: 'string', description: 'Central prefix used by invoice numbering.', defaultValue: 'INV' },
  { key: 'finance.paymentApprovalThreshold', label: 'Payment approval threshold', category: 'Finance', valueType: 'number', description: 'Amount above which a payment or refund must enter an approval workflow, in base currency.', defaultValue: 0 },
  { key: 'finance.budgetPeriod', label: 'Budget period', category: 'Finance', valueType: 'string', description: 'Default financial budget period.', defaultValue: 'annual' },
  { key: 'hr.leaveYearStart', label: 'HR leave-year start', category: 'HR', valueType: 'string', description: 'Month-day boundary for staff leave-year calculations.', defaultValue: '01-01' },
  { key: 'hr.staffNumberPrefix', label: 'Staff number prefix', category: 'HR', valueType: 'string', description: 'Prefix used by the staff identifier service.', defaultValue: 'STF' },
  { key: 'hr.payrollApprovalRequired', label: 'Require payroll approval', category: 'HR', valueType: 'boolean', description: 'Require maker-checker approval before payroll release.', defaultValue: true },
  { key: 'workflow.defaultApprovalHours', label: 'Default approval deadline', category: 'Workflows', valueType: 'number', description: 'Default approval step deadline in hours.', defaultValue: 48 },
  { key: 'workflow.escalationHours', label: 'Approval escalation threshold', category: 'Workflows', valueType: 'number', description: 'Elapsed hours before an overdue approval is eligible for escalation.', defaultValue: 72 },
  { key: 'workflow.requireEvidence', label: 'Require workflow evidence', category: 'Workflows', valueType: 'boolean', description: 'Require evidence references for configured sensitive approval workflows.', defaultValue: false },
  { key: 'security.sessionPolicy', label: 'Session policy', category: 'Security', valueType: 'object', description: 'Application session policy metadata; token enforcement remains with the identity provider.', defaultValue: { idleMinutes: 30, absoluteHours: 12 } },
  { key: 'security.dataClassification', label: 'Data classification policy', category: 'Security', valueType: 'object', description: 'Tenant data classification labels and handling guidance.', defaultValue: { labels: ['public', 'internal', 'confidential', 'restricted'] } },
  { key: 'communications.preferences', label: 'Communication preferences', category: 'Integrations', valueType: 'object', description: 'Default consent-aware channel preferences; provider credentials remain in secrets.', defaultValue: { smsEnabled: false, emailEnabled: false, pushEnabled: false } },
  { key: 'integrations.webhooks', label: 'Webhook integration policy', category: 'Integrations', valueType: 'object', description: 'Provider-neutral webhook allowlist and retry policy; signing secrets remain in secrets.', defaultValue: { enabled: false, endpoints: [], maxAttempts: 5 } },
  { key: 'reporting.retentionDays', label: 'Report retention days', category: 'Reporting', valueType: 'number', description: 'Default retention window for generated reports.', defaultValue: 90 },
  { key: 'operations.backupPolicy', label: 'Backup policy reference', category: 'Operations', valueType: 'object', description: 'Backup frequency and retention requirements; actual backups are platform-operated.', defaultValue: { frequency: 'daily', retentionDays: 30 } },
 ];

const DOMAIN_CONTRACTS = [
  { name: 'tenant-context.v1', owner: 'platform', purpose: 'Resolve authenticated user membership and authorised tenant/school scope.' },
  { name: 'configuration.v1', owner: 'platform', purpose: 'Read and version centrally governed settings; publish configuration.changed events.' },
  { name: 'authorization.v1', owner: 'platform', purpose: 'Evaluate RBAC role grants and ABAC conditions with deny-by-default semantics.' },
  { name: 'domain-event.v1', owner: 'integration-layer', purpose: 'Publish tenant-scoped, schema-versioned domain events for downstream consumers.' },
  { name: 'audit-event.v1', owner: 'governance', purpose: 'Append actor-attributed audit records for privileged configuration and policy changes.' },
];

function safePart(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, '_');
}
export function tenantTable(base: string, tenantId: string) {
  return base + '_' + safePart(tenantId);
}
export function userTenantTable(userId: string) {
  return 'user_tenants_' + safePart(userId);
}
function configId(key: string) {
  return safePart(key);
}
export function policyId(role: string, resource: string, action: string) {
  return [safePart(role), safePart(resource), safePart(action)].join('_');
}
export function isValidRecordId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{2,100}$/.test(value);
}

/** Shared guard for non-null, non-array JSON objects accepted at API boundaries. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Shared safe error boundary for route handlers. Known database errors are mapped only when a route supplies an established contract; all other failures stay generic. */
export function apiFailure(
  cause: unknown,
  fallbackMessage: string,
  options: {
    logLabel?: string;
    databaseErrors?: Record<string, { status: number; message: string }>;
  } = {},
) {
  if (options.logLabel) console.error(options.logLabel, cause);
  if (isAppDatabaseError(cause)) {
    const mapped = options.databaseErrors?.[cause.code];
    if (mapped) return error(mapped.message, mapped.status);
  }
  return error(fallbackMessage, 500);
}

export function auditRecord(tenantId: string, actorId: string, action: string, resource: string, details: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    tenantId,
    actorId,
    action,
    resource,
    details,
    occurredAt: new Date().toISOString(),
    schemaVersion: 1,
  };
}
export function domainEvent(
  tenantId: string,
  actorId: string,
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  payload: Record<string, unknown>,
  eventId: string = crypto.randomUUID(),
  occurredAt: string = new Date().toISOString(),
) {
  return {
    id: eventId,
    tenantId,
    actorId,
    eventType,
    aggregateType,
    aggregateId,
    payload,
    schemaVersion: 1,
    occurredAt,
    deliveryStatus: 'pending',
  };
}

export async function tenantContext(tenantId: string, userId: string) {
  if (!tenantId || tenantId.length > 128) return null;
  const [membership] = await db.get<Record<string, any>>(tenantTable('tenant_memberships', tenantId), [userId], { consistent: true });
  if (!membership || membership.tenantId !== tenantId || membership.userId !== userId || membership.status !== 'active') return null;
  return membership;
}

type TenantMembershipAccessResult =
  | { ok: false; response: ReturnType<typeof error>; membership?: never }
  | { ok: true; response: null; membership: Record<string, any> };

/** Resolve the existing active tenant membership and preserve each route's public denial contract. */
export async function tenantMembershipAccess(
  tenantId: string,
  userId: string,
  message = 'Tenant membership not found or access denied',
  status = 403,
): Promise<TenantMembershipAccessResult> {
  const membership = await tenantContext(tenantId, userId);
  if (!membership) return { ok: false, response: error(message, status) };
  return { ok: true, response: null, membership };
}

/** Preserve each route's existing query-first tenant ID contract in one place. */
export function tenantIdFromRequest(ctx: any, allowBodyFallback = true): string {
  return String(ctx?.query?.tenantId || (allowBodyFallback ? ctx?.body?.tenantId : '') || '');
}

type TenantRequestAccessOptions = {
  allowBodyFallback?: boolean;
  requireTenantId?: boolean;
  maxTenantLength?: number;
  invalidTenantMessage?: string;
  invalidTenantStatus?: number;
  membershipMessage?: string;
  membershipStatus?: number;
};

type TenantRequestAccessResult =
  | { ok: false; response: ReturnType<typeof error>; tenantId?: never; membership?: never }
  | { ok: true; response: null; tenantId: string; membership: Record<string, any> };

/**
 * Shared request-to-membership resolver. Route options preserve established
 * query/body precedence, input errors and membership-denial responses.
 */
export async function tenantAccessFromRequest(
  ctx: any,
  options: TenantRequestAccessOptions = {},
): Promise<TenantRequestAccessResult> {
  const tenantId = tenantIdFromRequest(ctx, options.allowBodyFallback ?? true);
  if (options.requireTenantId && (!tenantId || (options.maxTenantLength !== undefined && tenantId.length > options.maxTenantLength))) {
    return {
      ok: false,
      response: error(options.invalidTenantMessage || 'Tenant ID is required', options.invalidTenantStatus ?? 400),
    };
  }
  const access = await tenantMembershipAccess(
    tenantId,
    String(ctx?.user?.userId || ''),
    options.membershipMessage,
    options.membershipStatus,
  );
  if (!access.ok) return access;
  return { ok: true, response: null, tenantId, membership: access.membership };
}

/** One authoritative predicate for the tenant-wide administrator flag. */
export function isTenantSuperAdmin(membership: Record<string, any>): boolean {
  return membership.isTenantSuperAdmin === true;
}

/** Shared school-scope predicate for server-resolved membership and record context. */
export function hasSchoolScope(membership: Record<string, any>, schoolId: unknown): boolean {
  if (isTenantSuperAdmin(membership)) return true;
  if (typeof schoolId !== 'string' || !schoolId) return false;
  const allowedSchools = Array.isArray(membership.schoolIds) ? membership.schoolIds : [];
  if (allowedSchools.includes('*') || allowedSchools.includes(schoolId)) return true;
  const delegations = Array.isArray(membership.delegations) ? membership.delegations : [];
  return delegations.some((grant: any) => Array.isArray(grant.schoolIds) && grant.schoolIds.includes(schoolId) && typeof grant.expiresAt === 'string' && Date.parse(grant.expiresAt) > Date.now());
}

function conditionsMatch(conditions: Record<string, any> | undefined, context: Record<string, any>) {
  if (!conditions) return true;
  const dimensions: Record<string, string> = { schoolId: 'schoolIds', classId: 'classIds', subjectId: 'subjectIds', academicYearId: 'academicYearIds', termId: 'termIds' };
  for (const [contextKey, conditionKey] of Object.entries(dimensions)) {
    const allowed = conditions[conditionKey];
    if (Array.isArray(allowed) && !allowed.includes('*') && (!context[contextKey] || !allowed.includes(context[contextKey]))) return false;
  }
  if (conditions.ownerOnly === true && (!context.recordOwnerId || context.recordOwnerId !== context.userId)) return false;
  if (conditions.attributes && typeof conditions.attributes === 'object') {
    for (const [key, expected] of Object.entries(conditions.attributes)) if (context.attributes?.[key] !== expected) return false;
  }
  return true;
}

async function hasTeachingResponsibility(tenantId: string, membership: Record<string, any>, context: Record<string, any>) {
  if (!context.classId || !context.schoolId || !context.academicYearId) return false;
  const { items } = await db.list<Record<string, any>>(tenantTable('teaching_assignments', tenantId), { limit: 200 });
  return items.some(item => item.tenantId === tenantId && item.teacherUserId === membership.userId && item.status === 'active' && item.schoolId === context.schoolId && item.classId === context.classId && item.academicYearId === context.academicYearId && (!context.subjectId || item.subjectId === context.subjectId) && (!context.termId || !item.termId || item.termId === context.termId));
}

export async function authorize(tenantId: string, membership: Record<string, any>, resource: string, action: string, context: Record<string, any> = {}) {
  if (isTenantSuperAdmin(membership)) return true;
  const roles = [...new Set([...(Array.isArray(membership.roles) ? membership.roles : []), ...(membership.role ? [membership.role] : [])].map(String).filter(Boolean))];
  const table = tenantTable('authorization_policies', tenantId);
  const candidates = roles.flatMap(role => [policyId(role, resource, action), policyId(role, resource, '*'), policyId(role, '*', action), policyId(role, '*', '*')]);
  const policies = candidates.length ? await db.get<Record<string, any>>(table, [...new Set(candidates)], { consistent: true }) : [];
  const usable = policies.filter((policy): policy is Record<string, any> => Boolean(policy && policy.tenantId === tenantId && roles.includes(policy.role) && conditionsMatch(policy.conditions, { ...context, userId: membership.userId })));
  if (usable.some(policy => policy.effect === 'deny')) return false;
  for (const policy of usable.filter(item => item.effect === 'allow')) {
    if (policy.conditions?.requireTeachingAssignment === true && !(await hasTeachingResponsibility(tenantId, membership, context))) continue;
    return true;
  }
  const delegations = Array.isArray(membership.delegations) ? membership.delegations : [];
  return Boolean(context.schoolId && delegations.some((grant: any) => Array.isArray(grant.resources) && grant.resources.includes(resource) && Array.isArray(grant.actions) && grant.actions.includes(action) && Array.isArray(grant.schoolIds) && grant.schoolIds.includes(context.schoolId) && typeof grant.expiresAt === 'string' && Date.parse(grant.expiresAt) > Date.now()));
}

// Call only after loading the target record through a tenant-scoped query; never trust
// client-supplied school/class/student attributes as the ABAC record context.
export async function authorizeRecord(tenantId: string, membership: Record<string, any>, resource: string, action: string, record: Record<string, any>) {
  // Fail closed before evaluating a role grant: record ownership and school scope
  // must come from the server-loaded record, never from request-body attributes.
  if (!tenantId || membership.tenantId !== tenantId || !record || record.tenantId !== tenantId) return false;
  if (!hasSchoolScope(membership, record.schoolId)) return false;
  return authorize(tenantId, membership, resource, action, {
    schoolId: record.schoolId,
    classId: record.classId,
    subjectId: record.subjectId,
    academicYearId: record.academicYearId,
    termId: record.termId,
    recordOwnerId: record.ownerUserId,
    attributes: record.attributes || {},
  });
}

function validValue(definition: ConfigDefinition, value: unknown) {
  if (definition.valueType === 'string') return typeof value === 'string' && value.length <= 4000;
  if (definition.valueType === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (definition.valueType === 'boolean') return typeof value === 'boolean';
  if (definition.valueType === 'object') return isRecord(value) && JSON.stringify(value).length <= 16000;
  return false;
}

async function requireTenant(ctx: any) {
  const access = await tenantAccessFromRequest(ctx);
  if (!access.ok) return { response: access.response };
  return { tenantId: access.tenantId, membership: access.membership, response: null };
}

const routes = {
  'GET /api/platform/me': [
    requireAuth(),
    async (ctx: any) => json({ userId: ctx.user.userId, email: ctx.user.email || null, name: ctx.user.name || null }),
  ],
  'GET /api/platform/contracts': [
    requireAuth(),
    async () => json({ contracts: DOMAIN_CONTRACTS, configurationDefinitions: CONFIG_DEFINITIONS }),
  ],
  'GET /api/platform/tenants': [
    requireAuth(),
    async (ctx: any) => {
      const { items } = await db.list<Record<string, any>>(userTenantTable(ctx.user.userId), { limit: 100 });
      const tenantIds = items.map(item => item.tenantId || item.id).filter((id): id is string => typeof id === 'string');
      const tenants = await db.get<Record<string, any>>('tenants', tenantIds, { consistent: true });
      return json({ items: items.map((membership, index) => ({ tenantId: membership.tenantId || membership.id, role: membership.role, roles: membership.roles || [], isTenantSuperAdmin: membership.isTenantSuperAdmin === true, schoolIds: membership.schoolIds || [], name: tenants[index]?.name || 'School workspace' })).filter((item, index) => Boolean(item.tenantId) && items[index].status === 'active') });
    },
  ],
  'POST /api/platform/tenants': [
    requireAuth(),
    async (ctx: any) => {
      const body = (ctx.body || {}) as Record<string, unknown>;
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (name.length < 2 || name.length > 120) return error('Enter a school or organisation name between 2 and 120 characters', 400);
      const tenantId = crypto.randomUUID();
      const userId = ctx.user.userId;
      const createdAt = new Date().toISOString();
      const superAdminMembership = { id: userId, tenantId, userId, roles: [], role: null, schoolIds: ['*'], status: 'active', isTenantSuperAdmin: true, createdAt };
      const configRecords = CONFIG_DEFINITIONS.map(definition => ({
        id: configId(definition.key),
        tenantId,
        key: definition.key,
        category: definition.category,
        value: definition.defaultValue,
        version: 1,
        updatedAt: createdAt,
        updatedBy: userId,
      }));
      const configHistoryRecords = CONFIG_DEFINITIONS.map(definition => ({ id: crypto.randomUUID(), tenantId, key: definition.key, previousValue: null, value: definition.defaultValue, previousVersion: null, version: 1, changedAt: createdAt, changedBy: userId }));
      const operations = [
        db.tx.add('tenants', [{ id: tenantId, name, status: 'active', createdAt, createdBy: userId }]),
        db.tx.add(tenantTable('tenant_memberships', tenantId), [superAdminMembership]),
        db.tx.add(userTenantTable(userId), [{ id: tenantId, tenantId, role: null, roles: [], schoolIds: ['*'], status: 'active', isTenantSuperAdmin: true, createdAt }]),
        db.tx.add(tenantTable('platform_configurations', tenantId), configRecords),
        db.tx.add(tenantTable('configuration_history', tenantId), configHistoryRecords),
        db.tx.add(tenantTable('organisation_nodes', tenantId), [{ id: 'root', tenantId, type: 'organisation', name, parentId: null, schoolId: null, code: '', metadata: {}, status: 'active', version: 1, createdAt, createdBy: userId, updatedAt: createdAt, updatedBy: userId }]),
        db.tx.add(tenantTable('audit_events', tenantId), [auditRecord(tenantId, userId, 'tenant.created', 'tenant', { name })]),
        db.tx.add(tenantTable('domain_events', tenantId), [domainEvent(tenantId, userId, 'tenant.created', 'tenant', tenantId, { name })]),
      ];
      await db.transact(operations);
      return json({ tenantId, name, isTenantSuperAdmin: true }, 201);
    },
  ],
  'GET /api/platform/configuration': [
    requireAuth(),
    async (ctx: any) => {
      const access = await requireTenant(ctx);
      if (access.response !== null) return access.response;
      if (!(await authorize(access.tenantId!, access.membership!, 'configuration', 'read'))) return error('Permission denied', 403);
      const table = tenantTable('platform_configurations', access.tenantId!);
      const ids = CONFIG_DEFINITIONS.map(definition => configId(definition.key));
      const records = await db.get<Record<string, any>>(table, ids, { consistent: true });
      const missing = CONFIG_DEFINITIONS.filter((definition, index) => !records[index]).map(definition => ({ id: configId(definition.key), tenantId: access.tenantId, key: definition.key, category: definition.category, value: definition.defaultValue, version: 1, updatedAt: new Date().toISOString(), updatedBy: 'system-default' }));
      if (missing.length) await Promise.all(missing.map(record => db.tx.add(table, [record])));
      const complete = await db.get<Record<string, any>>(table, ids, { consistent: true });
      return json({ definitions: CONFIG_DEFINITIONS, settings: complete.filter(Boolean) });
    },
  ],
  'PUT /api/platform/configuration/:key': [
    requireAuth(),
    async (ctx: any) => {
      const access = await requireTenant(ctx);
      if (access.response !== null) return access.response;
      const key = ctx.params.key;
      const definition = CONFIG_DEFINITIONS.find(item => item.key === key);
      if (!definition) return error('Configuration key is not registered in the central configuration contract', 404);
      if (!(await authorize(access.tenantId!, access.membership!, 'configuration', 'update'))) return error('Permission denied', 403);
      const body = (ctx.body || {}) as Record<string, any>;
      if (!validValue(definition, body.value)) return error('Configuration value does not match the registered type or size limit', 400);
      if (key === 'assessment.gradingScaleBySchool') {
        const mapping = body.value as Record<string, unknown>;
        if (!isRecord(mapping) || Object.entries(mapping).some(([schoolId, scaleId]) => !isValidRecordId(schoolId) || !isValidRecordId(scaleId))) return error('Grading-scale mapping must contain valid school and grading-scale registry references.', 400);
      }
      if (key === 'assessment.weightingPolicy') {
        const policy = body.value as Record<string, any>;
        if (!isRecord(policy) || !['recorded_weights', 'category_weighted'].includes(String(policy.mode)) ||
          !Number.isFinite(policy.assessmentWeight) || policy.assessmentWeight < 0 || policy.assessmentWeight > 100 ||
          !Number.isFinite(policy.examinationWeight) || policy.examinationWeight < 0 || policy.examinationWeight > 100 ||
          (policy.mode === 'category_weighted' && Math.abs(policy.assessmentWeight + policy.examinationWeight - 100) > 0.0001)) {
          return error('Weighting policy must use recorded_weights or category_weighted. Category weights must each be 0–100 and total 100.', 400);
        }
      }
      if (key === 'attendance.maxBackdateDays' && (!Number.isInteger(body.value) || body.value < 0 || body.value > 3650)) return error('Attendance backdating must be an integer from 0 to 3650 days.', 400);
      if (key === 'security.requireMfa' && body.value === true) return error('MFA is not enforceable by the currently connected AppDeploy identity provider. Connect an MFA-capable identity provider before enabling this policy.', 409);
      const table = tenantTable('platform_configurations', access.tenantId!);
      const id = configId(key);
      const [current] = await db.get<Record<string, any>>(table, [id], { consistent: true });
      if (!current) return error('Configuration record is missing; contact the platform administrator', 409);
      if (body.expectedVersion !== current.version) return error('Configuration changed since it was loaded. Refresh before saving.', 409);
      const nextVersion = Number(current.version) + 1;
      const updatedAt = new Date().toISOString();
      const updated = db.tx.update(table, [{ id, if: { version: current.version }, record: { ...current, value: body.value, version: nextVersion, updatedAt, updatedBy: ctx.user.userId } }]);
      const history = db.tx.add(tenantTable('configuration_history', access.tenantId!), [{ id: crypto.randomUUID(), tenantId: access.tenantId, key, previousValue: current.value, value: body.value, previousVersion: current.version, version: nextVersion, changedAt: updatedAt, changedBy: ctx.user.userId }]);
      const audit = db.tx.add(tenantTable('audit_events', access.tenantId!), [auditRecord(access.tenantId!, ctx.user.userId, 'configuration.updated', key, { previousVersion: current.version, nextVersion })]);
      const event = db.tx.add(tenantTable('domain_events', access.tenantId!), [domainEvent(access.tenantId!, ctx.user.userId, 'configuration.changed', 'configuration', key, { key, value: body.value, version: nextVersion })]);
      try {
        await db.transact([updated, history, audit, event]);
      } catch (cause: unknown) {
        if (isAppDatabaseError(cause)) {
          if (cause.code === 'AppDatabaseConflict' || cause.code === 'AppDatabaseConditionFailed' || cause.code === 'AppDatabaseDuplicateId') {
            return error('Configuration update conflicted with another change. Reload and retry.', 409);
          }
          if (cause.code === 'AppDatabaseQuotaExceeded') return error('Configuration storage quota has been reached. Contact the platform administrator.', 429);
        }
        console.error('configuration update failed', cause);
        return error('Configuration update could not be completed.', 500);
      }
      return json({ key, value: body.value, version: nextVersion, updatedAt });
    },
  ],
  'GET /api/platform/configuration/:key/history': [
    requireAuth(),
    async (ctx: any) => {
      const access = await requireTenant(ctx);
      if (access.response !== null) return access.response;
      if (!(await authorize(access.tenantId!, access.membership!, 'configuration', 'read'))) return error('Permission denied', 403);
      const key = String(ctx.params.key || '');
      if (!CONFIG_DEFINITIONS.some(item => item.key === key)) return error('Configuration key is not registered', 404);
      const { items } = await db.list<Record<string, any>>(tenantTable('configuration_history', access.tenantId!), { limit: 100 });
      return json({ items: items.filter(item => item.tenantId === access.tenantId && item.key === key).sort((left, right) => Number(right.version) - Number(left.version)) });
    },
  ],
  'GET /api/platform/policies': [
    requireAuth(),
    async (ctx: any) => {
      const access = await requireTenant(ctx);
      if (access.response !== null) return access.response;
      if (!(await authorize(access.tenantId!, access.membership!, 'authorization', 'read'))) return error('Permission denied', 403);
      const { items } = await db.list<Record<string, any>>(tenantTable('authorization_policies', access.tenantId!), { limit: 200 });
      return json({ items });
    },
  ],
  'PUT /api/platform/policies': [
    requireAuth(),
    async (ctx: any) => {
      const access = await requireTenant(ctx);
      if (access.response !== null) return access.response;
      if (!(await authorize(access.tenantId!, access.membership!, 'authorization', 'manage'))) return error('Permission denied', 403);
      const body = (ctx.body || {}) as Record<string, any>;
      const role = typeof body.role === 'string' ? body.role.trim() : '';
      const resource = typeof body.resource === 'string' ? body.resource.trim() : '';
      const action = typeof body.action === 'string' ? body.action.trim() : '';
      const effect = body.effect;
      if (!role || !resource || !action || !['allow', 'deny'].includes(effect)) return error('Role, resource, action and allow/deny effect are required', 400);
      if (role.length > 80 || resource.length > 100 || action.length > 80) return error('Policy fields exceed supported limits', 400);
      const table = tenantTable('authorization_policies', access.tenantId!);
      const id = policyId(role, resource, action);
      const record = { id, tenantId: access.tenantId, role, resource, action, effect, conditions: body.conditions || {}, version: Number(body.version || 1), updatedBy: ctx.user.userId, updatedAt: new Date().toISOString() };
      const write = db.tx.update(table, [{ id, record }]);
      const audit = db.tx.add(tenantTable('audit_events', access.tenantId!), [auditRecord(access.tenantId!, ctx.user.userId, 'authorization.policy.updated', id, { role, resource, action, effect })]);
      await db.transact([write, audit]);
      return json({ policy: record });
    },
  ],
  'POST /api/platform/memberships': [
    requireAuth(),
    async (ctx: any) => {
      const access = await requireTenant(ctx);
      if (access.response !== null) return access.response;
      if (!isTenantSuperAdmin(access.membership!)) return error('Only the tenant super administrator can update an existing membership', 403);
      const body = (ctx.body || {}) as Record<string, any>;
      if (Object.keys(body).some(key => !['tenantId', 'userId', 'role', 'schoolIds', 'expectedVersion'].includes(key))) return error('Unsupported membership fields', 400);
      if (typeof body.userId !== 'string' || body.userId.length < 8 || body.userId.length > 128 || typeof body.role !== 'string' || body.role.length < 1 || body.role.length > 80) return error('A valid user ID and existing role ID are required', 400);
      const [current] = await db.get<Record<string, any>>(tenantTable('tenant_memberships', access.tenantId!), [body.userId], { consistent: true });
      if (!current || current.tenantId !== access.tenantId || current.status !== 'active') return error('An existing active tenant membership is required; prepare an invitation before activation', 404);
      if (isTenantSuperAdmin(current)) return error('The tenant super-administrator membership cannot be changed through ordinary membership administration', 409);
      if (current.version !== undefined && body.expectedVersion !== current.version) return error('Membership changed; reload before saving', 409);
      const [role] = await db.get<Record<string, any>>(tenantTable('tenant_roles', access.tenantId!), [body.role], { consistent: true });
      if (!role || role.tenantId !== access.tenantId || role.status !== 'active') return error('Select an active role registered in this tenant', 400);
      const schoolIds = body.schoolIds === undefined ? (Array.isArray(current.schoolIds) ? current.schoolIds : []) : body.schoolIds;
      if (!Array.isArray(schoolIds) || schoolIds.length > 50 || new Set(schoolIds).size !== schoolIds.length || schoolIds.some((id: unknown) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{2,100}$/.test(id) || id === '*')) return error('School scope must contain unique, valid school IDs; wildcard scope is not allowed', 400);
      if (schoolIds.length) {
        const schools = await db.get<Record<string, any>>(tenantTable('schools', access.tenantId!), schoolIds, { consistent: true });
        if (schools.some(school => !school || school.tenantId !== access.tenantId || school.status !== 'active')) return error('Every selected school must be active and belong to this tenant', 400);
      }
      const [index] = await db.get<Record<string, any>>(userTenantTable(body.userId), [access.tenantId!], { consistent: true });
      if (!index || index.tenantId !== access.tenantId) return error('User-to-tenant membership index is missing; no changes were made', 409);
      const timestamp = new Date().toISOString();
      const roles = [body.role];
      const updated = { ...current, role: body.role, roles, schoolIds, version: Number(current.version || 1) + 1, updatedAt: timestamp, updatedBy: ctx.user.userId };
      const updatedIndex = { ...index, role: body.role, roles, schoolIds, status: current.status, updatedAt: timestamp };
      const condition = { status: current.status, ...(current.version !== undefined ? { version: current.version } : {}) };
      await db.transact([
        db.tx.update(tenantTable('tenant_memberships', access.tenantId!), [{ id: body.userId, if: condition, record: updated }]),
        db.tx.update(userTenantTable(body.userId), [{ id: access.tenantId!, if: { status: index.status }, record: updatedIndex }]),
        db.tx.add(tenantTable('audit_events', access.tenantId!), [auditRecord(access.tenantId!, ctx.user.userId, 'membership.updated', body.userId, { role: body.role, schoolIds, version: updated.version })]),
      ]);
      return json({ membership: updated });
    },
  ],
  'GET /api/platform/events': [
    requireAuth(),
    async (ctx: any) => {
      const access = await requireTenant(ctx);
      if (access.response !== null) return access.response;
      if (!(await authorize(access.tenantId!, access.membership!, 'domain-events', 'read'))) return error('Permission denied', 403);
      const { items } = await db.list<Record<string, any>>(tenantTable('domain_events', access.tenantId!), { limit: 100 });
      return json({ items });
    },
  ],
};

export const platformRoutes = routes;
