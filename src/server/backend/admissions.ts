// @ts-nocheck -- imported School Hub source, kept as-is
import { db, error, json, requireAuth, storage, isAppDatabaseError } from '@/server/appdeploy-sdk';
import {
  apiFailure, auditRecord, authorizeRecord, domainEvent, hasSchoolScope,
  isRecord, isValidRecordId, tenantAccessFromRequest, tenantTable,
} from './platform';
import { validateStudentAcademicReferences } from './academic';

type AdmissionStatus = 'submitted' | 'under_review' | 'waitlisted' | 'offered' | 'accepted' | 'rejected' | 'withdrawn' | 'enrolled';
type AdmissionRecord = {
  id: string; tenantId: string; schoolId: string; applicationNumber: string;
  academicYearId: string; requestedClassId: string | null;
  applicantFirstName: string; applicantLastName: string; otherNames: string | null;
  dateOfBirth: string | null; gender: string | null;
  applicantEmail: string | null; applicantPhone: string | null;
  guardianName: string | null; guardianRelationship: string | null;
  guardianEmail: string | null; guardianPhone: string | null;
  previousSchool: string | null; notes: string | null;
  status: AdmissionStatus; submittedAt: string; decisionAt: string | null;
  studentId: string | null; ownerUserId: string; attributes: Record<string, unknown>;
  version: number; createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
};
const now = () => new Date().toISOString();
const validId = isValidRecordId;
const applicationTable = (tenantId: string) => tenantTable('admission_applications', tenantId);
const decisionTable = (tenantId: string) => tenantTable('admission_decisions', tenantId);
const documentTable = (tenantId: string) => tenantTable('admission_documents', tenantId);
const receiptTable = (tenantId: string) => tenantTable('admission_application_receipts', tenantId);

const DB_FAILURES: Record<string, { status: number; message: string }> = {
  AppDatabaseQuotaExceeded: { status: 429, message: 'The database request quota is temporarily exhausted. Please wait before retrying.' },
  AppDatabaseConditionFailed: { status: 409, message: 'The application changed while this request was being processed. Reload and retry.' },
  AppDatabaseConflict: { status: 409, message: 'The application changed while this request was being processed. Reload and retry.' },
  AppDatabaseDuplicateId: { status: 409, message: 'A record already exists for this request. Reload the admissions register.' },
  AppDatabasePartitionAccessDenied: { status: 403, message: 'Access to this tenant data is denied.' },
  AppDatabaseScopeMismatch: { status: 403, message: 'Access to this tenant data is denied.' },
  AppDatabaseInvalidInput: { status: 400, message: 'The admissions request contains invalid data.' },
  AppDatabaseItemTooLarge: { status: 413, message: 'The admissions request exceeds the supported record size.' },
  AppDatabaseRequestTooLarge: { status: 413, message: 'The admissions request exceeds the supported request size.' },
  AppDatabaseTransactionTooLarge: { status: 413, message: 'The admissions transaction exceeds the supported size.' },
  AppDatabaseGatewayUnavailable: { status: 503, message: 'The database could not confirm the result. Reload and verify before retrying.' },
  AppDatabaseReadIncomplete: { status: 503, message: 'The database could not confirm the result. Reload and verify before retrying.' },
  AppDatabaseUnknownOutcome: { status: 503, message: 'The database could not confirm the result. Reload and verify before retrying.' },
};

async function getTenantAccess(ctx: any) {
  const resolved = await tenantAccessFromRequest(ctx, {
    allowBodyFallback: false, requireTenantId: true, maxTenantLength: 128,
    invalidTenantMessage: 'A valid tenantId query parameter is required.',
    membershipMessage: 'Tenant membership not found or access denied.',
  });
  if (!resolved.ok) return { response: resolved.response };
  return { tenantId: resolved.tenantId, membership: resolved.membership, response: null };
}
async function loadSchool(tenantId: string, schoolId: string) {
  const [school] = await db.get<Record<string, any>>(tenantTable('schools', tenantId), [schoolId], { consistent: true });
  if (!school || school.id !== schoolId || school.tenantId !== tenantId || school.status !== 'active') return null;
  return school;
}
async function loadApplication(tenantId: string, id: string): Promise<AdmissionRecord | null> {
  const [record] = await db.get<AdmissionRecord>(applicationTable(tenantId), [id], { consistent: true });
  if (!record || record.id !== id || record.tenantId !== tenantId || record.status === 'deleted') return null;
  return record;
}
function cleanOptional(value: unknown, max: number) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > max) return undefined;
  return value.trim();
}
function validDate(value: unknown) {
  if (value === null || value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && parsed <= new Date();
}
function normaliseApplication(body: Record<string, unknown>) {
  const allowed = new Set([
    'schoolId','academicYearId','requestedClassId','applicantFirstName','applicantLastName','otherNames',
    'dateOfBirth','gender','applicantEmail','applicantPhone','guardianName','guardianRelationship',
    'guardianEmail','guardianPhone','previousSchool','notes','requestId',
  ]);
  if (Object.keys(body).some(key => !allowed.has(key))) return { error: 'Unsupported application fields. Record IDs, tenant scope, status and version are server managed.' };
  const first = typeof body.applicantFirstName === 'string' ? body.applicantFirstName.trim() : '';
  const last = typeof body.applicantLastName === 'string' ? body.applicantLastName.trim() : '';
  if (first.length < 1 || first.length > 80 || last.length < 1 || last.length > 80) return { error: 'Applicant first and last names are required and must not exceed 80 characters.' };
  if (!validId(body.schoolId) || !validId(body.academicYearId)) return { error: 'Choose a valid school and academic year.' };
  if (body.requestedClassId !== null && body.requestedClassId !== undefined && body.requestedClassId !== '' && !validId(body.requestedClassId)) return { error: 'Choose a valid requested class.' };
  if (!validDate(body.dateOfBirth)) return { error: 'Date of birth must be a valid YYYY-MM-DD date that is not in the future.' };
  const fields: Record<string, unknown> = {};
  const optional: Array<[string, number]> = [
    ['otherNames',100],['gender',30],['applicantEmail',254],['applicantPhone',40],
    ['guardianName',160],['guardianRelationship',80],['guardianEmail',254],
    ['guardianPhone',40],['previousSchool',180],['notes',2000],
  ];
  for (const [key, max] of optional) {
    const value = cleanOptional(body[key], max);
    if (value === undefined) return { error: key + ' exceeds its supported length or has an invalid type.' };
    fields[key] = value;
  }
  for (const key of ['applicantEmail','guardianEmail']) {
    const value = fields[key];
    if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) return { error: key + ' must be a valid email address.' };
  }
  if (typeof body.requestId !== 'string' || !validId(body.requestId)) return { error: 'A valid requestId is required for safe retry handling.' };
  return {
    value: {
      schoolId: String(body.schoolId), academicYearId: String(body.academicYearId),
      requestedClassId: typeof body.requestedClassId === 'string' && body.requestedClassId ? body.requestedClassId : null,
      applicantFirstName: first, applicantLastName: last,
      otherNames: fields.otherNames as string | null, gender: fields.gender as string | null,
      applicantEmail: fields.applicantEmail as string | null, applicantPhone: fields.applicantPhone as string | null,
      guardianName: fields.guardianName as string | null, guardianRelationship: fields.guardianRelationship as string | null,
      guardianEmail: fields.guardianEmail as string | null, guardianPhone: fields.guardianPhone as string | null,
      previousSchool: fields.previousSchool as string | null, notes: fields.notes as string | null,
      dateOfBirth: typeof body.dateOfBirth === 'string' && body.dateOfBirth ? body.dateOfBirth : null,
      requestId: String(body.requestId),
    },
  };
}
const transitions: Record<AdmissionStatus, AdmissionStatus[]> = {
  submitted: ['under_review','withdrawn'],
  under_review: ['waitlisted','offered','rejected','withdrawn'],
  waitlisted: ['offered','rejected','withdrawn'],
  offered: ['accepted','rejected','withdrawn'],
  accepted: ['enrolled','withdrawn'],
  rejected: [], withdrawn: [], enrolled: [],
};
const decisionForStatus: Partial<Record<AdmissionStatus, string>> = {
  waitlisted: 'waitlist', offered: 'offer', accepted: 'accept_offer',
  rejected: 'reject', withdrawn: 'withdraw_offer',
};
function fingerprint(value: Record<string, unknown>) {
  return JSON.stringify(value);
}

export const admissionsRoutes = {
  'GET /api/admissions': [requireAuth(), async (ctx: any) => {
    try {
      const access = await getTenantAccess(ctx); if (access.response) return access.response;
      const schoolId = String(ctx.query.schoolId || '');
      if (!validId(schoolId) || !hasSchoolScope(access.membership, schoolId)) return error('Choose a school within your authorised scope.', 403);
      if (!(await loadSchool(access.tenantId!, schoolId))) return error('The selected school is not active in this workspace.', 404);
      const limit = ctx.query.limit === undefined ? 25 : Number(ctx.query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) return error('limit must be an integer from 1 to 100.', 400);
      if (ctx.query.nextToken !== undefined && String(ctx.query.nextToken).length > 4096) return error('Invalid pagination token.', 400);
      const status = String(ctx.query.status || '');
      if (status && !Object.keys(transitions).includes(status) && status !== 'all') return error('Unsupported admission status filter.', 400);
      const search = String(ctx.query.search || '').trim().toLowerCase();
      if (search.length > 80) return error('Search text must not exceed 80 characters.', 400);
      const page = await db.list<AdmissionRecord>(applicationTable(access.tenantId!), { limit, ...(ctx.query.nextToken ? { nextToken: ctx.query.nextToken } : {}) });
      const items: AdmissionRecord[] = [];
      for (const record of page.items) {
        if (record.tenantId !== access.tenantId || record.schoolId !== schoolId) continue;
        if (status && status !== 'all' && record.status !== status) continue;
        if (search && ![record.applicationNumber,record.applicantFirstName,record.applicantLastName,record.applicantEmail || '',record.applicantPhone || ''].some(v => v.toLowerCase().includes(search))) continue;
        if (await authorizeRecord(access.tenantId!, access.membership, 'admission-application', 'read', record)) items.push(record);
      }
      return json({ items, nextToken: page.nextToken || null, pageSize: limit });
    } catch (cause) {
      return apiFailure(cause, 'Unable to retrieve admissions applications.', { logLabel: 'admissions.list failed', databaseErrors: DB_FAILURES });
    }
  }],
  'POST /api/admissions': [requireAuth(), async (ctx: any) => {
    try {
      const access = await getTenantAccess(ctx); if (access.response) return access.response;
      if (!isRecord(ctx.body)) return error('An application form is required.', 400);
      const parsed = normaliseApplication(ctx.body);
      if (parsed.error) return error(parsed.error, 400);
      const input = parsed.value!;
      if (!hasSchoolScope(access.membership, input.schoolId)) return error('The selected school is outside your authorised scope.', 403);
      const school = await loadSchool(access.tenantId!, input.schoolId);
      if (!school) return error('The selected school is not active in this workspace.', 404);
      const academicProblem = await validateStudentAcademicReferences(access.tenantId!, input.schoolId, {
        academicYearId: input.academicYearId, classId: input.requestedClassId,
      });
      if (academicProblem) return error(academicProblem, 400);
      const requestFingerprint = fingerprint(input);
      const [savedReceipt] = await db.get<Record<string, any>>(receiptTable(access.tenantId!), [input.requestId], { consistent: true });
      if (savedReceipt) {
        if (savedReceipt.createdBy !== ctx.user.userId || savedReceipt.fingerprint !== requestFingerprint) return error('This requestId is already associated with a different application request.', 409);
        const existing = await loadApplication(access.tenantId!, String(savedReceipt.applicationId));
        if (!existing) return error('The original application outcome is unresolved. Contact the administrator before retrying.', 503);
        return json({ application: existing, alreadyCreated: true });
      }
      const timestamp = now();
      const id = crypto.randomUUID();
      const [config] = await db.get<Record<string, any>>(tenantTable('platform_configurations', access.tenantId!), ['admissions_applicationPrefix'], { consistent: true });
      const prefix = typeof config?.value === 'string' && /^[A-Za-z0-9_-]{1,12}$/.test(config.value) ? config.value : 'APP';
      const applicationNumber = prefix + '-' + new Date().getUTCFullYear() + '-' + crypto.randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
      const record: AdmissionRecord = {
        id, tenantId: access.tenantId!, schoolId: input.schoolId, applicationNumber,
        academicYearId: input.academicYearId, requestedClassId: input.requestedClassId,
        applicantFirstName: input.applicantFirstName, applicantLastName: input.applicantLastName,
        otherNames: input.otherNames, dateOfBirth: input.dateOfBirth, gender: input.gender,
        applicantEmail: input.applicantEmail, applicantPhone: input.applicantPhone,
        guardianName: input.guardianName, guardianRelationship: input.guardianRelationship,
        guardianEmail: input.guardianEmail, guardianPhone: input.guardianPhone,
        previousSchool: input.previousSchool, notes: input.notes,
        status: 'submitted', submittedAt: timestamp, decisionAt: null, studentId: null,
        ownerUserId: ctx.user.userId, attributes: { recordType: 'admission-application' },
        version: 1, createdAt: timestamp, createdBy: ctx.user.userId, updatedAt: timestamp, updatedBy: ctx.user.userId,
      };
      if (!(await authorizeRecord(access.tenantId!, access.membership, 'admission-application', 'create', record))) return error('Permission denied for this school or admissions scope.', 403);
      const receipt = { id: input.requestId, tenantId: access.tenantId, createdBy: ctx.user.userId, fingerprint: requestFingerprint, applicationId: id, createdAt: timestamp };
      const audit = auditRecord(access.tenantId!, ctx.user.userId, 'admission.application.created', id, { schoolId: input.schoolId, applicationNumber });
      const event = domainEvent(access.tenantId!, ctx.user.userId, 'admission.application.created', 'admission-application', id, { schoolId: input.schoolId, applicationNumber }, crypto.randomUUID(), timestamp);
      try {
        await db.transact([
          db.tx.add(applicationTable(access.tenantId!), [record]),
          db.tx.add(receiptTable(access.tenantId!), [receipt]),
          db.tx.add(tenantTable('audit_events', access.tenantId!), [audit]),
          db.tx.add(tenantTable('domain_events', access.tenantId!), [event]),
        ]);
      } catch (cause) {
        if (isAppDatabaseError(cause) && ['AppDatabaseDuplicateId','AppDatabaseUnknownOutcome'].includes(cause.code)) {
          const [receiptAfter] = await db.get<Record<string, any>>(receiptTable(access.tenantId!), [input.requestId], { consistent: true });
          if (receiptAfter && receiptAfter.createdBy === ctx.user.userId && receiptAfter.fingerprint === requestFingerprint) {
            const replay = await loadApplication(access.tenantId!, String(receiptAfter.applicationId));
            if (replay) return json({ application: replay, alreadyCreated: true });
          }
        }
        throw cause;
      }
      return json({ application: record }, 201);
    } catch (cause) {
      return apiFailure(cause, 'Unable to create the admissions application. Retry with the same requestId.', { logLabel: 'admissions.create failed', databaseErrors: DB_FAILURES });
    }
  }],
  'GET /api/admissions/:applicationId': [requireAuth(), async (ctx: any) => {
    try {
      const access = await getTenantAccess(ctx); if (access.response) return access.response;
      const id = String(ctx.params.applicationId || '');
      if (!validId(id)) return error('Invalid application ID.', 400);
      const application = await loadApplication(access.tenantId!, id);
      if (!application || !(await authorizeRecord(access.tenantId!, access.membership, 'admission-application', 'read', application))) return error('Application not found.', 404);
      const canReadDecisions = await authorizeRecord(access.tenantId!, access.membership, 'admission-decision', 'read', application);
      const decisionsPage = canReadDecisions ? await db.list<Record<string, any>>(decisionTable(access.tenantId!), { limit: 100 }) : { items: [], nextToken: undefined };
      const decisions = decisionsPage.items.filter(item => item.tenantId === access.tenantId && item.applicationId === id && item.schoolId === application.schoolId);
      const canReadDocuments = await authorizeRecord(access.tenantId!, access.membership, 'admission-document', 'read', application);
      const docsPage = canReadDocuments ? await db.list<Record<string, any>>(documentTable(access.tenantId!), { limit: 50 }) : { items: [], nextToken: undefined };
      const documents = await Promise.all(docsPage.items.filter(item => item.tenantId === access.tenantId && item.applicationId === id && item.status !== 'deleted').map(async item => {
        const [signed] = await storage.url([String(item.storagePath)]);
        return { ...item, url: signed?.url || null };
      }));
      return json({ application, decisions, documents, decisionsTruncated: Boolean(decisionsPage.nextToken), documentsTruncated: Boolean(docsPage.nextToken) });
    } catch (cause) {
      return apiFailure(cause, 'Unable to retrieve the application details.', { logLabel: 'admissions.read failed', databaseErrors: DB_FAILURES });
    }
  }],
  'PUT /api/admissions/:applicationId/status': [requireAuth(), async (ctx: any) => {
    try {
      const access = await getTenantAccess(ctx); if (access.response) return access.response;
      const id = String(ctx.params.applicationId || '');
      if (!validId(id) || !isRecord(ctx.body)) return error('A valid application and status request are required.', 400);
      const body = ctx.body;
      if (Object.keys(body).some(key => !['status','reason','expectedVersion','studentId'].includes(key))) return error('Unsupported status-transition fields.', 400);
      const old = await loadApplication(access.tenantId!, id);
      if (!old) return error('Application not found.', 404);
      if (!(await authorizeRecord(access.tenantId!, access.membership, 'admission-application', 'update', old))) return error('Permission denied.', 403);
      const nextStatus = String(body.status) as AdmissionStatus;
      if (!transitions[old.status]?.includes(nextStatus)) return error('This admission status transition is not permitted.', 409);
      if (!Number.isInteger(body.expectedVersion) || body.expectedVersion !== old.version) return error('Application changed since it was loaded. Reload before saving.', 409);
      const reason = cleanOptional(body.reason, 1000);
      if (reason === undefined) return error('Decision reason must not exceed 1,000 characters.', 400);
      let studentId: string | null = old.studentId;
      if (nextStatus === 'enrolled') {
        if (!validId(body.studentId)) return error('Select the existing student record to link this enrolment.', 400);
        const [student] = await db.get<Record<string, any>>(tenantTable('students', access.tenantId!), [String(body.studentId)], { consistent: true });
        if (!student || student.tenantId !== access.tenantId || student.schoolId !== old.schoolId || student.status !== 'active' || student.admissionStatus !== 'admitted') return error('The selected student must be an active admitted student in the same school.', 409);
        if (!(await authorizeRecord(access.tenantId!, access.membership, 'student', 'read', student))) return error('Permission denied for the selected student.', 403);
        if (student.firstName.trim().toLowerCase() !== old.applicantFirstName.toLowerCase() || student.lastName.trim().toLowerCase() !== old.applicantLastName.toLowerCase()) return error('The selected student name does not match this application.', 409);
        studentId = student.id;
      } else if (body.studentId !== undefined) return error('studentId is accepted only when completing enrolment.', 400);
      if (nextStatus === 'rejected' || nextStatus === 'withdrawn' || nextStatus === 'accepted' || nextStatus === 'offered' || nextStatus === 'waitlisted') {
        if (!(await authorizeRecord(access.tenantId!, access.membership, 'admission-decision', 'create', old))) return error('Permission denied to record an admission decision.', 403);
        if (!reason && ['rejected','withdrawn'].includes(nextStatus)) return error('A reason is required for rejection or withdrawal.', 400);
      }
      const timestamp = now();
      const updated: AdmissionRecord = { ...old, status: nextStatus, studentId, decisionAt: decisionForStatus[nextStatus] ? timestamp : old.decisionAt, version: old.version + 1, updatedAt: timestamp, updatedBy: ctx.user.userId };
      const operations = [
        db.tx.update(applicationTable(access.tenantId!), [{ id, if: { version: old.version, status: old.status }, record: updated }]),
        db.tx.add(tenantTable('audit_events', access.tenantId!), [auditRecord(access.tenantId!, ctx.user.userId, 'admission.application.status.changed', id, { from: old.status, to: nextStatus, reason: reason || null, studentId })]),
        db.tx.add(tenantTable('domain_events', access.tenantId!), [domainEvent(access.tenantId!, ctx.user.userId, 'admission.application.status.changed', 'admission-application', id, { schoolId: old.schoolId, from: old.status, to: nextStatus, studentId }, crypto.randomUUID(), timestamp)]),
      ];
      const decision = decisionForStatus[nextStatus];
      if (decision) operations.push(db.tx.add(decisionTable(access.tenantId!), [{ id: crypto.randomUUID(), tenantId: access.tenantId, schoolId: old.schoolId, applicationId: id, decision, reason: reason || null, actorUserId: ctx.user.userId, decidedAt: timestamp }]) as any);
      await db.transact(operations as any);
      return json({ application: updated });
    } catch (cause) {
      return apiFailure(cause, 'Unable to update the admission status. Reload and verify before retrying.', { logLabel: 'admissions.transition failed', databaseErrors: DB_FAILURES });
    }
  }],
  'POST /api/admissions/:applicationId/documents': [requireAuth(), async (ctx: any) => {
    try {
      const access = await getTenantAccess(ctx); if (access.response) return access.response;
      const id = String(ctx.params.applicationId || '');
      if (!validId(id) || !isRecord(ctx.body)) return error('A valid application and document payload are required.', 400);
      const application = await loadApplication(access.tenantId!, id);
      if (!application || !(await authorizeRecord(access.tenantId!, access.membership, 'admission-application', 'update', application))) return error('Application not found or permission denied.', 404);
      if (!(await authorizeRecord(access.tenantId!, access.membership, 'admission-document', 'create', application))) return error('Permission denied to upload application documents.', 403);
      const body = ctx.body;
      if (Object.keys(body).some(key => !['fileName','contentType','contentBase64','sizeBytes'].includes(key))) return error('Unsupported document fields.', 400);
      const fileName = typeof body.fileName === 'string' ? body.fileName.trim().replace(/[\\/]/g, '_').slice(0, 180) : '';
      const contentType = String(body.contentType || '');
      const base64 = String(body.contentBase64 || '');
      const sizeBytes = Number(body.sizeBytes);
      const allowedTypes = ['application/pdf','image/jpeg','image/png'];
      if (!fileName || !allowedTypes.includes(contentType) || !Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 600 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > 820000 || Math.floor(base64.length * 3 / 4) < sizeBytes - 2 || Math.floor(base64.length * 3 / 4) > sizeBytes + 2) return error('Upload a PDF, JPEG or PNG document up to 600 KB.', 400);
      const documentId = crypto.randomUUID();
      const storagePath = 'admissions/' + access.tenantId + '/' + application.schoolId + '/' + id + '/' + documentId;
      const [stored] = await storage.write([{ path: storagePath, content: base64, contentType }]);
      if (!stored) return error('The document could not be stored. Please retry.', 503);
      const timestamp = now();
      const document = { id: documentId, tenantId: access.tenantId, schoolId: application.schoolId, applicationId: id, storagePath, fileName, contentType, sizeBytes, uploadedBy: ctx.user.userId, uploadedAt: timestamp, status: 'active' };
      try {
        await db.transact([
          db.tx.add(documentTable(access.tenantId!), [document]),
          db.tx.add(tenantTable('audit_events', access.tenantId!), [auditRecord(access.tenantId!, ctx.user.userId, 'admission.document.uploaded', documentId, { applicationId: id, fileName, contentType, sizeBytes })]),
          db.tx.add(tenantTable('domain_events', access.tenantId!), [domainEvent(access.tenantId!, ctx.user.userId, 'admission.document.uploaded', 'admission-document', documentId, { applicationId: id, schoolId: application.schoolId }, crypto.randomUUID(), timestamp)]),
        ]);
      } catch (cause) {
        await storage.delete([storagePath]);
        throw cause;
      }
      return json({ document: { ...document, url: null } }, 201);
    } catch (cause) {
      return apiFailure(cause, 'Unable to upload the application document.', { logLabel: 'admissions.document.upload failed', databaseErrors: DB_FAILURES });
    }
  }],
  'DELETE /api/admissions/:applicationId/documents/:documentId': [requireAuth(), async (ctx: any) => {
    try {
      const access = await getTenantAccess(ctx); if (access.response) return access.response;
      const applicationId = String(ctx.params.applicationId || ''), documentId = String(ctx.params.documentId || '');
      const application = await loadApplication(access.tenantId!, applicationId);
      if (!application || !(await authorizeRecord(access.tenantId!, access.membership, 'admission-application', 'update', application))) return error('Application not found or permission denied.', 404);
      const [document] = await db.get<Record<string, any>>(documentTable(access.tenantId!), [documentId], { consistent: true });
      if (!document || document.tenantId !== access.tenantId || document.applicationId !== applicationId || document.status !== 'active') return error('Document not found.', 404);
      if (!(await authorizeRecord(access.tenantId!, access.membership, 'admission-document', 'delete', application))) return error('Permission denied to remove application documents.', 403);
      const pending = { ...document, status: 'delete_pending', updatedAt: now(), updatedBy: ctx.user.userId };
      await db.transact([
        db.tx.update(documentTable(access.tenantId!), [{ id: documentId, if: { status: 'active' }, record: pending }]),
        db.tx.add(tenantTable('audit_events', access.tenantId!), [auditRecord(access.tenantId!, ctx.user.userId, 'admission.document.delete_requested', documentId, { applicationId })]),
      ]);
      const [deleted] = await storage.delete([String(document.storagePath)]);
      if (!deleted) {
        await db.tx.update(documentTable(access.tenantId!), [{ id: documentId, if: { status: 'delete_pending' }, record: { ...document, status: 'active' } }], { patch: true });
        return error('The document could not be removed. It remains available; retry later.', 503);
      }
      await db.transact([
        db.tx.update(documentTable(access.tenantId!), [{ id: documentId, if: { status: 'delete_pending' }, record: { ...pending, status: 'deleted', deletedAt: now(), deletedBy: ctx.user.userId } }]),
        db.tx.add(tenantTable('domain_events', access.tenantId!), [domainEvent(access.tenantId!, ctx.user.userId, 'admission.document.deleted', 'admission-document', documentId, { applicationId }, crypto.randomUUID(), now())]),
      ]);
      return json({ deleted: true, documentId });
    } catch (cause) {
      return apiFailure(cause, 'Unable to remove the application document.', { logLabel: 'admissions.document.delete failed', databaseErrors: DB_FAILURES });
    }
  }],
};
