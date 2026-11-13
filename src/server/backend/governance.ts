// @ts-nocheck -- imported School Hub source, kept as-is
import { db, error, json, requireAuth } from '@/server/appdeploy-sdk';
import {
  tenantAccessFromRequest,
  tenantTable,
  auditRecord,
  domainEvent,
  authorize,
  isTenantSuperAdmin,
  isRecord,
  userTenantTable,
} from './platform';

const now = () => new Date().toISOString();
const NODE_TYPES = ['organisation', 'school', 'educational_level', 'campus', 'branch', 'department', 'unit', 'location'] as const;
type NodeType = typeof NODE_TYPES[number];
const PARENT_TYPES: Record<NodeType, NodeType[]> = {
  organisation: [],
  school: ['organisation'],
  educational_level: ['organisation', 'school'],
  campus: ['organisation', 'school'],
  branch: ['organisation', 'school'],
  department: ['school', 'campus', 'branch'],
  unit: ['department'],
  location: ['organisation', 'school', 'campus', 'branch', 'department', 'unit'],
};
const nodeTable = (tenantId: string) => tenantTable('organisation_nodes', tenantId);
const workflowTable = (tenantId: string) => tenantTable('workflow_definitions', tenantId);
const instanceTable = (tenantId: string) => tenantTable('workflow_instances', tenantId);

async function access(ctx: any) {
  const result = await tenantAccessFromRequest(ctx, { requireTenantId: true, invalidTenantMessage: 'Tenant ID is required', invalidTenantStatus: 400 });
  if (!result.ok) return { response: result.response };
  return { tenantId: result.tenantId, membership: result.membership, response: null };
}
async function allowed(tenantId: string, membership: Record<string, any>, resource: string, action: string, context: Record<string, any> = {}) {
  return authorize(tenantId, membership, resource, action, context);
}
function validText(value: unknown, max = 160): value is string {
  return typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= max;
}
async function loadNode(tenantId: string, id: string) {
  const [node] = await db.get<Record<string, any>>(nodeTable(tenantId), [id], { consistent: true });
  return node && node.tenantId === tenantId && node.status === 'active' ? node : null;
}
async function validateParent(tenantId: string, type: NodeType, parentId: string | null, currentId?: string) {
  if (type === 'organisation') return parentId === null;
  if (!parentId || parentId === currentId) return false;
  const parent = await loadNode(tenantId, parentId);
  if (!parent || !PARENT_TYPES[type].includes(parent.type)) return false;
  let cursor: any = parent;
  for (let depth = 0; cursor && depth < 20; depth += 1) {
    if (cursor.id === currentId) return false;
    if (!cursor.parentId) return cursor.type === 'organisation';
    cursor = await loadNode(tenantId, cursor.parentId);
  }
  return false;
}
function safeStringList(value: unknown, max: number, maxLength = 100): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every(item => typeof item === 'string' && item.length > 0 && item.length <= maxLength);
}

export const governanceRoutes = {
  'GET /api/platform/organisation-nodes': [requireAuth(), async (ctx: any) => {
    const a = await access(ctx); if (a.response) return a.response;
    if (!(await allowed(a.tenantId!, a.membership!, 'organisation-node', 'read'))) return error('Permission denied', 403);
    const [root] = await db.get<Record<string, any>>(nodeTable(a.tenantId!), ['root'], { consistent: true });
    if (!root) {
      const [tenant] = await db.get<Record<string, any>>('tenants', [a.tenantId!], { consistent: true });
      const timestamp = now();
      await db.tx.add(nodeTable(a.tenantId!), [{ id: 'root', tenantId: a.tenantId, type: 'organisation', name: tenant?.name || 'Organisation', parentId: null, schoolId: null, code: '', metadata: {}, status: 'active', version: 1, createdAt: timestamp, createdBy: 'system-backfill', updatedAt: timestamp, updatedBy: 'system-backfill' }]);
    }
    const existingNodes = await db.list<Record<string, any>>(nodeTable(a.tenantId!), { limit: 200 });
    const schoolPage = await db.list<Record<string, any>>(tenantTable('schools', a.tenantId!), { limit: 100 });
    const linkedSchools = new Set(existingNodes.items.filter(item => item.type === 'school' && item.status === 'active').map(item => item.schoolId));
    const unlinkedSchools = schoolPage.items.filter(school => school.tenantId === a.tenantId && school.status === 'active' && !linkedSchools.has(school.id));
    for (const school of unlinkedSchools) {
      const timestamp = now();
      await db.tx.add(nodeTable(a.tenantId!), [{ id: 'school_' + school.id, tenantId: a.tenantId, type: 'school', name: school.name, parentId: 'root', schoolId: school.id, code: '', metadata: {}, status: 'active', version: 1, createdAt: timestamp, createdBy: 'system-backfill', updatedAt: timestamp, updatedBy: 'system-backfill' }]);
    }
    const limit = ctx.query.limit === undefined ? 100 : Number(ctx.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return error('limit must be an integer from 1 to 100', 400);
    const page = await db.list<Record<string, any>>(nodeTable(a.tenantId!), { limit, ...(ctx.query.nextToken ? { nextToken: ctx.query.nextToken } : {}) });
    return json({ items: page.items.filter(item => item.tenantId === a.tenantId && item.status === 'active' && (!ctx.query.parentId || item.parentId === ctx.query.parentId)), nextToken: page.nextToken || null });
  }],
  'POST /api/platform/organisation-nodes': [requireAuth(), async (ctx: any) => {
    const a = await access(ctx); if (a.response) return a.response;
    if (!(await allowed(a.tenantId!, a.membership!, 'organisation-node', 'create'))) return error('Permission denied', 403);
    const body = isRecord(ctx.body) ? ctx.body : {};
    if (Object.keys(body).some(key => !['tenantId', 'type', 'name', 'parentId', 'schoolId', 'code', 'metadata'].includes(key))) return error('Unsupported organisation-node fields', 400);
    const type = body.type as NodeType;
    if (!NODE_TYPES.includes(type)) return error('Choose a supported organisation node type', 400);
    let id = type === 'organisation' ? 'root' : crypto.randomUUID();
    if (!validText(body.name, 160) && type !== 'school') return error('A valid node name is required', 400);
    if (type === 'organisation' && await loadNode(a.tenantId!, 'root')) return error('The organisation root already exists', 409);
    const parentId = typeof body.parentId === 'string' ? body.parentId : null;
    if (!(await validateParent(a.tenantId!, type, parentId))) return error('The selected parent is invalid for this node type or is outside the organisation hierarchy', 400);
    let name = String(body.name || '').trim();
    let schoolId: string | null = null;
    if (type === 'school') {
      if (typeof body.schoolId !== 'string') return error('Select an existing school record; school records are not duplicated in the hierarchy', 400);
      const [school] = await db.get<Record<string, any>>(tenantTable('schools', a.tenantId!), [body.schoolId], { consistent: true });
      if (!school || school.tenantId !== a.tenantId || school.status !== 'active') return error('The selected school does not exist in this tenant', 400);
      const { items } = await db.list<Record<string, any>>(nodeTable(a.tenantId!), { limit: 200 });
      if (items.some(item => item.type === 'school' && item.schoolId === body.schoolId && item.status === 'active')) return error('This school is already linked to the organisation hierarchy', 409);
      name = school.name;
      schoolId = body.schoolId;
      id = 'school_' + body.schoolId;
    }
    const timestamp = now();
    const node = { id, tenantId: a.tenantId, type, name, parentId, schoolId, code: typeof body.code === 'string' ? body.code.trim().slice(0, 40) : '', metadata: isRecord(body.metadata) ? body.metadata : {}, status: 'active', version: 1, createdAt: timestamp, createdBy: ctx.user.userId, updatedAt: timestamp, updatedBy: ctx.user.userId };
    await db.transact([
      db.tx.add(nodeTable(a.tenantId!), [node]),
      db.tx.add(tenantTable('audit_events', a.tenantId!), [auditRecord(a.tenantId!, ctx.user.userId, 'organisation-node.created', id, { type, parentId, schoolId })]),
      db.tx.add(tenantTable('domain_events', a.tenantId!), [domainEvent(a.tenantId!, ctx.user.userId, 'organisation.node.created', 'organisation-node', id, { type, parentId, schoolId }, crypto.randomUUID(), timestamp)]),
    ]);
    return json({ node }, 201);
  }],
  'PUT /api/platform/organisation-nodes/:nodeId': [requireAuth(), async (ctx: any) => {
    const a = await access(ctx); if (a.response) return a.response;
    const id = String(ctx.params.nodeId || ''), old = await loadNode(a.tenantId!, id);
    if (!old) return error('Organisation node not found', 404);
    if (!(await allowed(a.tenantId!, a.membership!, 'organisation-node', 'update', { schoolId: old.schoolId || undefined }))) return error('Permission denied', 403);
    const body = isRecord(ctx.body) ? ctx.body : {};
    if (Object.keys(body).some(key => !['tenantId', 'name', 'parentId', 'code', 'metadata', 'expectedVersion'].includes(key))) return error('Unsupported organisation-node fields', 400);
    if (body.expectedVersion !== old.version) return error('Organisation node changed; reload before saving', 409);
    if (old.type === 'school') return error('Rename the school in the existing school registry; the hierarchy links to that record', 409);
    const name = body.name === undefined ? old.name : String(body.name).trim();
    const parentId = body.parentId === undefined ? old.parentId : body.parentId;
    if (!validText(name, 160) || !(await validateParent(a.tenantId!, old.type, parentId, id))) return error('Invalid name or parent-child relationship', 400);
    const metadata = body.metadata === undefined ? old.metadata : body.metadata;
    if (!isRecord(metadata)) return error('metadata must be a JSON object', 400);
    const updated = { ...old, name, parentId, code: body.code === undefined ? old.code : String(body.code).trim().slice(0, 40), metadata, version: Number(old.version) + 1, updatedAt: now(), updatedBy: ctx.user.userId };
    await db.transact([
      db.tx.update(nodeTable(a.tenantId!), [{ id, if: { version: old.version }, record: updated }]),
      db.tx.add(tenantTable('audit_events', a.tenantId!), [auditRecord(a.tenantId!, ctx.user.userId, 'organisation-node.updated', id, { previousVersion: old.version, nextVersion: updated.version, parentId })]),
    ]);
    return json({ node: updated });
  }],
  'DELETE /api/platform/organisation-nodes/:nodeId': [requireAuth(), async (ctx: any) => {
    const a = await access(ctx); if (a.response) return a.response;
    const id = String(ctx.params.nodeId || ''), old = await loadNode(a.tenantId!, id);
    if (!old) return error('Organisation node not found', 404);
    if (old.type === 'organisation') return error('The organisation root cannot be archived', 409);
    if (!(await allowed(a.tenantId!, a.membership!, 'organisation-node', 'delete', { schoolId: old.schoolId || undefined }))) return error('Permission denied', 403);
    const { items } = await db.list<Record<string, any>>(nodeTable(a.tenantId!), { limit: 200 });
    if (items.some(item => item.status === 'active' && item.parentId === id)) return error('Move or archive child nodes before archiving this node', 409);
    const updated = { ...old, status: 'archived', version: Number(old.version) + 1, archivedAt: now(), archivedBy: ctx.user.userId };
    await db.transact([
      db.tx.update(nodeTable(a.tenantId!), [{ id, if: { version: old.version }, record: updated }]),
      db.tx.add(tenantTable('audit_events', a.tenantId!), [auditRecord(a.tenantId!, ctx.user.userId, 'organisation-node.archived', id, { type: old.type })]),
    ]);
    return json({ archived: true });
  }],
  'GET /api/platform/memberships': [requireAuth(), async (ctx: any) => {
    const a = await access(ctx); if (a.response) return a.response;
    if (!isTenantSuperAdmin(a.membership) && !(await allowed(a.tenantId!, a.membership!, 'membership', 'read'))) return error('Permission denied', 403);
    const page = await db.list<Record<string, any>>(tenantTable('tenant_memberships', a.tenantId!), { limit: 100, ...(ctx.query.nextToken ? { nextToken: ctx.query.nextToken } : {}) });
    return json({ items: page.items.filter(item => item.tenantId === a.tenantId), nextToken: page.nextToken || null });
  }],
  'POST /api/platform/memberships/invitations': [requireAuth(), async (ctx: any) => {
    const a = await access(ctx); if (a.response) return a.response;
    if (!isTenantSuperAdmin(a.membership)) return error('Only the tenant super administrator can prepare membership invitations', 403);
    const body = isRecord(ctx.body) ? ctx.body : {};
    if (typeof body.userId !== 'string' || body.userId.length < 8 || body.userId.length > 128) return error('A valid existing AppDeploy user ID is required', 400);
    const userId = body.userId;
    const [existing] = await db.get<Record<string, any>>(tenantTable('tenant_memberships', a.tenantId!), [userId], { consistent: true });
    if (existing) return error('A membership already exists for this user', 409);
    const schoolIds = body.schoolIds === undefined ? [] : body.schoolIds;
    if (!safeStringList(schoolIds, 50) || new Set(schoolIds).size !== schoolIds.length || schoolIds.some((id: string) => id === '*')) return error('Invitation school scope must contain unique, explicit school IDs; wildcard scope is not allowed', 400);
    if (schoolIds.length) {
      const schools = await db.get<Record<string, any>>(tenantTable('schools', a.tenantId!), schoolIds, { consistent: true });
      if (schools.some(school => !school || school.tenantId !== a.tenantId || school.status !== 'active')) return error('Every invitation school must be active and belong to this tenant', 400);
    }
    const timestamp = now();
    const membership = { id: userId, tenantId: a.tenantId, userId, roles: [], role: null, schoolIds, status: 'invited', isTenantSuperAdmin: false, invitedBy: ctx.user.userId, invitedAt: timestamp, createdAt: timestamp };
    const index = { id: a.tenantId, tenantId: a.tenantId, role: null, roles: [], schoolIds, status: 'invited', isTenantSuperAdmin: false, createdAt: timestamp };
    await db.transact([
      db.tx.add(tenantTable('tenant_memberships', a.tenantId!), [membership]),
      db.tx.add(userTenantTable(userId), [index]),
      db.tx.add(tenantTable('audit_events', a.tenantId!), [auditRecord(a.tenantId!, ctx.user.userId, 'membership.invited', userId, { schoolIds })]),
    ]);
    return json({ membership, invitationDelivery: 'not_sent; AppDeploy invitation/email delivery must be configured separately' }, 201);
  }],
  'PUT /api/platform/memberships/:userId/status': [requireAuth(), async (ctx: any) => {
    const a = await access(ctx); if (a.response) return a.response;
    if (!isTenantSuperAdmin(a.membership)) return error('Only the tenant super administrator can change membership lifecycle status', 403);
    const userId = String(ctx.params.userId || '');
    const [old] = await db.get<Record<string, any>>(tenantTable('tenant_memberships', a.tenantId!), [userId], { consistent: true });
    const status = ctx.body?.status;
    if (!old || old.tenantId !== a.tenantId) return error('Tenant membership not found', 404);
    if (!['invited', 'active', 'suspended', 'revoked'].includes(status)) return error('Choose invited, active, suspended or revoked', 400);
    if (status === 'active' && old.status === 'invited') return error('An invited membership cannot be activated by an administrator status update. Complete the configured identity-provider invitation acceptance flow first.', 409);
    if (isTenantSuperAdmin(old)) return error('The tenant super-administrator membership cannot be changed through ordinary lifecycle controls', 409);
    const timestamp = now();
    const updated = { ...old, status, updatedAt: timestamp, updatedBy: ctx.user.userId, ...(status === 'revoked' ? { revokedAt: timestamp, revokedBy: ctx.user.userId } : {}) };
    const [index] = await db.get<Record<string, any>>(userTenantTable(userId), [a.tenantId!], { consistent: true });
    if (!index) return error('User membership index is missing; no changes were made', 409);
    const indexUpdated = { ...index, status, updatedAt: timestamp };
    await db.transact([
      db.tx.update(tenantTable('tenant_memberships', a.tenantId!), [{ id: userId, if: { status: old.status }, record: updated }]),
      db.tx.update(userTenantTable(userId), [{ id: a.tenantId!, if: { status: index.status }, record: indexUpdated }]),
      db.tx.add(tenantTable('audit_events', a.tenantId!), [auditRecord(a.tenantId!, ctx.user.userId, 'membership.status.changed', userId, { from: old.status, to: status })]),
    ]);
    return json({ membership: updated });
  }],
  'POST /api/platform/memberships/:userId/delegations': [requireAuth(), async (ctx: any) => {
    const a = await access(ctx); if (a.response) return a.response;
    if (!isTenantSuperAdmin(a.membership)) return error('Only the tenant super administrator can grant delegated authority', 403);
    const userId = String(ctx.params.userId || ''), [old] = await db.get<Record<string, any>>(tenantTable('tenant_memberships', a.tenantId!), [userId], { consistent: true });
    const body = isRecord(ctx.body) ? ctx.body : {};
    const resources = ['organisation-node', 'school', 'student', 'academic-year', 'term', 'class', 'section', 'subject', 'attendance-register', 'assessment', 'workflow'];
    const actions = ['read', 'create', 'update', 'delete'];
    if (!old || old.tenantId !== a.tenantId || old.status !== 'active' || isTenantSuperAdmin(old)) return error('Active non-super-administrator membership not found', 404);
    if (!safeStringList(body.resources, 20) || body.resources.some((item: string) => !resources.includes(item)) || !safeStringList(body.actions, 4) || body.actions.some((item: string) => !actions.includes(item)) || !safeStringList(body.schoolIds, 50) || body.schoolIds.length === 0 || new Set(body.schoolIds).size !== body.schoolIds.length || body.schoolIds.some((id: string) => id === '*')) return error('Delegation requires allowed resources, CRUD actions and unique explicit school IDs; wildcard scope is not allowed', 400);
    const delegatedSchools = await db.get<Record<string, any>>(tenantTable('schools', a.tenantId!), body.schoolIds, { consistent: true });
    if (delegatedSchools.some(school => !school || school.tenantId !== a.tenantId || school.status !== 'active')) return error('Every delegated school must be active and belong to this tenant', 400);
    const expiry = typeof body.expiresAt === 'string' ? Date.parse(body.expiresAt) : NaN;
    if (!Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 30 * 86400000) return error('Delegation expiry must be within the next 30 days', 400);
    const delegation = { id: crypto.randomUUID(), resources: body.resources, actions: body.actions, schoolIds: body.schoolIds, expiresAt: new Date(expiry).toISOString(), grantedBy: ctx.user.userId, grantedAt: now() };
    const updated = { ...old, delegations: [...(Array.isArray(old.delegations) ? old.delegations : []).filter((item: any) => Date.parse(item.expiresAt) > Date.now()), delegation], updatedAt: now(), updatedBy: ctx.user.userId };
    await db.transact([
      db.tx.update(tenantTable('tenant_memberships', a.tenantId!), [{ id: userId, if: { status: 'active' }, record: updated }]),
      db.tx.add(tenantTable('audit_events', a.tenantId!), [auditRecord(a.tenantId!, ctx.user.userId, 'membership.delegation.granted', userId, { delegationId: delegation.id, resources, actions, schoolIds: body.schoolIds, expiresAt: delegation.expiresAt })]),
    ]);
    return json({ delegation }, 201);
  }],
  'DELETE /api/platform/memberships/:userId/delegations/:delegationId': [requireAuth(), async (ctx: any) => {
    const a = await access(ctx); if (a.response) return a.response;
    if (!isTenantSuperAdmin(a.membership)) return error('Only the tenant super administrator can revoke delegated authority', 403);
    const userId = String(ctx.params.userId || ''), delegationId = String(ctx.params.delegationId || '');
    const [old] = await db.get<Record<string, any>>(tenantTable('tenant_memberships', a.tenantId!), [userId], { consistent: true });
    if (!old || old.tenantId !== a.tenantId) return error('Tenant membership not found', 404);
    const grants = Array.isArray(old.delegations) ? old.delegations : [];
    if (!grants.some((grant: any) => grant.id === delegationId)) return error('Delegation not found', 404);
    const updated = { ...old, delegations: grants.filter((grant: any) => grant.id !== delegationId), updatedAt: now(), updatedBy: ctx.user.userId };
    await db.transact([
      db.tx.update(tenantTable('tenant_memberships', a.tenantId!), [{ id: userId, if: { status: old.status }, record: updated }]),
      db.tx.add(tenantTable('audit_events', a.tenantId!), [auditRecord(a.tenantId!, ctx.user.userId, 'membership.delegation.revoked', userId, { delegationId })]),
    ]);
    return json({ revoked: true, delegationId });
  }],
  'GET /api/platform/workflows': [requireAuth(), async (ctx: any) => {
    const a = await access(ctx); if (a.response) return a.response;
    if (!(await allowed(a.tenantId!, a.membership!, 'workflow', 'read'))) return error('Permission denied', 403);
    const [definitions, instances] = await Promise.all([
      db.list<Record<string, any>>(workflowTable(a.tenantId!), { limit: 100 }),
      db.list<Record<string, any>>(instanceTable(a.tenantId!), { limit: 100 }),
    ]);
    const canApprove = await allowed(a.tenantId!, a.membership!, 'workflow', 'approve');
    const roles = [...(Array.isArray(a.membership!.roles) ? a.membership!.roles : []), ...(a.membership!.role ? [a.membership!.role] : [])].map(String);
    return json({ definitions: definitions.items.filter(x => x.tenantId === a.tenantId), instances: instances.items.filter(x => x.tenantId === a.tenantId).map(item => { const step = item.steps?.[item.currentStep]; const assigned = !step?.approverRoles?.length || step.approverRoles.some((role: string) => roles.includes(role)); return { ...item, canDecide: canApprove && item.status === 'pending' && item.submittedBy !== ctx.user.userId && (isTenantSuperAdmin(a.membership!) || assigned), overdue: item.status === 'pending' && Date.parse(step?.dueAt || '') <= Date.now() }; }) });
  }],
  'POST /api/platform/workflows': [requireAuth(), async (ctx: any) => {
    const a = await access(ctx); if (a.response) return a.response;
    if (!(await allowed(a.tenantId!, a.membership!, 'workflow', 'create'))) return error('Permission denied', 403);
    const body = isRecord(ctx.body) ? ctx.body : {};
    if (!validText(body.name, 120) || !Array.isArray(body.steps) || body.steps.length < 1 || body.steps.length > 10) return error('Workflow name and one or more approval steps are required', 400);
    const steps = body.steps.map((step: any, index: number) => {
      if (!isRecord(step) || !validText(step.name, 100) || !safeStringList(step.approverRoles || [], 20)) return null;
      const dueHours = Number(step.dueHours || 48);
      if (!Number.isInteger(dueHours) || dueHours < 1 || dueHours > 720) return null;
      return { sequence: index + 1, name: step.name.trim(), approverRoles: step.approverRoles || [], dueHours };
    });
    if (steps.some((step: any) => !step)) return error('Each workflow step needs a name, valid approver roles and a due time from 1 to 720 hours', 400);
    const id = crypto.randomUUID(), timestamp = now();
    const definition = { id, tenantId: a.tenantId, name: body.name.trim(), description: typeof body.description === 'string' ? body.description.slice(0, 500) : '', steps, makerChecker: true, status: 'active', version: 1, createdAt: timestamp, createdBy: ctx.user.userId };
    await db.transact([
      db.tx.add(workflowTable(a.tenantId!), [definition]),
      db.tx.add(tenantTable('audit_events', a.tenantId!), [auditRecord(a.tenantId!, ctx.user.userId, 'workflow.definition.created', id, { name: definition.name, steps: steps.length, makerChecker: true })]),
    ]);
    return json({ definition }, 201);
  }],
  'POST /api/platform/workflow-instances': [requireAuth(), async (ctx: any) => {
    const a = await access(ctx); if (a.response) return a.response;
    if (!(await allowed(a.tenantId!, a.membership!, 'workflow', 'create'))) return error('Permission denied', 403);
    const body = isRecord(ctx.body) ? ctx.body : {};
    if (typeof body.workflowId !== 'string' || !validText(body.title, 160) || (body.evidenceRefs !== undefined && !safeStringList(body.evidenceRefs, 20, 180))) return error('Choose a workflow, title and valid evidence references', 400);
    const [definition] = await db.get<Record<string, any>>(workflowTable(a.tenantId!), [body.workflowId], { consistent: true });
    if (!definition || definition.tenantId !== a.tenantId || definition.status !== 'active') return error('Active workflow definition not found', 404);
    const timestamp = now(), id = crypto.randomUUID();
    const firstDue = new Date(Date.now() + definition.steps[0].dueHours * 3600000).toISOString();
    const instance = { id, tenantId: a.tenantId, workflowId: definition.id, workflowName: definition.name, title: body.title.trim(), resourceType: typeof body.resourceType === 'string' ? body.resourceType.slice(0, 100) : 'general', resourceId: typeof body.resourceId === 'string' ? body.resourceId.slice(0, 120) : null, payload: isRecord(body.payload) ? body.payload : {}, evidenceRefs: body.evidenceRefs || [], submittedBy: ctx.user.userId, status: 'pending', currentStep: 0, steps: definition.steps.map((step: any, index: number) => ({ ...step, status: index === 0 ? 'pending' : 'waiting', dueAt: index === 0 ? firstDue : null })), version: 1, createdAt: timestamp, updatedAt: timestamp };
    await db.transact([
      db.tx.add(instanceTable(a.tenantId!), [instance]),
      db.tx.add(tenantTable('audit_events', a.tenantId!), [auditRecord(a.tenantId!, ctx.user.userId, 'workflow.submitted', id, { workflowId: definition.id, evidenceCount: instance.evidenceRefs.length })]),
      db.tx.add(tenantTable('domain_events', a.tenantId!), [domainEvent(a.tenantId!, ctx.user.userId, 'workflow.submitted', 'workflow-instance', id, { workflowId: definition.id }, crypto.randomUUID(), timestamp)]),
    ]);
    return json({ instance }, 201);
  }],
  'POST /api/platform/workflow-instances/:instanceId/decision': [requireAuth(), async (ctx: any) => {
    const a = await access(ctx); if (a.response) return a.response;
    const id = String(ctx.params.instanceId || ''), body = isRecord(ctx.body) ? ctx.body : {};
    const [old] = await db.get<Record<string, any>>(instanceTable(a.tenantId!), [id], { consistent: true });
    if (!old || old.tenantId !== a.tenantId || old.status !== 'pending') return error('Pending workflow instance not found', 404);
    if (old.submittedBy === ctx.user.userId) return error('Maker-checker control: the requester cannot approve or reject their own submission', 403);
    if (body.expectedVersion !== old.version || !['approve', 'reject'].includes(body.decision)) return error('Provide a valid decision and current workflow version', 409);
    const step = old.steps[old.currentStep];
    const roleIds = [...(Array.isArray(a.membership!.roles) ? a.membership!.roles : []), ...(a.membership!.role ? [a.membership!.role] : [])].map(String);
    if (!isTenantSuperAdmin(a.membership!) && step.approverRoles.length && !step.approverRoles.some((role: string) => roleIds.includes(role))) return error('Your membership is not assigned to approve this workflow step', 403);
    if (!(await allowed(a.tenantId!, a.membership!, 'workflow', 'approve'))) return error('Permission denied', 403);
    const timestamp = now(), steps = old.steps.map((item: any, index: number) => index === old.currentStep ? { ...item, status: body.decision === 'approve' ? 'approved' : 'rejected', decidedBy: ctx.user.userId, decidedAt: timestamp, comment: typeof body.comment === 'string' ? body.comment.slice(0, 1000) : '' } : item);
    let status = body.decision === 'reject' ? 'rejected' : 'pending';
    const nextIndex = old.currentStep + 1;
    if (body.decision === 'approve' && nextIndex >= steps.length) status = 'approved';
    if (body.decision === 'approve' && nextIndex < steps.length) steps[nextIndex] = { ...steps[nextIndex], status: 'pending', dueAt: new Date(Date.now() + steps[nextIndex].dueHours * 3600000).toISOString() };
    const updated = { ...old, steps, status, currentStep: body.decision === 'approve' ? Math.min(nextIndex, steps.length - 1) : old.currentStep, version: Number(old.version) + 1, updatedAt: timestamp, ...(status === 'approved' ? { completedAt: timestamp } : status === 'rejected' ? { rejectedAt: timestamp } : {}) };
    await db.transact([
      db.tx.update(instanceTable(a.tenantId!), [{ id, if: { version: old.version, status: 'pending' }, record: updated }]),
      db.tx.add(tenantTable('workflow_decisions', a.tenantId!), [{ id: crypto.randomUUID(), tenantId: a.tenantId, instanceId: id, stepSequence: step.sequence, decision: body.decision, actorUserId: ctx.user.userId, comment: typeof body.comment === 'string' ? body.comment.slice(0, 1000) : '', decidedAt: timestamp }]),
      db.tx.add(tenantTable('audit_events', a.tenantId!), [auditRecord(a.tenantId!, ctx.user.userId, 'workflow.' + body.decision, id, { submittedBy: old.submittedBy, step: step.name, status })]),
      db.tx.add(tenantTable('domain_events', a.tenantId!), [domainEvent(a.tenantId!, ctx.user.userId, 'workflow.' + body.decision, 'workflow-instance', id, { status, version: updated.version }, crypto.randomUUID(), timestamp)]),
    ]);
    return json({ instance: updated });
  }],
  'GET /api/platform/workflow-instances/:instanceId/decisions': [requireAuth(), async (ctx: any) => {
    const a = await access(ctx); if (a.response) return a.response;
    if (!(await allowed(a.tenantId!, a.membership!, 'workflow', 'read'))) return error('Permission denied', 403);
    const instanceId = String(ctx.params.instanceId || '');
    const [instance] = await db.get<Record<string, any>>(instanceTable(a.tenantId!), [instanceId], { consistent: true });
    if (!instance || instance.tenantId !== a.tenantId) return error('Workflow instance not found', 404);
    const { items } = await db.list<Record<string, any>>(tenantTable('workflow_decisions', a.tenantId!), { limit: 100 });
    return json({ items: items.filter(item => item.tenantId === a.tenantId && item.instanceId === instanceId).sort((left, right) => left.stepSequence - right.stepSequence) });
  }],
  'GET /api/platform/audit': [requireAuth(), async (ctx: any) => {
    const a = await access(ctx); if (a.response) return a.response;
    if (!(await allowed(a.tenantId!, a.membership!, 'audit', 'read'))) return error('Permission denied', 403);
    const limit = ctx.query.limit === undefined ? 50 : Number(ctx.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return error('limit must be an integer from 1 to 100', 400);
    const page = await db.list<Record<string, any>>(tenantTable('audit_events', a.tenantId!), { limit, ...(ctx.query.nextToken ? { nextToken: ctx.query.nextToken } : {}) });
    return json({ items: page.items.filter(item => item.tenantId === a.tenantId), nextToken: page.nextToken || null, appendOnlyApi: true, storageImmutability: 'not guaranteed by the current key-value database' });
  }],
};

/** Hourly bounded escalation pass. It marks overdue steps and emits auditable events; delivery still depends on a configured notification consumer. */
export async function runWorkflowEscalations() {
  const tenants = await db.list<Record<string, any>>('tenants', { limit: 100 });
  let escalated = 0;
  for (const tenant of tenants.items) {
    const tenantId = tenant.id;
    if (typeof tenantId !== 'string' || !tenantId) continue;
    const page = await db.list<Record<string, any>>(instanceTable(tenantId), { limit: 100 });
    const due = page.items.filter(item => item.tenantId === tenantId && item.status === 'pending' && !item.escalationStatus && Date.parse(item.steps?.[item.currentStep]?.dueAt || '') <= Date.now()).slice(0, 30);
    for (const item of due) {
      const timestamp = now();
      const updated = { ...item, escalationStatus: 'escalated', escalatedAt: timestamp, version: Number(item.version || 1) + 1, updatedAt: timestamp };
      try {
        await db.transact([
          db.tx.update(instanceTable(tenantId), [{ id: item.id, if: { version: item.version, status: 'pending' }, record: updated }]),
          db.tx.add(tenantTable('audit_events', tenantId), [auditRecord(tenantId, 'system:workflow-escalation', 'workflow.escalated', item.id, { workflowId: item.workflowId, currentStep: item.currentStep })]),
          db.tx.add(tenantTable('domain_events', tenantId), [domainEvent(tenantId, 'system:workflow-escalation', 'workflow.escalated', 'workflow-instance', item.id, { workflowId: item.workflowId, escalationStatus: 'escalated' }, crypto.randomUUID(), timestamp)]),
        ]);
        escalated += 1;
      } catch (cause) {
        console.error('workflow escalation failed', { tenantId, instanceId: item.id, cause });
      }
    }
  }
  return { escalated };
}
