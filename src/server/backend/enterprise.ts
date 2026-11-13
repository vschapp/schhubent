// @ts-nocheck -- imported School Hub source, kept as-is
import { json, requireAuth, router } from '@/server/appdeploy-sdk';
import { CRUD_PERMISSIONS, ENTERPRISE_CAPABILITIES, PAYMENT_ADAPTERS } from './enterprise-contracts';
import { roleRoutes } from './roles';
import { scopeRoutes } from './scopes';
import { studentRoutes } from './students';
import { schoolRoutes } from './schools';
import { academicRoutes } from './academic';
import { governanceRoutes } from './governance';
import { admissionsRoutes } from './admissions';
import { staffRoutes } from './staff';
import { guardianRoutes } from './guardians';
import { academicOperationsRoutes } from './academic-operations';
import { timetableRoutes } from './academic-operations';
import { assessmentExaminationRoutes } from './assessment-examinations';
import { dashboardRoutes } from './dashboard';
import { learningRoutes } from './learning';

const modules = [
  { domain: 'platform', resources: ['tenant', 'school', 'organisation-node', 'membership', 'role', 'permission', 'configuration', 'configuration-history', 'audit', 'workflow', 'workflow-instance'] },
  { domain: 'admissions', resources: ['application', 'admission-decision', 'enrolment'] },
  { domain: 'student', resources: ['student', 'guardian', 'student-guardian', 'student-history'] },
  { domain: 'people', resources: ['staff-profile', 'staff-employment-history'] },
  { domain: 'academics', resources: ['academic-year', 'term', 'class', 'section', 'subject', 'teaching-assignment', 'lesson', 'learning-assignment', 'assignment-submission', 'timetable'] },
  { domain: 'attendance', resources: ['attendance-register', 'attendance-entry', 'correction-request'] },
  { domain: 'assessment', resources: ['assessment', 'exam', 'mark', 'grade', 'result', 'report-card'] },
  { domain: 'finance', resources: ['fee-structure', 'invoice', 'receipt', 'payment', 'allocation', 'journal', 'expense', 'budget', 'payroll'] },
  { domain: 'campus', resources: ['library-item', 'loan', 'transport-route', 'hostel-room', 'inventory-item', 'purchase-order'] },
  { domain: 'communication', resources: ['notice', 'message', 'delivery-log', 'communication-preference'] },
  { domain: 'analytics', resources: ['dashboard', 'report-definition', 'report-run', 'export-job'] },
];

export const enterpriseRoutes = {
  ...roleRoutes,
  ...scopeRoutes,
  ...studentRoutes,
  ...schoolRoutes,
  ...academicRoutes,
  ...governanceRoutes,
  ...admissionsRoutes,
  ...staffRoutes,
  ...guardianRoutes,
  ...academicOperationsRoutes,
  ...timetableRoutes,
  ...assessmentExaminationRoutes,
  ...dashboardRoutes,
  ...learningRoutes,
  'GET /api/platform/enterprise-blueprint': [
    requireAuth(),
    async () => json({
      capabilities: ENTERPRISE_CAPABILITIES,
      crudPermissions: CRUD_PERMISSIONS,
      paymentAdapters: PAYMENT_ADAPTERS,
      modules,
      apiConvention: '/api/v1/tenants/{tenantId}/{resource}',
      note: 'Blueprint metadata only. Planned domain endpoints and payment providers are not activated by this catalogue.',
    }),
  ],
};

export const enterpriseRouter = router(enterpriseRoutes);
