// @ts-nocheck -- imported School Hub source, kept as-is
import { db, error, json, requireAuth } from '@/server/appdeploy-sdk';
import { authorize, authorizeRecord, hasSchoolScope, tenantAccessFromRequest, tenantTable } from './platform';
type Row = Record<string, any>;
async function listTenantRows(tenantId: string, table: string, maximum = 2000): Promise<{ items: Row[]; truncated: boolean }> {
  const items: Row[] = []; let nextToken: string | undefined;
  do {
    const page = await db.list<Row>(tenantTable(table, tenantId), { limit: 100, ...(nextToken ? { nextToken } : {}) });
    for (const row of page.items) if (row?.tenantId === tenantId) items.push(row);
    nextToken = page.nextToken || undefined;
  } while (nextToken && items.length < maximum);
  return { items: items.slice(0, maximum), truncated: Boolean(nextToken) };
}
async function visibleRows(tenantId: string, membership: Row, table: string, resource: string) {
  const page = await listTenantRows(tenantId, table); const items: Row[] = [];
  for (const row of page.items) {
    if (row.status === 'deleted' || typeof row.schoolId !== 'string' || !hasSchoolScope(membership, row.schoolId)) continue;
    if (await authorizeRecord(tenantId, membership, resource, 'read', row)) items.push(row);
  }
  return { items, truncated: page.truncated };
}
export const dashboardRoutes = {
  'GET /api/dashboard/overview': [requireAuth(), async (ctx: any) => {
    try {
      const access = await tenantAccessFromRequest(ctx, { allowBodyFallback: false, requireTenantId: true, maxTenantLength: 128, invalidTenantMessage: 'A valid tenantId query parameter is required.', membershipMessage: 'Tenant membership not found or access denied.' });
      if (!access.ok) return access.response;
      if (!(await authorize(access.tenantId, access.membership, 'dashboard', 'read'))) return error('Permission denied for the dashboard.', 403);
      const [students, staff, admissions, sessions, corrections] = await Promise.all([
        visibleRows(access.tenantId, access.membership, 'students', 'student'),
        visibleRows(access.tenantId, access.membership, 'staff_profiles', 'staff-profile'),
        visibleRows(access.tenantId, access.membership, 'admission_applications', 'admission-application'),
        visibleRows(access.tenantId, access.membership, 'attendance_sessions', 'attendance-register'),
        visibleRows(access.tenantId, access.membership, 'attendance_correction_requests', 'attendance-correction'),
      ]);
      const today = new Date().toISOString().slice(0, 10);
      const sessionIds = new Set(sessions.items.filter(row => row.sessionDate === today && row.status !== 'cancelled').map(row => row.id));
      const attendancePage = await listTenantRows(access.tenantId, 'attendance_records');
      const readableAttendance: Row[] = [];
      for (const row of attendancePage.items) {
        if (!sessionIds.has(row.sessionId) || typeof row.schoolId !== 'string' || !hasSchoolScope(access.membership, row.schoolId)) continue;
        if (await authorizeRecord(access.tenantId, access.membership, 'attendance-entry', 'read', row)) readableAttendance.push(row);
      }
      const present = readableAttendance.filter(row => ['present', 'late'].includes(String(row.attendanceStatus))).length;
      const attendanceRate = readableAttendance.length ? Math.round(present / readableAttendance.length * 1000) / 10 : null;
      let recentActivity: Row[] = [];
      if (await authorize(access.tenantId, access.membership, 'domain-events', 'read')) {
        const events = await listTenantRows(access.tenantId, 'domain_events', 500);
        recentActivity = events.items.filter(event => access.membership.isTenantSuperAdmin === true || (typeof event.payload?.schoolId === 'string' && hasSchoolScope(access.membership, event.payload.schoolId)))
          .sort((left, right) => String(right.occurredAt || '').localeCompare(String(left.occurredAt || ''))).slice(0, 8)
          .map(event => ({ id: event.id, eventType: event.eventType, aggregateType: event.aggregateType, occurredAt: event.occurredAt }));
      }
      return json({
        tenantId: access.tenantId, generatedAt: new Date().toISOString(),
        metrics: {
          activeStudents: students.items.filter(row => row.status === 'active').length,
          activeStaff: staff.items.filter(row => ['active', 'employed'].includes(String(row.status || row.employmentStatus))).length,
          pendingAdmissions: admissions.items.filter(row => ['submitted', 'under_review', 'pending_review'].includes(String(row.status))).length,
          attendanceRate, attendanceRecordsToday: readableAttendance.length,
          pendingAttendanceCorrections: corrections.items.filter(row => row.status === 'pending').length,
        },
        recentActivity,
        coverage: { studentsTruncated: students.truncated, staffTruncated: staff.truncated, admissionsTruncated: admissions.truncated, attendanceTruncated: attendancePage.truncated, correctionsTruncated: corrections.truncated },
        limitations: ['Counts include only records visible to the signed-in membership and its school scope.', 'Finance totals are omitted until an authorised finance ledger and reconciliation API is implemented.'],
      });
    } catch (cause) { console.error('dashboard overview failed', cause); return error('The dashboard could not be loaded. Please retry.', 500); }
  }],
};
