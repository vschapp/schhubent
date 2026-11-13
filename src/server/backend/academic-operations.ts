// @ts-nocheck -- imported School Hub source, kept as-is
import { db, error, json, requireAuth } from '@/server/appdeploy-sdk';
import {
  apiFailure, auditRecord, authorize, authorizeRecord, domainEvent, hasSchoolScope,
  isRecord, isValidRecordId, tenantAccessFromRequest, tenantTable,
} from './platform';

const validId = isValidRecordId;
const now = () => new Date().toISOString();
const attendanceStates = ['present', 'absent', 'late', 'excused', 'sick', 'authorised_absence'];

export async function access(ctx: any) {
  const result = await tenantAccessFromRequest(ctx, {
    allowBodyFallback: false,
    requireTenantId: true,
    maxTenantLength: 128,
    invalidTenantMessage: 'A valid tenantId query parameter is required.',
    membershipMessage: 'Tenant membership not found or access denied.',
  });
  return result.ok
    ? { tenantId: result.tenantId, membership: result.membership, response: null }
    : { tenantId: '', membership: null, response: result.response };
}

export async function activeSchool(tenantId: string, schoolId: string) {
  const [school] = await db.get<Record<string, any>>(tenantTable('schools', tenantId), [schoolId], { consistent: true });
  return Boolean(school && school.id === schoolId && school.tenantId === tenantId && school.status === 'active');
}

export async function academicRecord(tenantId: string, schoolId: string, table: string, id: string) {
  const [record] = await db.get<Record<string, any>>(tenantTable(table, tenantId), [id], { consistent: true });
  return record && record.id === id && record.tenantId === tenantId &&
    record.schoolId === schoolId && record.status === 'active' ? record : null;
}

export function validDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const academicOperationsRoutes = {
  'GET /api/academic/teaching-assignments': [
    requireAuth(),
    async (ctx: any) => {
      try {
        const a = await access(ctx);
        if (a.response) return a.response;
        const schoolId = String(ctx.query.schoolId || '');
        if (!validId(schoolId) || !(await activeSchool(a.tenantId, schoolId))) return error('Choose an active school in this workspace.', 400);
        if (!hasSchoolScope(a.membership, schoolId)) return error('This school is outside your authorised scope.', 403);
        const limit = ctx.query.limit === undefined ? 50 : Number(ctx.query.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) return error('limit must be an integer from 1 to 100.', 400);
        const page = await db.list<Record<string, any>>(tenantTable('teaching_assignments', a.tenantId), {
          limit,
          ...(ctx.query.nextToken ? { nextToken: ctx.query.nextToken } : {}),
        });
        const items = [];
        for (const item of page.items) {
          if (item.tenantId !== a.tenantId || item.schoolId !== schoolId || item.status !== 'active') continue;
          if (await authorizeRecord(a.tenantId, a.membership, 'teaching-assignment', 'read', item)) items.push(item);
        }
        return json({ items, nextToken: page.nextToken || null, pageSize: limit });
      } catch (cause) {
        return apiFailure(cause, 'Unable to retrieve teaching assignments.', { logLabel: 'academic.teaching.list failed' });
      }
    },
  ],
  'POST /api/academic/teaching-assignments': [
    requireAuth(),
    async (ctx: any) => {
      try {
        const a = await access(ctx);
        if (a.response) return a.response;
        if (!isRecord(ctx.body)) return error('A teaching assignment is required.', 400);
        const body = ctx.body;
        const allowed = ['schoolId', 'teacherUserId', 'classId', 'subjectId', 'academicYearId', 'termId'];
        if (Object.keys(body).some(key => !allowed.includes(key))) return error('Submit only the registered teaching assignment fields. IDs are validated against the active workspace.');
        const { schoolId, teacherUserId, classId, subjectId, academicYearId, termId } = body;
        if (![schoolId, teacherUserId, classId, subjectId, academicYearId].every(validId) ||
            (termId !== undefined && termId !== null && !validId(termId))) return error('Choose valid school, teacher, class, subject and academic year records.', 400);
        if (!(await activeSchool(a.tenantId, String(schoolId))) || !hasSchoolScope(a.membership, schoolId)) return error('The selected school is unavailable or outside your authorised scope.', 403);
        const context = { schoolId, classId, subjectId, academicYearId, termId: termId || null };
        if (!(await authorize(a.tenantId, a.membership, 'teaching-assignment', 'create', context))) return error('Permission denied for teaching assignments.', 403);
        const [teacher] = await db.get<Record<string, any>>(tenantTable('tenant_memberships', a.tenantId), [String(teacherUserId)], { consistent: true });
        if (!teacher || teacher.userId !== teacherUserId || teacher.tenantId !== a.tenantId || teacher.status !== 'active') return error('The selected teacher must have an active membership in this workspace.', 404);
        const [classRecord, subjectRecord, yearRecord] = await Promise.all([
          academicRecord(a.tenantId, String(schoolId), 'class_groups', String(classId)),
          academicRecord(a.tenantId, String(schoolId), 'subjects', String(subjectId)),
          academicRecord(a.tenantId, String(schoolId), 'academic_years', String(academicYearId)),
        ]);
        if (!classRecord || !subjectRecord || !yearRecord) return error('The class, subject and academic year must be active records in the selected school.', 400);
        if (termId) {
          const term = await academicRecord(a.tenantId, String(schoolId), 'academic_terms', String(termId));
          if (!term || term.academicYearId !== academicYearId) return error('The selected term must belong to the selected academic year.', 400);
        }
        const existing = await db.list<Record<string, any>>(tenantTable('teaching_assignments', a.tenantId), { limit: 100 });
        if (existing.items.some(item => item.tenantId === a.tenantId && item.schoolId === schoolId &&
          item.teacherUserId === teacherUserId && item.classId === classId && item.subjectId === subjectId &&
          item.academicYearId === academicYearId && (item.termId || null) === (termId || null) && item.status === 'active')) {
          return error('This teaching assignment already exists.', 409);
        }
        const timestamp = now();
        const assignment = {
          id: crypto.randomUUID(), tenantId: a.tenantId, schoolId, teacherUserId, classId,
          subjectId, academicYearId, termId: termId || null, status: 'active', version: 1,
          createdAt: timestamp, createdBy: ctx.user.userId, updatedAt: timestamp, updatedBy: ctx.user.userId,
        };
        if (!(await authorizeRecord(a.tenantId, a.membership, 'teaching-assignment', 'create', assignment))) return error('Permission denied for this teaching assignment scope.', 403);
        await db.transact([
          db.tx.add(tenantTable('teaching_assignments', a.tenantId), [assignment]),
          db.tx.add(tenantTable('audit_events', a.tenantId), [auditRecord(a.tenantId, ctx.user.userId, 'teaching-assignment.created', 'teaching-assignment', { schoolId, teacherUserId, classId, subjectId, academicYearId, termId: termId || null })]),
          db.tx.add(tenantTable('domain_events', a.tenantId), [domainEvent(a.tenantId, ctx.user.userId, 'teaching-assignment.created', 'teaching-assignment', assignment.id, { schoolId, teacherUserId, classId, subjectId, academicYearId, termId: termId || null }, crypto.randomUUID(), timestamp)]),
        ]);
        return json({ item: assignment }, 201);
      } catch (cause) {
        return apiFailure(cause, 'Unable to save the teaching assignment.', { logLabel: 'academic.teaching.create failed' });
      }
    },
  ],
  'GET /api/attendance/sessions': [
    requireAuth(),
    async (ctx: any) => {
      try {
        const a = await access(ctx);
        if (a.response) return a.response;
        const schoolId = String(ctx.query.schoolId || '');
        if (!validId(schoolId) || !(await activeSchool(a.tenantId, schoolId))) return error('Choose an active school in this workspace.', 400);
        if (!hasSchoolScope(a.membership, schoolId)) return error('This school is outside your authorised scope.', 403);
        const limit = ctx.query.limit === undefined ? 50 : Number(ctx.query.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) return error('limit must be an integer from 1 to 100.', 400);
        const page = await db.list<Record<string, any>>(tenantTable('attendance_sessions', a.tenantId), {
          limit, ...(ctx.query.nextToken ? { nextToken: ctx.query.nextToken } : {}),
        });
        const items = [];
        for (const item of page.items) {
          if (item.tenantId !== a.tenantId || item.schoolId !== schoolId || item.status === 'cancelled') continue;
          if (await authorizeRecord(a.tenantId, a.membership, 'attendance-register', 'read', item)) items.push(item);
        }
        return json({ items, nextToken: page.nextToken || null, pageSize: limit });
      } catch (cause) {
        return apiFailure(cause, 'Unable to retrieve attendance sessions.', { logLabel: 'attendance.sessions.list failed' });
      }
    },
  ],
  'POST /api/attendance/sessions': [
    requireAuth(),
    async (ctx: any) => {
      try {
        const a = await access(ctx);
        if (a.response) return a.response;
        if (!isRecord(ctx.body)) return error('An attendance session is required.', 400);
        const body = ctx.body;
        const allowed = ['schoolId', 'classId', 'sectionId', 'subjectId', 'academicYearId', 'termId', 'sessionDate', 'sessionType', 'periodLabel'];
        if (Object.keys(body).some(key => !allowed.includes(key))) return error('Submit only registered attendance session fields.', 400);
        const { schoolId, classId, sectionId, subjectId, academicYearId, termId, sessionDate } = body;
        if (![schoolId, classId, academicYearId].every(validId) || !validDate(sessionDate)) return error('Choose a valid school, class, academic year and session date.', 400);
        const configPage = await db.list<Record<string, any>>(tenantTable('platform_configurations', a.tenantId), { limit: 100 });
        const backdateSetting = configPage.items.find(item => item.tenantId === a.tenantId && item.key === 'attendance.maxBackdateDays');
        const maxBackdateDays = Number.isInteger(backdateSetting?.value) ? Number(backdateSetting.value) : 3650;
        const today = now().slice(0, 10);
        const earliestAllowed = new Date(Date.now() - maxBackdateDays * 86400000).toISOString().slice(0, 10);
        if (sessionDate > today || sessionDate < earliestAllowed) return error('The attendance date is outside the centrally configured backdating window.', 409);
        if (!(await activeSchool(a.tenantId, String(schoolId))) || !hasSchoolScope(a.membership, schoolId)) return error('The selected school is unavailable or outside your authorised scope.', 403);
        const sessionType = body.sessionType === undefined ? 'class' : body.sessionType;
        if (!['class', 'assembly', 'event', 'examination', 'other'].includes(String(sessionType))) return error('Unsupported attendance session type.', 400);
        const periodLabel = body.periodLabel === undefined || body.periodLabel === null ? null : String(body.periodLabel).trim();
        if (periodLabel && periodLabel.length > 60) return error('Period label must not exceed 60 characters.', 400);
        const context = { schoolId, classId, subjectId: subjectId || null, academicYearId, termId: termId || null };
        if (!(await authorize(a.tenantId, a.membership, 'attendance-register', 'create', context))) return error('Permission denied for attendance registers.', 403);
        const [classRecord, yearRecord] = await Promise.all([
          academicRecord(a.tenantId, String(schoolId), 'class_groups', String(classId)),
          academicRecord(a.tenantId, String(schoolId), 'academic_years', String(academicYearId)),
        ]);
        if (!classRecord || !yearRecord) return error('The class and academic year must be active records in the selected school.', 400);
        if (sectionId && (!validId(sectionId) || !(await academicRecord(a.tenantId, String(schoolId), 'sections', String(sectionId))))) return error('Choose an active section in the selected school.', 400);
        if (subjectId && (!validId(subjectId) || !(await academicRecord(a.tenantId, String(schoolId), 'subjects', String(subjectId))))) return error('Choose an active subject in the selected school.', 400);
        if (termId) {
          const term = await academicRecord(a.tenantId, String(schoolId), 'academic_terms', String(termId));
          if (!term || term.academicYearId !== academicYearId) return error('The selected term must belong to the selected academic year.', 400);
        }
        const timestamp = now();
        const session = {
          id: crypto.randomUUID(), tenantId: a.tenantId, schoolId, classId, sectionId: sectionId || null,
          subjectId: subjectId || null, academicYearId, termId: termId || null, sessionDate,
          sessionType, periodLabel, status: 'open', openedBy: ctx.user.userId, submittedAt: null,
          lockedAt: null, version: 1, createdAt: timestamp,
        };
        if (!(await authorizeRecord(a.tenantId, a.membership, 'attendance-register', 'create', session))) return error('Permission denied for this attendance scope.', 403);
        await db.transact([
          db.tx.add(tenantTable('attendance_sessions', a.tenantId), [session]),
          db.tx.add(tenantTable('audit_events', a.tenantId), [auditRecord(a.tenantId, ctx.user.userId, 'attendance-session.created', 'attendance-session', { schoolId, classId, sessionDate, sessionType })]),
          db.tx.add(tenantTable('domain_events', a.tenantId), [domainEvent(a.tenantId, ctx.user.userId, 'attendance-session.created', 'attendance-session', session.id, { schoolId, classId, sessionDate, sessionType }, crypto.randomUUID(), timestamp)]),
        ]);
        return json({ item: session }, 201);
      } catch (cause) {
        return apiFailure(cause, 'Unable to create the attendance session.', { logLabel: 'attendance.sessions.create failed' });
      }
    },
  ],
  'POST /api/attendance/sessions/:sessionId/records': [
    requireAuth(),
    async (ctx: any) => {
      try {
        const a = await access(ctx);
        if (a.response) return a.response;
        const sessionId = String(ctx.params.sessionId || '');
        if (!validId(sessionId) || !isRecord(ctx.body) || !Array.isArray(ctx.body.records) || ctx.body.records.length < 1 || ctx.body.records.length > 100) return error('Submit between 1 and 100 attendance records for a valid session.', 400);
        const [session] = await db.get<Record<string, any>>(tenantTable('attendance_sessions', a.tenantId), [sessionId], { consistent: true });
        if (!session || session.id !== sessionId || session.tenantId !== a.tenantId || session.status !== 'open') return error('The attendance session is unavailable or no longer open.', 404);
        if (!(await authorizeRecord(a.tenantId, a.membership, 'attendance-register', 'update', session))) return error('Permission denied for this attendance session.', 403);
        const existingPage = await db.list<Record<string, any>>(tenantTable('attendance_records', a.tenantId), { limit: 1000 });
        if (existingPage.nextToken) return error('Attendance duplicate validation requires a complete bounded page. Narrow the register before retrying.', 503);
        const alreadyMarked = new Set(existingPage.items
          .filter(item => item.tenantId === a.tenantId && item.sessionId === sessionId)
          .map(item => String(item.studentId)));
        const seen = new Set<string>();
        const entries = [];
        for (const raw of ctx.body.records) {
          if (!isRecord(raw) || !validId(raw.studentId) || !attendanceStates.includes(String(raw.status)) || seen.has(String(raw.studentId))) return error('Each student must have one valid attendance status per session.', 400);
          if (alreadyMarked.has(String(raw.studentId))) return error('An attendance mark already exists for this student in the selected session. Use the controlled correction workflow to change it.', 409);
          seen.add(String(raw.studentId));
          const [student] = await db.get<Record<string, any>>(tenantTable('students', a.tenantId), [String(raw.studentId)], { consistent: true });
          if (!student || student.id !== raw.studentId || student.tenantId !== a.tenantId || student.schoolId !== session.schoolId || student.status !== 'active' || student.classId !== session.classId || (session.sectionId && student.sectionId !== session.sectionId)) return error('Every student must be active and enrolled in this session class and section.', 400);
          if (!(await authorizeRecord(a.tenantId, a.membership, 'attendance-entry', 'create', { ...student, classId: session.classId, subjectId: session.subjectId, academicYearId: session.academicYearId, termId: session.termId }))) return error('Permission denied for one or more student attendance records.', 403);
          const remarks = raw.remarks === undefined || raw.remarks === null ? null : String(raw.remarks).trim();
          if (remarks && remarks.length > 500) return error('Attendance remarks must not exceed 500 characters.', 400);
          entries.push({
            id: crypto.randomUUID(), tenantId: a.tenantId, schoolId: session.schoolId, sessionId,
            studentId: student.id, attendanceStatus: raw.status, checkInAt: null, remarks,
            markedBy: ctx.user.userId, markedAt: now(), correctedFrom: null, correctionReason: null, version: 1,
          });
        }
        const timestamp = now();
        const operations = [
          db.tx.add(tenantTable('attendance_records', a.tenantId), entries),
          db.tx.add(tenantTable('audit_events', a.tenantId), [auditRecord(a.tenantId, ctx.user.userId, 'attendance-records.marked', 'attendance-session', { sessionId, count: entries.length, schoolId: session.schoolId })]),
          db.tx.add(tenantTable('domain_events', a.tenantId), [domainEvent(a.tenantId, ctx.user.userId, 'attendance-records.marked', 'attendance-session', sessionId, { schoolId: session.schoolId, count: entries.length }, crypto.randomUUID(), timestamp)]),
        ];
        await db.transact(operations);
        return json({ items: entries, count: entries.length }, 201);
      } catch (cause) {
        return apiFailure(cause, 'Unable to save attendance records. Reload the register before retrying.', { logLabel: 'attendance.records.create failed' });
      }
    },
  ],
  'GET /api/attendance/sessions/:sessionId/records': [
    requireAuth(),
    async (ctx: any) => {
      try {
        const a = await access(ctx); if (a.response) return a.response;
        const sessionId = String(ctx.params.sessionId || ''), limit = ctx.query.limit === undefined ? 50 : Number(ctx.query.limit);
        if (!validId(sessionId) || !Number.isInteger(limit) || limit < 1 || limit > 100) return error('A valid session and page size from 1 to 100 are required.', 400);
        const [session] = await db.get<Record<string, any>>(tenantTable('attendance_sessions', a.tenantId), [sessionId], { consistent: true });
        if (!session || session.tenantId !== a.tenantId || !(await authorizeRecord(a.tenantId, a.membership, 'attendance-register', 'read', session))) return error('Attendance session not found or access denied.', 404);
        const page = await db.list<Record<string, any>>(tenantTable('attendance_records', a.tenantId), { limit, ...(ctx.query.nextToken ? { nextToken: ctx.query.nextToken } : {}) });
        const items = [];
        for (const record of page.items) if (record.tenantId === a.tenantId && record.sessionId === sessionId && await authorizeRecord(a.tenantId, a.membership, 'attendance-entry', 'read', { ...session, ...record })) items.push(record);
        return json({ items, nextToken: page.nextToken || null, pageSize: limit });
      } catch (cause) { return apiFailure(cause, 'Unable to retrieve attendance records.'); }
    },
  ],
  'POST /api/attendance/records/:recordId/corrections': [
    requireAuth(),
    async (ctx: any) => {
      try {
        const a = await access(ctx); if (a.response) return a.response;
        const id = String(ctx.params.recordId || ''), body = ctx.body;
        if (!validId(id) || !isRecord(body) || !Number.isInteger(body.expectedVersion) || !attendanceStates.includes(String(body.proposedStatus)) || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500) return error('A proposed attendance status, reason and expectedVersion are required.', 400);
        const [record] = await db.get<Record<string, any>>(tenantTable('attendance_records', a.tenantId), [id], { consistent: true });
        if (!record || record.tenantId !== a.tenantId || record.version !== body.expectedVersion) return error('Attendance record is unavailable or has changed.', 409);
        const [session] = await db.get<Record<string, any>>(tenantTable('attendance_sessions', a.tenantId), [record.sessionId], { consistent: true });
        if (!session || session.tenantId !== a.tenantId || !(await authorizeRecord(a.tenantId, a.membership, 'attendance-register', 'update', session))) return error('Permission denied for attendance correction.', 403);
        const [setting] = await db.get<Record<string, any>>(tenantTable('platform_configurations', a.tenantId), ['attendance.correctionApproval'], { consistent: true });
        const requiresApproval = setting?.value !== false;
        const timestamp = now();
        const request = { id: crypto.randomUUID(), tenantId: a.tenantId, schoolId: record.schoolId, sessionId: record.sessionId, attendanceRecordId: id, originalStatus: record.attendanceStatus, proposedStatus: body.proposedStatus, reason: body.reason.trim(), status: requiresApproval ? 'pending' : 'approved', requestedBy: ctx.user.userId, requestedAt: timestamp, reviewedBy: requiresApproval ? null : ctx.user.userId, reviewedAt: requiresApproval ? null : timestamp, expectedRecordVersion: record.version, version: 1 };
        const operations = [db.tx.add(tenantTable('attendance_correction_requests', a.tenantId), [request]), db.tx.add(tenantTable('audit_events', a.tenantId), [auditRecord(a.tenantId, ctx.user.userId, 'attendance-correction.requested', 'attendance-record', { recordId: id, status: request.status })]), db.tx.add(tenantTable('domain_events', a.tenantId), [domainEvent(a.tenantId, ctx.user.userId, 'attendance-correction.requested', 'attendance-record', id, { correctionId: request.id, status: request.status }, crypto.randomUUID(), timestamp)])];
        if (!requiresApproval) operations.push(db.tx.update(tenantTable('attendance_records', a.tenantId), [{ id, if: { version: record.version }, record: { ...record, attendanceStatus: body.proposedStatus, correctedFrom: record.attendanceStatus, correctionReason: body.reason.trim(), correctedBy: ctx.user.userId, correctedAt: timestamp, version: Number(record.version) + 1 } }]));
        await db.transact(operations);
        return json({ item: request }, 201);
      } catch (cause) { return apiFailure(cause, 'Unable to submit attendance correction.'); }
    },
  ],
  'GET /api/attendance/corrections': [
    requireAuth(),
    async (ctx: any) => {
      try {
        const a = await access(ctx); if (a.response) return a.response;
        const schoolId = String(ctx.query.schoolId || ''), limit = ctx.query.limit === undefined ? 50 : Number(ctx.query.limit);
        if (!validId(schoolId) || !hasSchoolScope(a.membership, schoolId) || !Number.isInteger(limit) || limit < 1 || limit > 100) return error('Choose an authorised school and page size from 1 to 100.', 400);
        const page = await db.list<Record<string, any>>(tenantTable('attendance_correction_requests', a.tenantId), { limit, ...(ctx.query.nextToken ? { nextToken: ctx.query.nextToken } : {}) });
        const items = [];
        for (const item of page.items) if (item.tenantId === a.tenantId && item.schoolId === schoolId && await authorizeRecord(a.tenantId, a.membership, 'attendance-register', 'read', item)) items.push(item);
        return json({ items, nextToken: page.nextToken || null, pageSize: limit });
      } catch (cause) { return apiFailure(cause, 'Unable to retrieve attendance corrections.'); }
    },
  ],
  'POST /api/attendance/corrections/:correctionId/review': [
    requireAuth(),
    async (ctx: any) => {
      try {
        const a = await access(ctx); if (a.response) return a.response;
        const id = String(ctx.params.correctionId || ''), body = ctx.body;
        if (!validId(id) || !isRecord(body) || !Number.isInteger(body.expectedVersion) || !['approve', 'reject'].includes(String(body.decision))) return error('A valid attendance correction decision and expectedVersion are required.', 400);
        const [request] = await db.get<Record<string, any>>(tenantTable('attendance_correction_requests', a.tenantId), [id], { consistent: true });
        if (!request || request.tenantId !== a.tenantId || request.status !== 'pending' || request.version !== body.expectedVersion || request.requestedBy === ctx.user.userId) return error('Correction is not pending, is stale, or violates maker-checker separation.', 409);
        const [record] = await db.get<Record<string, any>>(tenantTable('attendance_records', a.tenantId), [request.attendanceRecordId], { consistent: true });
        const [session] = await db.get<Record<string, any>>(tenantTable('attendance_sessions', a.tenantId), [request.sessionId], { consistent: true });
        if (!record || !session || record.version !== request.expectedRecordVersion || !(await authorizeRecord(a.tenantId, a.membership, 'attendance-register', 'moderate', session))) return error('Attendance record changed or permission denied.', 409);
        const timestamp = now(), next = { ...request, status: body.decision === 'approve' ? 'approved' : 'rejected', reviewedBy: ctx.user.userId, reviewedAt: timestamp, version: Number(request.version) + 1 };
        const operations = [db.tx.update(tenantTable('attendance_correction_requests', a.tenantId), [{ id, if: { version: request.version, status: 'pending' }, record: next }])];
        if (body.decision === 'approve') operations.push(db.tx.update(tenantTable('attendance_records', a.tenantId), [{ id: record.id, if: { version: record.version }, record: { ...record, attendanceStatus: request.proposedStatus, correctedFrom: record.attendanceStatus, correctionReason: request.reason, correctedBy: ctx.user.userId, correctedAt: timestamp, version: Number(record.version) + 1 } }]));
        operations.push(db.tx.add(tenantTable('audit_events', a.tenantId), [auditRecord(a.tenantId, ctx.user.userId, 'attendance-correction.' + body.decision, 'attendance-record', { recordId: record.id, correctionId: id })]));
        operations.push(db.tx.add(tenantTable('domain_events', a.tenantId), [domainEvent(a.tenantId, ctx.user.userId, 'attendance-correction.' + body.decision, 'attendance-record', record.id, { correctionId: id }, crypto.randomUUID(), timestamp)]));
        await db.transact(operations); return json({ item: next });
      } catch (cause) { return apiFailure(cause, 'Unable to review attendance correction.'); }
    },
  ],
};

function validTime(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
}
function minutes(value: string) {
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
}
function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}
function datesOverlap(aFrom: string | null, aUntil: string | null, bFrom: string | null, bUntil: string | null) {
  return (!aUntil || !bFrom || aUntil >= bFrom) && (!bUntil || !aFrom || bUntil >= aFrom);
}
function timetableInput(body: any) {
  if (!isRecord(body)) return null;
  const allowed = ['schoolId', 'academicYearId', 'termId', 'classId', 'sectionId', 'subjectId', 'teacherUserId', 'weekday', 'periodNo', 'startsAt', 'endsAt', 'room', 'effectiveFrom', 'effectiveUntil'];
  if (Object.keys(body).some(key => !allowed.includes(key))) return null;
  const { schoolId, academicYearId, termId, classId, sectionId, subjectId, teacherUserId, weekday, periodNo, startsAt, endsAt, room, effectiveFrom, effectiveUntil } = body;
  if (![schoolId, academicYearId, classId, subjectId, teacherUserId].every(validId) ||
      (termId != null && !validId(termId)) || (sectionId != null && !validId(sectionId)) ||
      !Number.isInteger(weekday) || weekday < 1 || weekday > 7 ||
      !Number.isInteger(periodNo) || periodNo < 1 || periodNo > 30 ||
      !validTime(startsAt) || !validTime(endsAt) || minutes(startsAt) >= minutes(endsAt)) return null;
  if ((effectiveFrom != null && !validDate(effectiveFrom)) || (effectiveUntil != null && !validDate(effectiveUntil)) ||
      (effectiveFrom && effectiveUntil && effectiveUntil < effectiveFrom)) return null;
  const cleanRoom = room == null ? null : String(room).trim();
  if (cleanRoom && cleanRoom.length > 80) return null;
  return { schoolId, academicYearId, termId: termId || null, classId, sectionId: sectionId || null,
    subjectId, teacherUserId, weekday, periodNo, startsAt, endsAt, room: cleanRoom || null,
    effectiveFrom: effectiveFrom || null, effectiveUntil: effectiveUntil || null };
}
async function timetableClash(tenantId: string, candidate: Record<string, any>, excludeId?: string) {
  const page = await db.list<Record<string, any>>(tenantTable('timetable_entries', tenantId), { limit: 1000 });
  if (page.nextToken) throw new Error('Timetable conflict check requires pagination; the full clash check cannot safely complete.');
  const start = minutes(candidate.startsAt), end = minutes(candidate.endsAt);
  return page.items.find(item => item.id !== excludeId && item.tenantId === tenantId &&
    item.schoolId === candidate.schoolId && item.academicYearId === candidate.academicYearId &&
    item.status === 'active' && item.weekday === candidate.weekday &&
    (!candidate.termId || !item.termId || item.termId === candidate.termId) &&
    datesOverlap(candidate.effectiveFrom, candidate.effectiveUntil, item.effectiveFrom || null, item.effectiveUntil || null) &&
    rangesOverlap(start, end, minutes(item.startsAt), minutes(item.endsAt)) &&
    ((item.classId === candidate.classId && (item.sectionId || null) === (candidate.sectionId || null)) ||
     item.teacherUserId === candidate.teacherUserId ||
     Boolean(candidate.room && item.room && candidate.room.toLowerCase() === String(item.room).toLowerCase())));
}
async function validateTimetableReferences(tenantId: string, input: Record<string, any>) {
  const [schoolOk, classRecord, subjectRecord, yearRecord, teacherRows] = await Promise.all([
    activeSchool(tenantId, String(input.schoolId)),
    academicRecord(tenantId, String(input.schoolId), 'class_groups', String(input.classId)),
    academicRecord(tenantId, String(input.schoolId), 'subjects', String(input.subjectId)),
    academicRecord(tenantId, String(input.schoolId), 'academic_years', String(input.academicYearId)),
    db.get<Record<string, any>>(tenantTable('tenant_memberships', tenantId), [String(input.teacherUserId)], { consistent: true }),
  ]);
  const teacher = teacherRows[0];
  if (!schoolOk || !classRecord || !subjectRecord || !yearRecord ||
      !teacher || teacher.userId !== input.teacherUserId || teacher.tenantId !== tenantId || teacher.status !== 'active') return false;
  if (input.sectionId) {
    const section = await academicRecord(tenantId, String(input.schoolId), 'sections', String(input.sectionId));
    if (!section || section.classId !== input.classId) return false;
  }
  if (input.termId) {
    const term = await academicRecord(tenantId, String(input.schoolId), 'academic_terms', String(input.termId));
    if (!term || term.academicYearId !== input.academicYearId) return false;
  }
  return true;
}
export const timetableRoutes = {
  'GET /api/timetable/entries': [requireAuth(), async (ctx: any) => {
    try {
      const a = await access(ctx);
      if (a.response) return a.response;
      const schoolId = String(ctx.query.schoolId || '');
      if (!validId(schoolId) || !(await activeSchool(a.tenantId, schoolId))) return error('Choose an active school in this workspace.', 400);
      if (!hasSchoolScope(a.membership, schoolId)) return error('This school is outside your authorised scope.', 403);
      const limit = ctx.query.limit === undefined ? 50 : Number(ctx.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) return error('limit must be an integer from 1 to 100.', 400);
      const page = await db.list<Record<string, any>>(tenantTable('timetable_entries', a.tenantId), {
        limit, ...(ctx.query.nextToken ? { nextToken: ctx.query.nextToken } : {}),
      });
      const items = [];
      for (const item of page.items) {
        if (item.tenantId !== a.tenantId || item.schoolId !== schoolId || item.status !== 'active') continue;
        if (ctx.query.academicYearId && item.academicYearId !== ctx.query.academicYearId) continue;
        if (ctx.query.termId && item.termId !== ctx.query.termId) continue;
        if (ctx.query.classId && item.classId !== ctx.query.classId) continue;
        if (ctx.query.teacherUserId && item.teacherUserId !== ctx.query.teacherUserId) continue;
        if (await authorizeRecord(a.tenantId, a.membership, 'timetable', 'read', item)) items.push(item);
      }
      return json({ items, nextToken: page.nextToken || null, pageSize: limit });
    } catch (cause) {
      return apiFailure(cause, 'Unable to retrieve timetable entries.', { logLabel: 'timetable.list failed' });
    }
  }],
  'POST /api/timetable/entries': [requireAuth(), async (ctx: any) => {
    try {
      const a = await access(ctx);
      if (a.response) return a.response;
      const input = timetableInput(ctx.body);
      if (!input) return error('Provide valid school, class, section, subject, teacher, academic period, weekday and time fields.', 400);
      if (!hasSchoolScope(a.membership, input.schoolId)) return error('This school is outside your authorised scope.', 403);
      const context = { schoolId: input.schoolId, classId: input.classId, subjectId: input.subjectId, academicYearId: input.academicYearId, termId: input.termId };
      if (!(await authorize(a.tenantId, a.membership, 'timetable', 'create', context))) return error('Permission denied for timetable management.', 403);
      if (!(await validateTimetableReferences(a.tenantId, input))) return error('The school, class, section, subject, teacher or academic period is not an active compatible record.', 400);
      const assignmentPage = await db.list<Record<string, any>>(tenantTable('teaching_assignments', a.tenantId), { limit: 1000 });
      if (assignmentPage.nextToken) return error('Teaching assignment validation requires a complete page; request cannot be safely validated.', 503);
      const assigned = assignmentPage.items.some(item => item.tenantId === a.tenantId && item.schoolId === input.schoolId &&
        item.teacherUserId === input.teacherUserId && item.classId === input.classId && item.subjectId === input.subjectId &&
        item.academicYearId === input.academicYearId && (!input.termId || !item.termId || item.termId === input.termId) && item.status === 'active');
      if (!assigned) return error('The teacher must have an active assignment for this class, subject and academic period.', 409);
      const record = { id: crypto.randomUUID(), tenantId: a.tenantId, ...input, status: 'active', version: 1,
        createdAt: now(), createdBy: ctx.user.userId, updatedAt: now(), updatedBy: ctx.user.userId };
      if (!(await authorizeRecord(a.tenantId, a.membership, 'timetable', 'create', record))) return error('Permission denied for this timetable scope.', 403);
      const clash = await timetableClash(a.tenantId, record);
      if (clash) return error('Timetable clash: the class/section, teacher or room is already scheduled during this period.', 409);
      const timestamp = now();
      await db.transact([
        db.tx.add(tenantTable('timetable_entries', a.tenantId), [record]),
        db.tx.add(tenantTable('audit_events', a.tenantId), [auditRecord(a.tenantId, ctx.user.userId, 'timetable-entry.created', record.id, { schoolId: input.schoolId, classId: input.classId, subjectId: input.subjectId, teacherUserId: input.teacherUserId, weekday: input.weekday, startsAt: input.startsAt, endsAt: input.endsAt })]),
        db.tx.add(tenantTable('domain_events', a.tenantId), [domainEvent(a.tenantId, ctx.user.userId, 'timetable-entry.created', 'timetable-entry', record.id, { schoolId: input.schoolId, classId: input.classId, subjectId: input.subjectId, teacherUserId: input.teacherUserId }, crypto.randomUUID(), timestamp)]),
      ]);
      return json({ item: record }, 201);
    } catch (cause) {
      return apiFailure(cause, 'Unable to create timetable entry.', { logLabel: 'timetable.create failed' });
    }
  }],
  'PUT /api/timetable/entries/:entryId': [requireAuth(), async (ctx: any) => {
    try {
      const a = await access(ctx);
      if (a.response) return a.response;
      const id = String(ctx.params.entryId || '');
      if (!validId(id) || !isRecord(ctx.body) || !Number.isInteger(ctx.body.expectedVersion)) return error('A valid entry ID and expectedVersion are required.', 400);
      const [old] = await db.get<Record<string, any>>(tenantTable('timetable_entries', a.tenantId), [id], { consistent: true });
      if (!old || old.id !== id || old.tenantId !== a.tenantId || old.status !== 'active') return error('Timetable entry not found.', 404);
      if (!(await authorizeRecord(a.tenantId, a.membership, 'timetable', 'update', old))) return error('Permission denied for this timetable entry.', 403);
      if (ctx.body.expectedVersion !== old.version) return error('Timetable entry changed; reload before saving.', 409);
      const { expectedVersion, ...payload } = ctx.body;
      const input = timetableInput(payload);
      if (!input || input.schoolId !== old.schoolId || input.academicYearId !== old.academicYearId) return error('Invalid update. School and academic year cannot be changed.', 400);
      const context = { schoolId: input.schoolId, classId: input.classId, subjectId: input.subjectId, academicYearId: input.academicYearId, termId: input.termId };
      if (!(await authorize(a.tenantId, a.membership, 'timetable', 'update', context))) return error('Permission denied for timetable management.', 403);
      if (!(await validateTimetableReferences(a.tenantId, input))) return error('The selected academic references are not active and compatible.', 400);
      const assignmentPage = await db.list<Record<string, any>>(tenantTable('teaching_assignments', a.tenantId), { limit: 1000 });
      if (assignmentPage.nextToken || !assignmentPage.items.some(item => item.tenantId === a.tenantId && item.schoolId === input.schoolId &&
        item.teacherUserId === input.teacherUserId && item.classId === input.classId && item.subjectId === input.subjectId &&
        item.academicYearId === input.academicYearId && (!input.termId || !item.termId || item.termId === input.termId) && item.status === 'active')) return error('An active matching teaching assignment is required before this timetable can be saved.', 409);
      const next = { ...old, ...input, version: Number(old.version || 1) + 1, updatedAt: now(), updatedBy: ctx.user.userId };
      const clash = await timetableClash(a.tenantId, next, id);
      if (clash) return error('Timetable clash: the class/section, teacher or room is already scheduled during this period.', 409);
      const timestamp = now();
      await db.transact([
        db.tx.update(tenantTable('timetable_entries', a.tenantId), [{ id, if: { version: old.version, status: 'active' }, record: next }]),
        db.tx.add(tenantTable('audit_events', a.tenantId), [auditRecord(a.tenantId, ctx.user.userId, 'timetable-entry.updated', id, { previousVersion: old.version, version: next.version })]),
        db.tx.add(tenantTable('domain_events', a.tenantId), [domainEvent(a.tenantId, ctx.user.userId, 'timetable-entry.updated', 'timetable-entry', id, { version: next.version }, crypto.randomUUID(), timestamp)]),
      ]);
      return json({ item: next });
    } catch (cause) {
      return apiFailure(cause, 'Unable to update timetable entry.', { logLabel: 'timetable.update failed' });
    }
  }],
  'DELETE /api/timetable/entries/:entryId': [requireAuth(), async (ctx: any) => {
    try {
      const a = await access(ctx);
      if (a.response) return a.response;
      const id = String(ctx.params.entryId || '');
      if (!validId(id) || !isRecord(ctx.body) || !Number.isInteger(ctx.body.expectedVersion)) return error('A valid entry ID and expectedVersion are required.', 400);
      const [old] = await db.get<Record<string, any>>(tenantTable('timetable_entries', a.tenantId), [id], { consistent: true });
      if (!old || old.id !== id || old.tenantId !== a.tenantId || old.status !== 'active') return error('Timetable entry not found.', 404);
      if (!(await authorizeRecord(a.tenantId, a.membership, 'timetable', 'delete', old))) return error('Permission denied for this timetable entry.', 403);
      if (ctx.body.expectedVersion !== old.version) return error('Timetable entry changed; reload before deleting.', 409);
      const timestamp = now();
      const next = { ...old, status: 'inactive', version: Number(old.version || 1) + 1, updatedAt: timestamp, updatedBy: ctx.user.userId };
      await db.transact([
        db.tx.update(tenantTable('timetable_entries', a.tenantId), [{ id, if: { version: old.version, status: 'active' }, record: next }]),
        db.tx.add(tenantTable('audit_events', a.tenantId), [auditRecord(a.tenantId, ctx.user.userId, 'timetable-entry.deactivated', id, { schoolId: old.schoolId, version: next.version })]),
        db.tx.add(tenantTable('domain_events', a.tenantId), [domainEvent(a.tenantId, ctx.user.userId, 'timetable-entry.deactivated', 'timetable-entry', id, { schoolId: old.schoolId }, crypto.randomUUID(), timestamp)]),
      ]);
      return json({ item: next });
    } catch (cause) {
      return apiFailure(cause, 'Unable to deactivate timetable entry.', { logLabel: 'timetable.delete failed' });
    }
  }],
};
