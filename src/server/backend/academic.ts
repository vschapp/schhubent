// @ts-nocheck -- imported School Hub source, kept as-is
import { db, error, json, requireAuth } from '@/server/appdeploy-sdk';
import { apiFailure, auditRecord, authorize, domainEvent, hasSchoolScope, isTenantSuperAdmin, isValidRecordId, tenantAccessFromRequest, tenantTable } from './platform';

const validId = isValidRecordId;
const now = () => new Date().toISOString();

type Kind = 'academic-years' | 'terms' | 'classes' | 'sections' | 'subjects';
const TABLES: Record<Kind, string> = {
  'academic-years': 'academic_years',
  terms: 'academic_terms',
  classes: 'class_groups',
  sections: 'sections',
  subjects: 'subjects',
};

function validDateRange(start: unknown, end: unknown) {
  if (typeof start !== 'string' || typeof end !== 'string') return false;
  const a = new Date(start + 'T00:00:00Z');
  const b = new Date(end + 'T00:00:00Z');
  return !Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime()) &&
    a.toISOString().slice(0, 10) === start &&
    b.toISOString().slice(0, 10) === end && b > a;
}

async function getAccess(ctx: any) {
  const schoolId = String(ctx.query.schoolId || ctx.body?.schoolId || '');
  if (!validId(schoolId)) return { response: error('Choose a valid workspace and school.', 400) };
  const resolved = await tenantAccessFromRequest(ctx, {
    requireTenantId: true,
    maxTenantLength: 128,
    invalidTenantMessage: 'Choose a valid workspace and school.',
    membershipMessage: 'Tenant membership not found or access denied.',
  });
  if (!resolved.ok) return { response: resolved.response };
  const { tenantId, membership } = resolved;
  if (!hasSchoolScope(membership, schoolId)) return { response: error('This school is outside your authorised scope.', 403) };
  const [school] = await db.get<Record<string, any>>(tenantTable('schools', tenantId), [schoolId], { consistent: true });
  if (!school || school.id !== schoolId || school.tenantId !== tenantId || school.status !== 'active') return { response: error('The selected school is not active in this workspace.', 404) };
  return { tenantId, schoolId, school, membership, response: null };
}

async function listKind(tenantId: string, schoolId: string, kind: Kind) {
  const page = await db.list<Record<string, any>>(tenantTable(TABLES[kind], tenantId), { limit: 100 });
  return { items: page.items.filter(item => item.tenantId === tenantId && item.schoolId === schoolId && item.status === 'active'), hasMore: Boolean(page.nextToken) };
}

export async function validateStudentAcademicReferences(
  tenantId: string,
  schoolId: string,
  candidate: Record<string, any>,
  previous?: Record<string, any>,
) {
  const checks: Array<{ field: string; table: string }> = [
    { field: 'classId', table: TABLES.classes },
    { field: 'sectionId', table: TABLES.sections },
    { field: 'academicYearId', table: TABLES['academic-years'] },
  ];
  for (const check of checks) {
    const value = candidate[check.field];
    if (!value) continue;
    if (previous && value === previous[check.field]) continue;
    if (!validId(value)) return 'Select a valid ' + check.field.replace('Id', '').replace(/([A-Z])/g, ' $1').toLowerCase() + '.';
    const [record] = await db.get<Record<string, any>>(tenantTable(check.table, tenantId), [value], { consistent: true });
    if (!record || record.id !== value || record.tenantId !== tenantId || record.schoolId !== schoolId || record.status !== 'active') {
      return 'The selected academic reference is no longer available for this school. Refresh the academic options and try again.';
    }
    if (check.field === 'sectionId' && candidate.classId && record.classId !== candidate.classId) {
      return 'The selected section does not belong to the selected class.';
    }
  }
  if (candidate.sectionId && !candidate.classId) return 'Select a class before selecting a section.';
  return null;
}

export const academicRoutes = {
  'GET /api/platform/academic-catalog': [
    requireAuth(),
    async (ctx: any) => {
      try {
        const access = await getAccess(ctx);
        if (access.response !== null) return access.response;
        if (!(await authorize(access.tenantId, access.membership, 'academic-catalog', 'read'))) return error('Permission denied for academic reference data.', 403);
        const kinds: Kind[] = ['academic-years', 'terms', 'classes', 'sections', 'subjects'];
        const results = await Promise.all(kinds.map(kind => listKind(access.tenantId, access.schoolId, kind)));
        return json({
          schoolName: access.school.name,
          academicYears: results[0].items,
          terms: results[1].items,
          classes: results[2].items,
          sections: results[3].items,
          subjects: results[4].items,
          truncated: results.some(result => result.hasMore),
        });
      } catch (cause) {
        return apiFailure(cause, 'Unable to load academic reference data. Please retry.', {
          logLabel: 'academic.catalog.read failed',
        });
      }
    },
  ],
  'POST /api/platform/academic-catalog/:kind': [
    requireAuth(),
    async (ctx: any) => {
      try {
        const access = await getAccess(ctx);
        if (access.response !== null) return access.response;
        if (!isTenantSuperAdmin(access.membership)) return error('Only the tenant super administrator can configure academic reference records at this stage.', 403);
        const kind = String(ctx.params.kind) as Kind;
        if (!Object.prototype.hasOwnProperty.call(TABLES, kind)) return error('Unsupported academic reference category.', 404);
        const body = ctx.body || {};
        const allowedByKind: Record<Kind, string[]> = {
          'academic-years': ['name', 'startsOn', 'endsOn'],
          terms: ['academicYearId', 'name', 'sequence', 'startsOn', 'endsOn'],
          classes: ['name', 'code'],
          sections: ['classId', 'name', 'code'],
          subjects: ['name', 'code'],
        };
        if (Object.keys(body).some((key: string) => !allowedByKind[kind].includes(key))) return error('Submit only the displayed academic details. Record identifiers are generated by the server.', 400);
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (name.length < 2 || name.length > 100) return error('Name must contain 2 to 100 characters.', 400);
        const code = body.code === undefined ? '' : String(body.code).trim();
        if (['classes', 'sections', 'subjects'].includes(kind) && (code.length < 1 || code.length > 30)) return error('Enter a code between 1 and 30 characters.', 400);
        const timestamp = now();
        const record: Record<string, any> = {
          id: crypto.randomUUID(),
          tenantId: access.tenantId,
          schoolId: access.schoolId,
          name,
          status: 'active',
          version: 1,
          createdAt: timestamp,
          createdBy: ctx.user.userId,
          updatedAt: timestamp,
          updatedBy: ctx.user.userId,
        };
        if (kind === 'academic-years') {
          if (!validDateRange(body.startsOn, body.endsOn)) return error('Enter a valid academic-year start and end date.', 400);
          Object.assign(record, { startsOn: body.startsOn, endsOn: body.endsOn });
        } else if (kind === 'terms') {
          if (!validId(body.academicYearId) || !Number.isInteger(body.sequence) || Number(body.sequence) < 1 || Number(body.sequence) > 20 || !validDateRange(body.startsOn, body.endsOn)) return error('Choose an academic year, term sequence and valid date range.', 400);
          const [year] = await db.get<Record<string, any>>(tenantTable(TABLES['academic-years'], access.tenantId), [body.academicYearId], { consistent: true });
          if (!year || year.tenantId !== access.tenantId || year.schoolId !== access.schoolId || year.status !== 'active') return error('The selected academic year is not available for this school.', 404);
          record.academicYearId = body.academicYearId;
          record.sequence = Number(body.sequence);
          record.startsOn = body.startsOn;
          record.endsOn = body.endsOn;
        } else {
          record.code = code.toUpperCase();
          if (kind === 'sections') {
            if (!validId(body.classId)) return error('Choose an existing class.', 400);
            const [parentClass] = await db.get<Record<string, any>>(tenantTable(TABLES.classes, access.tenantId), [body.classId], { consistent: true });
            if (!parentClass || parentClass.tenantId !== access.tenantId || parentClass.schoolId !== access.schoolId || parentClass.status !== 'active') return error('The selected class is not available for this school.', 404);
            record.classId = body.classId;
          }
        }
        const audit = auditRecord(access.tenantId, ctx.user.userId, 'academic-reference.created', kind, { schoolId: access.schoolId, name, code: record.code || null });
        const event = domainEvent(
          access.tenantId,
          ctx.user.userId,
          'academic-reference.created',
          kind,
          record.id,
          { schoolId: access.schoolId, name, code: record.code || null },
          crypto.randomUUID(),
          timestamp,
        );
        await db.transact([
          db.tx.add(tenantTable(TABLES[kind], access.tenantId), [record]),
          db.tx.add(tenantTable('audit_events', access.tenantId), [audit]),
          db.tx.add(tenantTable('domain_events', access.tenantId), [event]),
        ]);
        return json({ item: record }, 201);
      } catch (cause) {
        return apiFailure(cause, 'Unable to save this academic reference. Refresh and retry.', {
          logLabel: 'academic.catalog.create failed',
        });
      }
    },
  ],
};
