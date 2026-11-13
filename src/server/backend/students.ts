// @ts-nocheck -- imported School Hub source, kept as-is
import { db, error, json, requireAuth } from '@/server/appdeploy-sdk';
import { apiFailure, auditRecord, authorizeRecord, domainEvent, isRecord, isValidRecordId, tenantAccessFromRequest, tenantTable } from './platform';
import { validateStudentAcademicReferences } from './academic';

type StudentRecord = {
  id: string;
  tenantId: string;
  schoolId: string;
  studentNumber: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  dateOfBirth: string | null;
  classId: string | null;
  sectionId: string | null;
  academicYearId: string | null;
  admissionStatus: 'registered' | 'admitted' | 'transferred' | 'withdrawn';
  status: 'active' | 'inactive' | 'deleted';
  ownerUserId: string;
  attributes: { recordType: 'student' };
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  deletedAt?: string;
  deletedBy?: string;
};

const validId = isValidRecordId;
const now = () => new Date().toISOString();

const STUDENT_DATABASE_FAILURES: Record<string, { status: number; message: string }> = {
  AppDatabaseQuotaExceeded: { status: 429, message: 'The database request quota is temporarily exhausted. Please wait before retrying.' },
  AppDatabaseConditionFailed: { status: 409, message: 'The student record changed while this request was being processed. Reload and retry.' },
  AppDatabaseConflict: { status: 409, message: 'The student record changed while this request was being processed. Reload and retry.' },
  AppDatabaseDuplicateId: { status: 409, message: 'A generated record identifier collision occurred. Reload the register and retry.' },
  AppDatabasePartitionAccessDenied: { status: 403, message: 'Access to this tenant data is denied.' },
  AppDatabaseScopeMismatch: { status: 403, message: 'Access to this tenant data is denied.' },
  AppDatabaseInvalidInput: { status: 400, message: 'The student request contains invalid data.' },
  AppDatabaseItemTooLarge: { status: 413, message: 'The student request exceeds the supported database size limits.' },
  AppDatabaseRequestTooLarge: { status: 413, message: 'The student request exceeds the supported database size limits.' },
  AppDatabaseResponseTooLarge: { status: 413, message: 'The student request exceeds the supported database size limits.' },
  AppDatabaseTransactionTooLarge: { status: 413, message: 'The student request exceeds the supported database size limits.' },
  AppDatabaseGatewayUnavailable: { status: 503, message: 'The database could not confirm the result. Reload the student register before retrying; do not resubmit until the outcome has been checked.' },
  AppDatabaseReadIncomplete: { status: 503, message: 'The database could not confirm the result. Reload the student register before retrying; do not resubmit until the outcome has been checked.' },
  AppDatabaseUnknownOutcome: { status: 503, message: 'The database could not confirm the result. Reload the student register before retrying; do not resubmit until the outcome has been checked.' },
};

function validDate(value: unknown) {
  if (value === null || value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && date <= new Date();
}

function validateStudentInput(body: Record<string, unknown>, partial: boolean) {
  const allowed = new Set([
    'schoolId', 'firstName', 'lastName', 'preferredName',
    'dateOfBirth', 'classId', 'sectionId', 'academicYearId', 'admissionStatus',
    ...(partial ? ['expectedVersion'] : []),
  ]);
  if (Object.keys(body).some(key => !allowed.has(key))) return 'Only registered student profile fields may be submitted.';
  if (partial && body.expectedVersion !== undefined && (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1)) return 'expectedVersion must be a positive integer.';
  if (!partial || body.schoolId !== undefined) if (!validId(body.schoolId)) return 'A valid school ID is required.';
  if (!partial || body.firstName !== undefined) {
    if (typeof body.firstName !== 'string' || body.firstName.trim().length < 1 || body.firstName.trim().length > 80) return 'First name must contain 1 to 80 characters.';
  }
  if (!partial || body.lastName !== undefined) {
    if (typeof body.lastName !== 'string' || body.lastName.trim().length < 1 || body.lastName.trim().length > 80) return 'Last name must contain 1 to 80 characters.';
  }
  for (const key of ['preferredName'] as const) {
    const value = body[key];
    if (value !== undefined && value !== null && (typeof value !== 'string' || value.trim().length > 80)) return 'Preferred name must not exceed 80 characters.';
  }
  if (body.dateOfBirth !== undefined && !validDate(body.dateOfBirth)) return 'Date of birth must be a valid YYYY-MM-DD date that is not in the future.';
  for (const key of ['classId', 'sectionId', 'academicYearId'] as const) {
    const value = body[key];
    if (value !== undefined && value !== null && value !== '' && !validId(value)) return key + ' must be a valid identifier.';
  }
  if (body.admissionStatus !== undefined && !['registered', 'admitted', 'transferred', 'withdrawn'].includes(String(body.admissionStatus))) return 'Admission status is not supported.';
  return null;
}

async function getAccess(ctx: any) {
  const resolved = await tenantAccessFromRequest(ctx, {
    allowBodyFallback: false,
    requireTenantId: true,
    maxTenantLength: 128,
    invalidTenantMessage: 'A valid tenantId query parameter is required.',
    membershipMessage: 'Tenant membership not found or access denied.',
  });
  if (!resolved.ok) return { response: resolved.response };
  return { tenantId: resolved.tenantId, membership: resolved.membership, response: null };
}

async function loadStudent(tenantId: string, studentId: string) {
  const [record] = await db.get<StudentRecord>(tenantTable('students', tenantId), [studentId], { consistent: true });
  if (!record || record.id !== studentId || record.tenantId !== tenantId || record.status === 'deleted') return null;
  return record;
}

async function loadActiveSchool(tenantId: string, schoolId: string) {
  const [school] = await db.get<Record<string, any>>(tenantTable('schools', tenantId), [schoolId], { consistent: true });
  if (!school || school.id !== schoolId || school.schoolId !== schoolId || school.tenantId !== tenantId || school.status !== 'active') return null;
  return school;
}



export const studentRoutes = {
  'GET /api/students': [
    requireAuth(),
    async (ctx: any) => {
      try {
        const access = await getAccess(ctx);
        if (access.response !== null) return access.response;
        const limit = ctx.query.limit === undefined ? 25 : Number(ctx.query.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) return error('limit must be an integer from 1 to 100.', 400);
        const nextToken = ctx.query.nextToken;
        if (nextToken !== undefined && (typeof nextToken !== 'string' || nextToken.length > 4096)) return error('Invalid pagination token.', 400);
        const filters: Record<string, string> = {};
        for (const key of ['schoolId', 'classId', 'academicYearId'] as const) {
          const value = ctx.query[key];
          if (value !== undefined) {
            if (!validId(value)) return error('Invalid ' + key + ' filter.', 400);
            filters[key] = value;
          }
        }
        const search = String(ctx.query.search || '').trim().toLowerCase();
        if (search.length > 80) return error('Search text must not exceed 80 characters.', 400);
        const page = await db.list<StudentRecord>(tenantTable('students', access.tenantId), {
          limit,
          ...(nextToken ? { nextToken } : {}),
        });
        const visible: StudentRecord[] = [];
        for (const record of page.items) {
          if (record.tenantId !== access.tenantId || record.status === 'deleted') continue;
          if (Object.entries(filters).some(([key, value]) => (record as any)[key] !== value)) continue;
          if (search && ![record.studentNumber, record.firstName, record.lastName, record.preferredName || ''].some(value => value.toLowerCase().includes(search))) continue;
          if (await authorizeRecord(access.tenantId, access.membership, 'student', 'read', record)) visible.push(record);
        }
        return json({ items: visible, nextToken: page.nextToken || null, pageSize: limit });
      } catch (cause) {
        return apiFailure(cause, 'Unable to retrieve student records. Please retry or contact the administrator.', {
          logLabel: 'student.list failed',
          databaseErrors: STUDENT_DATABASE_FAILURES,
        });
      }
    },
  ],
  'POST /api/students/registration-intents': [
    requireAuth(),
    async (ctx: any) => {
      try {
        const access = await getAccess(ctx);
        if (access.response !== null) return access.response;
        if (!isRecord(ctx.body)) return error('A student profile object is required.', 400);
        const body = ctx.body;
        const validation = validateStudentInput(body, false);
        if (validation) return error(validation, 400);
        const school = await loadActiveSchool(access.tenantId, String(body.schoolId));
        if (!school) return error('An active school with this ID was not found in the selected tenant.', 404);
        const academicProblem = await validateStudentAcademicReferences(access.tenantId, String(body.schoolId), body);
        if (academicProblem) return error(academicProblem, 400);
        const timestamp = now();
        const studentId = crypto.randomUUID();
        const studentNumber = 'STU-' + new Date().getUTCFullYear() + '-' + crypto.randomUUID().replace(/-/g, '').toUpperCase();
        const profile = {
          schoolId: String(body.schoolId),
          firstName: String(body.firstName).trim(),
          lastName: String(body.lastName).trim(),
          preferredName: typeof body.preferredName === 'string' ? body.preferredName.trim() || null : null,
          dateOfBirth: typeof body.dateOfBirth === 'string' ? body.dateOfBirth : null,
          classId: typeof body.classId === 'string' && body.classId ? body.classId : null,
          sectionId: typeof body.sectionId === 'string' && body.sectionId ? body.sectionId : null,
          academicYearId: typeof body.academicYearId === 'string' && body.academicYearId ? body.academicYearId : null,
          admissionStatus: (body.admissionStatus as StudentRecord['admissionStatus']) || 'registered',
        };
        const proposed: StudentRecord = {
          id: studentId, tenantId: access.tenantId, schoolId: profile.schoolId,
          studentNumber, ...profile,
          status: 'active', ownerUserId: ctx.user.userId,
          attributes: { recordType: 'student' }, version: 1,
          createdAt: timestamp, createdBy: ctx.user.userId,
          updatedAt: timestamp, updatedBy: ctx.user.userId,
        };
        if (!(await authorizeRecord(access.tenantId, access.membership, 'student', 'create', proposed))) return error('Permission denied for this school or student scope.', 403);
        const intentId = crypto.randomUUID();
        const intent = {
          id: intentId,
          tenantId: access.tenantId,
          createdBy: ctx.user.userId,
          studentId,
          studentNumber,
          auditEventId: crypto.randomUUID(),
          domainEventId: crypto.randomUUID(),
          profile,
          status: 'issued',
          createdAt: timestamp,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        };
        await db.transact([db.tx.add(tenantTable('student_registration_intents', access.tenantId), [intent])]);
        return json({ intentId, expiresAt: intent.expiresAt }, 201);
      } catch (cause) {
        return apiFailure(cause, 'Unable to prepare the student registration. Please retry.', {
          logLabel: 'student.registration-intent failed',
          databaseErrors: STUDENT_DATABASE_FAILURES,
        });
      }
    },
  ],
  'POST /api/students': [
    requireAuth(),
    async (ctx: any) => {
      try {
        const access = await getAccess(ctx);
        if (access.response !== null) return access.response;
        if (!isRecord(ctx.body) || Object.keys(ctx.body).length !== 1 || !validId(ctx.body.registrationIntentId)) {
          return error('Submit only a valid server-issued registrationIntentId.', 400);
        }
        const intentId = String(ctx.body.registrationIntentId);
        const intentTable = tenantTable('student_registration_intents', access.tenantId);
        const [intent] = await db.get<Record<string, any>>(intentTable, [intentId], { consistent: true });
        if (!intent || intent.id !== intentId || intent.tenantId !== access.tenantId || intent.createdBy !== ctx.user.userId) return error('Student registration intent not found.', 404);
        if (intent.status === 'completed') return json({ studentId: intent.studentId, studentNumber: intent.studentNumber, alreadyCompleted: true });
        if (intent.status !== 'issued' || typeof intent.expiresAt !== 'string' || Date.parse(intent.expiresAt) <= Date.now()) return error('Student registration intent has expired or is no longer usable.', 410);
        if (!isRecord(intent.profile)) return error('Student registration intent is incomplete. Start a new registration.', 409);
        const profile = intent.profile as Record<string, any>;
        const validation = validateStudentInput(profile, false);
        if (validation) return error('Stored student registration intent failed validation. Start a new registration.', 409);
        const school = await loadActiveSchool(access.tenantId, String(profile.schoolId));
        if (!school) return error('The school is no longer active in this tenant. Start a new registration.', 409);
        const academicProblem = await validateStudentAcademicReferences(access.tenantId, String(profile.schoolId), profile);
        if (academicProblem) return error(academicProblem, 409);
        const timestamp = now();
        const record: StudentRecord = {
          id: String(intent.studentId),
          tenantId: access.tenantId,
          schoolId: String(profile.schoolId),
          studentNumber: String(intent.studentNumber),
          firstName: String(profile.firstName).trim(),
          lastName: String(profile.lastName).trim(),
          preferredName: typeof profile.preferredName === 'string' ? profile.preferredName : null,
          dateOfBirth: typeof profile.dateOfBirth === 'string' ? profile.dateOfBirth : null,
          classId: typeof profile.classId === 'string' && profile.classId ? profile.classId : null,
          sectionId: typeof profile.sectionId === 'string' && profile.sectionId ? profile.sectionId : null,
          academicYearId: typeof profile.academicYearId === 'string' && profile.academicYearId ? profile.academicYearId : null,
          admissionStatus: profile.admissionStatus as StudentRecord['admissionStatus'],
          status: 'active',
          ownerUserId: ctx.user.userId,
          attributes: { recordType: 'student' },
          version: 1,
          createdAt: intent.createdAt,
          createdBy: ctx.user.userId,
          updatedAt: timestamp,
          updatedBy: ctx.user.userId,
        };
        if (!(await authorizeRecord(access.tenantId, access.membership, 'student', 'create', record))) return error('Permission denied for this school or student scope.', 403);
        const audit = { ...auditRecord(access.tenantId, ctx.user.userId, 'student.created', record.id, { schoolId: record.schoolId, studentNumber: record.studentNumber }), id: intent.auditEventId };
        const event = domainEvent(access.tenantId, ctx.user.userId, 'student.created', 'student', record.id, { schoolId: record.schoolId, studentNumber: record.studentNumber }, intent.domainEventId, timestamp);
        await db.transact([
          db.tx.add(tenantTable('students', access.tenantId), [record]),
          db.tx.add(tenantTable('audit_events', access.tenantId), [audit]),
          db.tx.add(tenantTable('domain_events', access.tenantId), [event]),
          db.tx.update(intentTable, [{ id: intentId, if: { status: 'issued' }, record: { status: 'completed', studentId: record.id, completedAt: timestamp, profile: undefined } }], { patch: true }),
        ]);
        return json({ student: record }, 201);
      } catch (cause) {
        return apiFailure(cause, 'Unable to create the student record. Retry using the same registration intent, not a new one.', {
          logLabel: 'student.create failed',
          databaseErrors: STUDENT_DATABASE_FAILURES,
        });
      }
    },
  ],
  'GET /api/students/:studentId': [
    requireAuth(),
    async (ctx: any) => {
      try {
        const access = await getAccess(ctx);
        if (access.response !== null) return access.response;
        const id = String(ctx.params.studentId || '');
        if (!validId(id)) return error('Invalid student ID.', 400);
        const record = await loadStudent(access.tenantId, id);
        if (!record || !(await authorizeRecord(access.tenantId, access.membership, 'student', 'read', record))) return error('Student not found.', 404);
        return json({ student: record });
      } catch (cause) {
        return apiFailure(cause, 'Unable to retrieve the student record. Please retry.', {
          logLabel: 'student.read failed',
          databaseErrors: STUDENT_DATABASE_FAILURES,
        });
      }
    },
  ],
  'PUT /api/students/:studentId': [
    requireAuth(),
    async (ctx: any) => {
      try {
        const access = await getAccess(ctx);
        if (access.response !== null) return access.response;
        const id = String(ctx.params.studentId || '');
        if (!validId(id)) return error('Invalid student ID.', 400);
        if (!isRecord(ctx.body)) return error('A student profile object is required.', 400);
        const body = ctx.body;
        const validation = validateStudentInput(body, true);
        if (validation) return error(validation, 400);
        const old = await loadStudent(access.tenantId, id);
        if (!old || !(await authorizeRecord(access.tenantId, access.membership, 'student', 'update', old))) return error('Student not found.', 404);
        if (!Number.isInteger(body.expectedVersion) || body.expectedVersion !== old.version) return error('Student record changed. Reload before saving.', 409);
        const next: StudentRecord = {
          ...old,
          ...(body.schoolId !== undefined ? { schoolId: String(body.schoolId) } : {}),
          ...(body.firstName !== undefined ? { firstName: String(body.firstName).trim() } : {}),
          ...(body.lastName !== undefined ? { lastName: String(body.lastName).trim() } : {}),
          ...(body.preferredName !== undefined ? { preferredName: typeof body.preferredName === 'string' ? body.preferredName.trim() || null : null } : {}),
          ...(body.dateOfBirth !== undefined ? { dateOfBirth: typeof body.dateOfBirth === 'string' ? body.dateOfBirth : null } : {}),
          ...(body.classId !== undefined ? { classId: typeof body.classId === 'string' && body.classId ? body.classId : null } : {}),
          ...(body.sectionId !== undefined ? { sectionId: typeof body.sectionId === 'string' && body.sectionId ? body.sectionId : null } : {}),
          ...(body.academicYearId !== undefined ? { academicYearId: typeof body.academicYearId === 'string' && body.academicYearId ? body.academicYearId : null } : {}),
          ...(body.admissionStatus !== undefined ? { admissionStatus: body.admissionStatus as StudentRecord['admissionStatus'] } : {}),
          version: old.version + 1, updatedAt: now(), updatedBy: ctx.user.userId,
        };
        const school = await loadActiveSchool(access.tenantId, next.schoolId);
        if (!school) return error('An active school with this ID was not found in the selected tenant.', 404);
        const academicProblem = await validateStudentAcademicReferences(access.tenantId, next.schoolId, next, old);
        if (academicProblem) return error(academicProblem, 400);
        if (!(await authorizeRecord(access.tenantId, access.membership, 'student', 'update', next))) return error('Permission denied for the proposed school or student scope.', 403);
        const table = tenantTable('students', access.tenantId);
        await db.transact([
          db.tx.update(table, [{ id, if: { version: old.version, status: 'active' }, record: next }]),
          db.tx.add(tenantTable('audit_events', access.tenantId), [auditRecord(access.tenantId, ctx.user.userId, 'student.updated', id, { previousVersion: old.version, version: next.version, schoolId: next.schoolId })]),
          db.tx.add(tenantTable('domain_events', access.tenantId), [domainEvent(access.tenantId, ctx.user.userId, 'student.updated', 'student', id, { version: next.version, schoolId: next.schoolId })]),
        ]);
        return json({ student: next });
      } catch (cause) {
        return apiFailure(cause, 'Unable to update the student record. Reload and retry.', {
          logLabel: 'student.update failed',
          databaseErrors: STUDENT_DATABASE_FAILURES,
        });
      }
    },
  ],
  'DELETE /api/students/:studentId': [
    requireAuth(),
    async (ctx: any) => {
      try {
        const access = await getAccess(ctx);
        if (access.response !== null) return access.response;
        const id = String(ctx.params.studentId || '');
        if (!validId(id)) return error('Invalid student ID.', 400);
        const old = await loadStudent(access.tenantId, id);
        if (!old || !(await authorizeRecord(access.tenantId, access.membership, 'student', 'delete', old))) return error('Student not found.', 404);
        const deletedAt = now();
        const next = { ...old, status: 'deleted' as const, version: old.version + 1, deletedAt, deletedBy: ctx.user.userId, updatedAt: deletedAt, updatedBy: ctx.user.userId };
        await db.transact([
          db.tx.update(tenantTable('students', access.tenantId), [{ id, if: { version: old.version, status: 'active' }, record: next }]),
          db.tx.add(tenantTable('audit_events', access.tenantId), [auditRecord(access.tenantId, ctx.user.userId, 'student.deleted', id, { schoolId: old.schoolId, version: next.version })]),
          db.tx.add(tenantTable('domain_events', access.tenantId), [domainEvent(access.tenantId, ctx.user.userId, 'student.deleted', 'student', id, { schoolId: old.schoolId, version: next.version })]),
        ]);
        return json({ deleted: true, studentId: id });
      } catch (cause) {
        return apiFailure(cause, 'Unable to delete the student record. Reload and retry.', {
          logLabel: 'student.delete failed',
          databaseErrors: STUDENT_DATABASE_FAILURES,
        });
      }
    },
  ],
};
