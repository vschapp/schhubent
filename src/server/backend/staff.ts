// @ts-nocheck -- imported School Hub source, kept as-is
import { db, error, json, requireAuth } from '@/server/appdeploy-sdk';
import {
  apiFailure, auditRecord, authorizeRecord, domainEvent, isRecord,
  isValidRecordId, tenantAccessFromRequest, tenantTable,
} from './platform';

type StaffStatus = 'pending' | 'active' | 'on_leave' | 'suspended' | 'terminated' | 'retired';
type EmploymentType = 'permanent' | 'contract' | 'temporary' | 'national_service' | 'volunteer' | 'other';
type StaffProfile = {
  id: string;
  tenantId: string;
  schoolId: string;
  userId: string | null;
  staffNumber: string;
  firstName: string;
  lastName: string;
  otherNames: string | null;
  workEmail: string | null;
  workPhone: string | null;
  employmentStatus: StaffStatus;
  employmentType: EmploymentType;
  departmentNodeId: string | null;
  jobTitle: string | null;
  startDate: string | null;
  endDate: string | null;
  version: number;
  attributes: Record<string, unknown>;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  deletedAt: string | null;
};
const now = () => new Date().toISOString();
const profileTable = (tenantId: string) => tenantTable('staff_profiles', tenantId);
const historyTable = (tenantId: string) => tenantTable('staff_employment_history', tenantId);
const validId = isValidRecordId;
const statuses: StaffStatus[] = ['pending', 'active', 'on_leave', 'suspended', 'terminated', 'retired'];
const employmentTypes: EmploymentType[] = ['permanent', 'contract', 'temporary', 'national_service', 'volunteer', 'other'];

async function access(ctx: any) {
  const resolved = await tenantAccessFromRequest(ctx, {
    allowBodyFallback: false, requireTenantId: true, maxTenantLength: 128,
    invalidTenantMessage: 'A valid tenantId query parameter is required.',
    membershipMessage: 'Tenant membership not found or access denied.',
  });
  if (!resolved.ok) return { response: resolved.response };
  return { tenantId: resolved.tenantId!, membership: resolved.membership!, response: null };
}
async function loadSchool(tenantId: string, schoolId: string) {
  const [school] = await db.get<Record<string, any>>(tenantTable('schools', tenantId), [schoolId], { consistent: true });
  return school && school.id === schoolId && school.tenantId === tenantId && school.status === 'active' ? school : null;
}
async function loadStaff(tenantId: string, id: string): Promise<StaffProfile | null> {
  const [record] = await db.get<StaffProfile>(profileTable(tenantId), [id], { consistent: true });
  return record && record.id === id && record.tenantId === tenantId && !record.deletedAt ? record : null;
}
function validDate(value: unknown) {
  if (value === null || value === undefined || value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function optionalText(value: unknown, max: number) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > max) return undefined;
  return value.trim();
}
async function validateDepartment(tenantId: string, schoolId: string, value: unknown) {
  if (!value) return true;
  if (!validId(value)) return false;
  const [node] = await db.get<Record<string, any>>(tenantTable('organisation_nodes', tenantId), [String(value)], { consistent: true });
  return Boolean(node && node.tenantId === tenantId && node.status === 'active' && (node.nodeType || node.type) === 'department' && (!node.schoolId || node.schoolId === schoolId));
}
function historyRecord(tenantId: string, staff: StaffProfile, userId: string, changeType: string, previousState: unknown, newState: unknown, reason: string | null, effectiveOn: string) {
  return {
    id: crypto.randomUUID(), tenantId, schoolId: staff.schoolId, staffId: staff.id,
    changeType, effectiveOn, previousState: previousState ?? null, newState,
    reason, approvedBy: null, createdBy: userId, createdAt: now(),
  };
}

export const staffRoutes = {
  'GET /api/staff': [requireAuth(), async (ctx: any) => {
    try {
      const a = await access(ctx); if (a.response) return a.response;
      const schoolId = String(ctx.query.schoolId || '');
      if (!validId(schoolId)) return error('Choose a valid school.', 400);
      if (!(await loadSchool(a.tenantId, schoolId))) return error('The selected school is not active in this workspace.', 404);
      const limit = ctx.query.limit === undefined ? 50 : Number(ctx.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) return error('limit must be an integer from 1 to 100.', 400);
      const page = await db.list<StaffProfile>(profileTable(a.tenantId), { limit, ...(ctx.query.nextToken ? { nextToken: ctx.query.nextToken } : {}) });
      const search = String(ctx.query.search || '').trim().toLowerCase();
      if (search.length > 80) return error('Search text must not exceed 80 characters.', 400);
      const items = [];
      for (const item of page.items) {
        if (item.tenantId !== a.tenantId || item.schoolId !== schoolId || item.deletedAt) continue;
        if (ctx.query.status && item.employmentStatus !== ctx.query.status) continue;
        if (search && ![item.staffNumber, item.firstName, item.lastName, item.otherNames || '', item.workEmail || '', item.jobTitle || ''].some(v => v.toLowerCase().includes(search))) continue;
        if (await authorizeRecord(a.tenantId, a.membership, 'staff-profile', 'read', item)) items.push(item);
      }
      return json({ items, nextToken: page.nextToken || null, pageSize: limit });
    } catch (cause) { return apiFailure(cause, 'Unable to retrieve staff records.', { logLabel: 'staff.list failed' }); }
  }],
  'POST /api/staff': [requireAuth(), async (ctx: any) => {
    try {
      const a = await access(ctx); if (a.response) return a.response;
      if (!isRecord(ctx.body)) return error('A staff profile is required.', 400);
      const b = ctx.body;
      const allowed = ['schoolId','firstName','lastName','otherNames','workEmail','workPhone','employmentType','departmentNodeId','jobTitle','startDate','reason'];
      if (Object.keys(b).some(k => !allowed.includes(k))) return error('Submit only registered staff profile fields. IDs and employment status are server-managed.', 400);
      const schoolId = String(b.schoolId || '');
      if (!validId(schoolId) || !(await loadSchool(a.tenantId, schoolId))) return error('Select an active school in this workspace.', 400);
      const firstName = typeof b.firstName === 'string' ? b.firstName.trim() : '';
      const lastName = typeof b.lastName === 'string' ? b.lastName.trim() : '';
      const otherNames = optionalText(b.otherNames, 120);
      const workEmail = optionalText(b.workEmail, 320);
      const workPhone = optionalText(b.workPhone, 40);
      const jobTitle = optionalText(b.jobTitle, 120);
      const reason = optionalText(b.reason, 1000);
      const employmentType = (b.employmentType || 'permanent') as EmploymentType;
      if (firstName.length < 1 || firstName.length > 100 || lastName.length < 1 || lastName.length > 100 ||
          otherNames === undefined || workEmail === undefined || workPhone === undefined || jobTitle === undefined || reason === undefined ||
          (workEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail)) ||
          !employmentTypes.includes(employmentType) || !validDate(b.startDate) ||
          !(await validateDepartment(a.tenantId, schoolId, b.departmentNodeId))) return error('Check the staff name, contact details, employment type, department and start date.', 400);
      const timestamp = now();
      const id = crypto.randomUUID();
      const staffNumber = 'STF-' + new Date().getUTCFullYear() + '-' + crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
      const profile: StaffProfile = {
        id, tenantId: a.tenantId, schoolId, userId: null, staffNumber,
        firstName, lastName, otherNames, workEmail, workPhone,
        employmentStatus: 'pending', employmentType,
        departmentNodeId: typeof b.departmentNodeId === 'string' ? b.departmentNodeId : null,
        jobTitle, startDate: typeof b.startDate === 'string' ? b.startDate : null, endDate: null,
        version: 1, attributes: {}, createdAt: timestamp, createdBy: ctx.user.userId,
        updatedAt: timestamp, updatedBy: ctx.user.userId, deletedAt: null,
      };
      if (!(await authorizeRecord(a.tenantId, a.membership, 'staff-profile', 'create', profile))) return error('Permission denied for this school or staff scope.', 403);
      const history = historyRecord(a.tenantId, profile, ctx.user.userId, 'appointed', null, {
        employmentStatus: profile.employmentStatus, employmentType, jobTitle, departmentNodeId: profile.departmentNodeId, startDate: profile.startDate,
      }, reason, profile.startDate || timestamp.slice(0, 10));
      await db.transact([
        db.tx.add(profileTable(a.tenantId), [profile]),
        db.tx.add(historyTable(a.tenantId), [history]),
        db.tx.add(tenantTable('audit_events', a.tenantId), [auditRecord(a.tenantId, ctx.user.userId, 'staff.created', id, { schoolId, staffNumber, employmentType })]),
        db.tx.add(tenantTable('domain_events', a.tenantId), [domainEvent(a.tenantId, ctx.user.userId, 'staff.created', 'staff-profile', id, { schoolId, staffNumber }, crypto.randomUUID(), timestamp)]),
      ]);
      return json({ staff: profile }, 201);
    } catch (cause) { return apiFailure(cause, 'Unable to create the staff profile.', { logLabel: 'staff.create failed' }); }
  }],
  'GET /api/staff/:staffId': [requireAuth(), async (ctx: any) => {
    try {
      const a = await access(ctx); if (a.response) return a.response;
      const id = String(ctx.params.staffId || '');
      if (!validId(id)) return error('Invalid staff identifier.', 400);
      const staff = await loadStaff(a.tenantId, id);
      if (!staff) return error('Staff record not found.', 404);
      if (!(await authorizeRecord(a.tenantId, a.membership, 'staff-profile', 'read', staff))) return error('Permission denied.', 403);
      return json({ staff });
    } catch (cause) { return apiFailure(cause, 'Unable to retrieve the staff profile.', { logLabel: 'staff.get failed' }); }
  }],
  'PUT /api/staff/:staffId': [requireAuth(), async (ctx: any) => {
    try {
      const a = await access(ctx); if (a.response) return a.response;
      const id = String(ctx.params.staffId || '');
      const old = await loadStaff(a.tenantId, id);
      if (!old) return error('Staff record not found.', 404);
      if (!(await authorizeRecord(a.tenantId, a.membership, 'staff-profile', 'update', old))) return error('Permission denied.', 403);
      if (!isRecord(ctx.body)) return error('A staff profile update is required.', 400);
      const b = ctx.body;
      const allowed = ['firstName','lastName','otherNames','workEmail','workPhone','employmentType','departmentNodeId','jobTitle','startDate','endDate','expectedVersion','reason'];
      if (Object.keys(b).some(k => !allowed.includes(k))) return error('Only editable staff profile fields may be submitted.', 400);
      if (b.expectedVersion !== old.version) return error('Staff record changed; reload before saving.', 409);
      const firstName = b.firstName === undefined ? old.firstName : typeof b.firstName === 'string' ? b.firstName.trim() : '';
      const lastName = b.lastName === undefined ? old.lastName : typeof b.lastName === 'string' ? b.lastName.trim() : '';
      const otherNames = b.otherNames === undefined ? old.otherNames : optionalText(b.otherNames, 120);
      const workEmail = b.workEmail === undefined ? old.workEmail : optionalText(b.workEmail, 320);
      const workPhone = b.workPhone === undefined ? old.workPhone : optionalText(b.workPhone, 40);
      const jobTitle = b.jobTitle === undefined ? old.jobTitle : optionalText(b.jobTitle, 120);
      const employmentType = (b.employmentType === undefined ? old.employmentType : b.employmentType) as EmploymentType;
      const departmentNodeId = b.departmentNodeId === undefined ? old.departmentNodeId : b.departmentNodeId || null;
      const startDate = b.startDate === undefined ? old.startDate : b.startDate || null;
      const endDate = b.endDate === undefined ? old.endDate : b.endDate || null;
      const reason = optionalText(b.reason, 1000);
      if (firstName.length < 1 || firstName.length > 100 || lastName.length < 1 || lastName.length > 100 ||
          otherNames === undefined || workEmail === undefined || workPhone === undefined || jobTitle === undefined || reason === undefined ||
          (workEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail)) || !employmentTypes.includes(employmentType) ||
          !validDate(startDate) || !validDate(endDate) || (startDate && endDate && endDate < startDate) ||
          !(await validateDepartment(a.tenantId, old.schoolId, departmentNodeId))) return error('Check the staff profile fields and date range.', 400);
      const timestamp = now();
      const updated: StaffProfile = { ...old, firstName, lastName, otherNames, workEmail, workPhone, employmentType,
        departmentNodeId: typeof departmentNodeId === 'string' ? departmentNodeId : null, jobTitle,
        startDate: typeof startDate === 'string' ? startDate : null, endDate: typeof endDate === 'string' ? endDate : null,
        version: old.version + 1, updatedAt: timestamp, updatedBy: ctx.user.userId };
      const changed = ['employmentType','departmentNodeId','jobTitle','startDate','endDate'].some(k => (old as any)[k] !== (updated as any)[k]);
      const ops: any[] = [
        db.tx.update(profileTable(a.tenantId), [{ id, if: { version: old.version }, record: updated }]),
        db.tx.add(tenantTable('audit_events', a.tenantId), [auditRecord(a.tenantId, ctx.user.userId, 'staff.updated', id, { schoolId: old.schoolId, version: updated.version })]),
        db.tx.add(tenantTable('domain_events', a.tenantId), [domainEvent(a.tenantId, ctx.user.userId, 'staff.updated', 'staff-profile', id, { schoolId: old.schoolId, version: updated.version }, crypto.randomUUID(), timestamp)]),
      ];
      if (changed) ops.push(db.tx.add(historyTable(a.tenantId), [historyRecord(a.tenantId, updated, ctx.user.userId, 'corrected', {
        employmentType: old.employmentType, departmentNodeId: old.departmentNodeId, jobTitle: old.jobTitle, startDate: old.startDate, endDate: old.endDate,
      }, { employmentType, departmentNodeId: updated.departmentNodeId, jobTitle, startDate: updated.startDate, endDate: updated.endDate }, reason, timestamp.slice(0, 10))]));
      await db.transact(ops);
      return json({ staff: updated });
    } catch (cause) { return apiFailure(cause, 'Unable to update the staff profile.', { logLabel: 'staff.update failed' }); }
  }],
  'POST /api/staff/:staffId/status': [requireAuth(), async (ctx: any) => {
    try {
      const a = await access(ctx); if (a.response) return a.response;
      const id = String(ctx.params.staffId || '');
      const old = await loadStaff(a.tenantId, id);
      if (!old) return error('Staff record not found.', 404);
      if (!(await authorizeRecord(a.tenantId, a.membership, 'staff-profile', 'update', old))) return error('Permission denied.', 403);
      const b = ctx.body || {};
      if (!statuses.includes(b.status) || b.expectedVersion !== old.version) return error('Choose a valid employment status and reload the current record.', 400);
      const allowed: Record<StaffStatus, StaffStatus[]> = {
        pending: ['active','suspended'], active: ['on_leave','suspended','terminated','retired'],
        on_leave: ['active','suspended','terminated'], suspended: ['active','terminated'], terminated: [], retired: [],
      };
      if (b.status === old.employmentStatus) return json({ staff: old });
      if (!allowed[old.employmentStatus].includes(b.status)) return error('This employment status transition is not permitted.', 409);
      const reason = optionalText(b.reason, 1000);
      const effectiveOn = b.effectiveOn || now().slice(0, 10);
      if (reason === undefined || !validDate(effectiveOn)) return error('Provide a valid effective date and reason.', 400);
      const timestamp = now();
      const updated = { ...old, employmentStatus: b.status as StaffStatus, endDate: ['terminated','retired'].includes(b.status) ? effectiveOn : old.endDate,
        version: old.version + 1, updatedAt: timestamp, updatedBy: ctx.user.userId };
      const changeType: Record<StaffStatus, string> = { pending: 'corrected', active: 'reinstated', on_leave: 'leave_started', suspended: 'suspended', terminated: 'terminated', retired: 'retired' };
      await db.transact([
        db.tx.update(profileTable(a.tenantId), [{ id, if: { version: old.version }, record: updated }]),
        db.tx.add(historyTable(a.tenantId), [historyRecord(a.tenantId, updated, ctx.user.userId, changeType[b.status], { employmentStatus: old.employmentStatus, endDate: old.endDate }, { employmentStatus: updated.employmentStatus, endDate: updated.endDate }, reason, effectiveOn)]),
        db.tx.add(tenantTable('audit_events', a.tenantId), [auditRecord(a.tenantId, ctx.user.userId, 'staff.status-changed', id, { from: old.employmentStatus, to: b.status, effectiveOn })]),
        db.tx.add(tenantTable('domain_events', a.tenantId), [domainEvent(a.tenantId, ctx.user.userId, 'staff.status-changed', 'staff-profile', id, { from: old.employmentStatus, to: b.status }, crypto.randomUUID(), timestamp)]),
      ]);
      return json({ staff: updated });
    } catch (cause) { return apiFailure(cause, 'Unable to change employment status.', { logLabel: 'staff.status failed' }); }
  }],
  'GET /api/staff/:staffId/history': [requireAuth(), async (ctx: any) => {
    try {
      const a = await access(ctx); if (a.response) return a.response;
      const staff = await loadStaff(a.tenantId, String(ctx.params.staffId || ''));
      if (!staff) return error('Staff record not found.', 404);
      if (!(await authorizeRecord(a.tenantId, a.membership, 'staff-employment-history', 'read', staff))) return error('Permission denied.', 403);
      const page = await db.list<Record<string, any>>(historyTable(a.tenantId), { limit: 100 });
      return json({ items: page.items.filter(x => x.tenantId === a.tenantId && x.schoolId === staff.schoolId && x.staffId === staff.id).sort((x,y) => String(y.effectiveOn).localeCompare(String(x.effectiveOn))) });
    } catch (cause) { return apiFailure(cause, 'Unable to retrieve employment history.', { logLabel: 'staff.history failed' }); }
  }],
};
