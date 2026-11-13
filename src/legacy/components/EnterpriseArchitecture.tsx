// @ts-nocheck -- imported School Hub source, kept as-is
import React from 'react';
import { Activity, ArrowRightLeft, Banknote, BookOpen, CheckCircle2, CircleDashed, Code2, Database, Fingerprint, Layers3, LockKeyhole, Network, Server, ShieldCheck, Webhook } from 'lucide-react';
import './EnterpriseArchitecture.css';

type RoadmapItem = { name: string; purpose: string; status: string; dependency: string };
const permissionRows = [
  ['View', 'read', 'List and retrieve authorised records'],
  ['Add', 'create', 'Create validated records with tenant ownership'],
  ['Edit', 'update', 'Change permitted fields with version and audit checks'],
  ['Delete', 'delete', 'Soft-delete or archive where retention rules require it'],
];
const workspaces = [
  { role: 'Platform owner', purpose: 'Tenant lifecycle, platform-wide governance, service health and controlled support access.', scope: 'Platform-level grants; audited and time-bound support access' },
  { role: 'School administrator', purpose: 'School setup, users, enrolment, academic operations, reports and delegated permissions.', scope: 'Assigned tenant and authorised school branches' },
  { role: 'Headteacher / Principal', purpose: 'School oversight, approvals, performance, attendance, finance summaries and compliance.', scope: 'Assigned school; approval thresholds' },
  { role: 'Bursar / Finance officer', purpose: 'Fee schedules, invoices, receipts, payment allocation, expenses, ledgers and reconciliation.', scope: 'Finance resources; separation of duties' },
  { role: 'Teacher', purpose: 'Assigned classes, subject registers, attendance, assessment marks and learner progress.', scope: 'Assigned classes, subjects and academic periods' },
  { role: 'Admissions / Registrar', purpose: 'Applications, document checks, admission decisions, student records and transfers.', scope: 'Admissions and student records in assigned schools' },
  { role: 'Parent / Guardian', purpose: 'Linked learner profiles, attendance, results, notices, invoices and payment history.', scope: 'Only verified linked learners and permitted fields' },
  { role: 'Student', purpose: 'Personal timetable, learning resources, attendance summary, results and notices.', scope: 'Own learner record and published information' },
];
const modules: { group: string; items: RoadmapItem[] }[] = [
  { group: 'Platform, governance & configuration', items: [
    { name: 'Dashboard', purpose: 'Tenant-scoped operational KPIs, alerts and role-specific quick actions.', status: 'Demo / replace with live aggregates', dependency: 'Authorised aggregate APIs; current dashboard metrics and activity are illustrative' },
    { name: 'User management', purpose: 'AppDeploy identity, tenant memberships, configurable roles, CRUD permissions and delegated access.', status: 'Foundation / extend', dependency: 'Central role, scope and membership APIs exist; lifecycle and route coverage require expansion' },
    { name: 'User verification', purpose: 'Verified identity and contact evidence, account activation and controlled recovery.', status: 'Planned', dependency: 'AppDeploy identity lifecycle and approved verification provider contracts' },
    { name: 'Archives', purpose: 'Retention-aware archive, restore, export and legal-hold workflows.', status: 'Planned', dependency: 'Domain soft-delete rules, retention policy and audit controls' },
    { name: 'System & platform configuration', purpose: 'Versioned tenant settings, organisation hierarchy, security, workflows and integration policy.', status: 'Foundation / extend', dependency: 'Central AppDeploy configuration and governance services exist; complete consumer adoption remains' },
    { name: 'Financial configuration', purpose: 'Currency, fee rules, invoice and receipt numbering, payment controls and accounting policy.', status: 'Foundation / extend', dependency: 'Central finance configuration keys exist; finance domain consumers and validation need completion' },
    { name: 'Academic configuration', purpose: 'Academic years, terms, grading scales, calendar, attendance and promotion policy.', status: 'Foundation / extend', dependency: 'School-scoped academic registries and central academic settings exist; curriculum coverage remains' },
    { name: 'People configuration', purpose: 'Staff categories, employment rules, positions and guardian relationship policy.', status: 'Partial / extend', dependency: 'Staff and guardian foundations exist; central people-policy consumers remain' },
    { name: 'Operations configuration', purpose: 'Workflow deadlines, escalation, backup references, retention and operational settings.', status: 'Partial / extend', dependency: 'Central settings and escalation handler exist; checkpointing and operational delivery remain' },
    { name: 'Reporting & records configuration', purpose: 'Report definitions, access, retention, export and records lifecycle policy.', status: 'Partial / extend', dependency: 'Reporting retention setting exists; dedicated reporting configuration and consumers remain' },
  ]},
  { group: 'Academic & learner lifecycle', items: [
    { name: 'Admissions', purpose: 'School-scoped applications, document review, decisions, generated application numbers and enrolment.', status: 'Foundation / extend', dependency: 'AppDeploy admissions API and workspace exist; document storage, enrolment conversion and lifecycle breadth remain' },
    { name: 'Students', purpose: 'Student master records, school enrolment, identifiers, history and controlled profile changes.', status: 'Foundation / extend', dependency: 'AppDeploy student APIs and workspace exist; bulk import, promotion and extended history remain' },
    { name: 'Parent communication', purpose: 'Verified guardian links, consent-aware notices, messaging and parent portal visibility.', status: 'Partial / extend', dependency: 'Guardian profiles and student relationships exist; portal, messaging and delivery logs remain' },
    { name: 'Attendance', purpose: 'Daily/period registers, roster marking, correction approvals and attendance reporting.', status: 'Foundation / extend', dependency: 'AppDeploy attendance APIs and workspace exist; expanded reporting and operational scale controls remain' },
    { name: 'Lessons', purpose: 'Teacher lesson planning, curriculum coverage, resources and lesson delivery records.', status: 'Planned', dependency: 'Academic registry, teaching assignments and content storage' },
    { name: 'Assignments', purpose: 'Assignment creation, distribution, submissions, marking and feedback.', status: 'Planned', dependency: 'Teaching assignments, student enrolment, file storage and assessment policy' },
    { name: 'Exams & quizzes', purpose: 'Examination sessions, papers, candidate lists, schedules and controlled score entry.', status: 'Foundation / extend', dependency: 'AppDeploy examination APIs exist; quiz delivery, question bank and broader scheduling remain' },
    { name: 'Assessment', purpose: 'Assessment plans, score entry, independent moderation and configured weighting.', status: 'Foundation / extend', dependency: 'AppDeploy assessment APIs and workspace exist; coverage and scale hardening remain' },
    { name: 'Results', purpose: 'Grading, weighted result generation, approval, controlled publication and correction.', status: 'Foundation / extend', dependency: 'AppDeploy result and grading workflows exist; transcript and progression breadth remain' },
    { name: 'Termly reports', purpose: 'Report-card generation, approval, publication and learner/guardian access.', status: 'Foundation / extend', dependency: 'AppDeploy report-card workflow exists; template, export and portal extensions remain' },
    { name: 'Timetable', purpose: 'School calendars, class schedules, teacher/room allocation and clash detection.', status: 'Foundation / extend', dependency: 'AppDeploy timetable routes exist; full scheduling UX and resource-conflict coverage remain' },
    { name: 'Performance tracker', purpose: 'Longitudinal learner, class and subject performance indicators and interventions.', status: 'Planned', dependency: 'Authorised attendance, assessment and result aggregates' },
  ]},
  { group: 'People, finance & engagement', items: [
    { name: 'Staff management', purpose: 'Staff profiles, employment lifecycle, history and school-scoped access.', status: 'Foundation / extend', dependency: 'AppDeploy staff APIs and workspace exist; leave, payroll and broader HR workflows remain' },
    { name: 'Fees & invoicing', purpose: 'Fee structures, billing schedules, discounts, invoices, receipts and arrears.', status: 'Planned', dependency: 'Student enrolment, central finance configuration and accounting controls' },
    { name: 'Invoices', purpose: 'Versioned invoice lifecycle, line items, approvals, adjustments and receivables.', status: 'Planned', dependency: 'Fee schedules, finance ledger and payment allocation services' },
    { name: 'Financial management', purpose: 'Receipts, payment allocation, accounting, journals, budgets, reconciliation and payroll.', status: 'Planned', dependency: 'Finance domain services, maker-checker workflow and verified payment adapters' },
    { name: 'Publicity', purpose: 'Public notices, circulars, articles, events and approved school announcements.', status: 'Planned', dependency: 'Publishing workflow, content storage and public/private visibility rules' },
    { name: 'Messaging', purpose: 'Internal messages, consent-aware SMS/email adapters, delivery status and retry handling.', status: 'Planned', dependency: 'Verified contact preferences, provider secrets and delivery consumers' },
    { name: 'Library', purpose: 'Cataloguing, circulation, reservations, fines and stock reconciliation.', status: 'Planned', dependency: 'Student/staff registry, inventory and finance integration' },
    { name: 'Advanced reporting', purpose: 'Role-scoped reports, reconciled KPIs, exports and scheduled report jobs.', status: 'Planned', dependency: 'Authorised domain APIs, report definitions and bounded export processing' },
  ]},
];
const apiGroups = [
  ['Platform', 'GET /api/v1/platform/me', 'GET /api/v1/tenants', 'GET /api/v1/tenants/{tenantId}/configuration'],
  ['Identity & access', 'GET /api/v1/tenants/{tenantId}/memberships', 'GET /api/v1/tenants/{tenantId}/roles', 'PUT /api/v1/tenants/{tenantId}/roles/{roleId}/permissions'],
  ['Students & academics', 'POST /api/v1/tenants/{tenantId}/students', 'GET /api/v1/tenants/{tenantId}/attendance', 'POST /api/v1/tenants/{tenantId}/assessments'],
  ['Finance & payments', 'POST /api/v1/tenants/{tenantId}/invoices', 'POST /api/v1/tenants/{tenantId}/payment-intents', 'POST /api/v1/webhooks/payments/{provider}'],
];
const paymentAdapters = [
  ['Paystack', 'Card and supported mobile-money checkout; verify signed webhook and provider transaction status.'],
  ['Hubtel', 'Ghana payment collection adapter; confirm provider API product, settlement and webhook contract before activation.'],
  ['MTN Mobile Money', 'MoMo collection adapter; verify callback authenticity, transaction status and reconciliation reference.'],
  ['Other providers', 'Provider-neutral interface for future gateways without embedding provider logic in fee or invoice modules.'],
];

function Status({ value }: { value: string }) {
  return <span className={'ea-status ' + (value.includes('Foundation') ? 'foundation' : value.includes('adapter') ? 'adapter' : 'planned')}>{value}</span>;
}

export default function EnterpriseArchitecture() {
  return <div className='ea-page'>
    <header className='ea-heading'>
      <div className='eyebrow'>ENTERPRISE ENGINEERING BLUEPRINT</div>
      <h1>Full-stack architecture & implementation register</h1>
      <p>One governed platform for multiple schools: centrally owned business rules, tenant-aware APIs, relational integrity and role-specific workflows.</p>
    </header>
    <section className='ea-callout'>
      <div className='ea-callout-icon'><Layers3 size={23}/></div>
      <div><b>Target: modular monolith with domain boundaries</b><p>Keep the first production release cohesive and transaction-safe. Split services only when scale, ownership or operational evidence justifies it. Every module consumes shared contracts instead of owning duplicate rules.</p></div>
      <Status value='TARGET ARCHITECTURE'/>
    </section>
    <div className='ea-metrics'>
      <div><span>CURRENT SERVER RUNTIME</span><b>AppDeploy TypeScript backend</b><small>Authenticated routes and shared domain services</small></div>
      <div><span>CURRENT PERSISTENCE</span><b>AppDeploy native persistence</b><small>Authoritative runtime store; no Supabase connection</small></div>
      <div><span>FUTURE DATABASE</span><b>PostgreSQL SQL / RLS</b><small>Versioned migration scaffolding only; not connected or executed</small></div>
      <div><span>IDENTITY & POLICY</span><b>AppDeploy Auth · RBAC · ABAC</b><small>Central tenant membership, school scope and deny-by-default policy</small></div>
    </div>
    <section className='panel ea-panel'>
      <div className='ea-section-head'><div><h2>Application architecture</h2><p>Each layer has a defined responsibility and must not bypass the layer below it.</p></div><Network size={19}/></div>
      <div className='ea-layer-grid'>
        <article><BookOpen/><b>Experience layer</b><strong>React + TypeScript</strong><p>Role-specific dashboards, forms, portals, accessibility and responsive experiences.</p></article>
        <article><Server/><b>Server application layer</b><strong>AppDeploy TypeScript backend</strong><p>Authenticated HTTP routes, shared validation and authorization, domain services, audit/events and scheduled handlers.</p></article>
        <article><Layers3/><b>Domain & business logic</b><strong>Shared domain modules</strong><p>One authoritative implementation for enrolment, attendance, grading, billing, accounting and approvals.</p></article>
        <article><Fingerprint/><b>Identity & policy</b><strong>AppDeploy Auth + centralized RBAC/ABAC</strong><p>AppDeploy identity, active tenant membership, school scope, CRUD grants, record-derived ABAC and explicit-deny precedence.</p></article>
        <article><Database/><b>Persistence layer</b><strong>AppDeploy persistence (current)</strong><p>Tenant-partitioned AppDeploy records are authoritative. PostgreSQL schema, constraints and RLS remain versioned future-migration scaffolding only.</p></article>
        <article><Webhook/><b>Integration & operations</b><strong>Provider adapters</strong><p>Payments, SMS, email, storage, queues, observability, secrets and recovery controls.</p></article>
      </div>
    </section>
    <div className='ea-two-col'>
      <section className='panel ea-panel'>
        <div className='ea-section-head'><div><h2>Basic permission operations</h2><p>Permission is checked on every server request and every affected record.</p></div><LockKeyhole size={19}/></div>
        <div className='ea-permission-table'>
          {permissionRows.map(row=><div className='ea-permission-row' key={row[0]}><b>{row[0]}</b><code>{row[1]}</code><span>{row[2]}</span></div>)}
        </div>
        <p className='ea-note'>ABAC adds tenantId, schoolId, assigned class/subject, record ownership, approval state and data sensitivity. Deny overrides allow; missing grants deny by default.</p>
      </section>
      <section className='panel ea-panel'>
        <div className='ea-section-head'><div><h2>Financial safeguards</h2><p>CRUD access is not a substitute for accounting controls.</p></div><Banknote size={19}/></div>
        <ul className='ea-check-list'>
          <li>Posted invoices and journals are corrected through credit notes or reversals—not silent deletion.</li>
          <li>Payment callbacks are signature-verified, idempotent and checked against provider status.</li>
          <li>Maker-checker approvals separate preparation, approval and release of funds.</li>
          <li>Payment allocations cannot exceed an invoice balance or a payment's unallocated balance.</li>
          <li>Reconciliation compares provider settlements, receipts, bank statements and ledger postings.</li>
          <li>Amounts use fixed-precision decimal columns and explicit currency codes.</li>
        </ul>
      </section>
    </div>
    <section className='panel ea-panel'>
      <div className='ea-section-head'><div><h2>Example user experiences (not fixed security roles)</h2><p>These are illustrative personas only. Each tenant super administrator creates the actual role definitions and assigns permissions centrally.</p></div><ShieldCheck size={19}/></div>
      <div className='ea-note'>These examples describe possible user journeys, not mandatory roles. Role definitions and access grants are created per tenant in Role &amp; Permission Management.</div>
      <div className='ea-role-grid'>{workspaces.map(role=><article key={role.role}><b>{role.role}</b><p>{role.purpose}</p><small>{role.scope}</small></article>)}</div>
    </section>
    <section className='panel ea-panel'>
      <div className='ea-section-head'><div><h2>REST API contract map</h2><p>Illustrative versioned routes for future implementation; not all routes are live today.</p></div><Code2 size={19}/></div>
      <div className='ea-api-grid'>{apiGroups.map(group=><article key={group[0]}><b>{group[0]}</b>{group.slice(1).map(route=><code key={route}>{route}</code>)}</article>)}</div>
      <p className='ea-note'>All write endpoints require authentication, tenant/school context, request validation, permission checks, idempotency where relevant, audit correlation and documented error responses. Publish an OpenAPI contract and generate typed clients.</p>
    </section>
    <section className='panel ea-panel'>
      <div className='ea-section-head'><div><h2>External payment integration adapters</h2><p>Provider-neutral boundary; the platform must not store card data or trust a browser redirect as proof of payment.</p></div><ArrowRightLeft size={19}/></div>
      <div className='ea-payment-grid'>{paymentAdapters.map(([name, purpose])=><article key={name}><b>{name}</b><p>{purpose}</p><Status value='PLACEHOLDER'/></article>)}</div>
      <div className='ea-flow'>Invoice created <ArrowRightLeft size={15}/> Payment intent <ArrowRightLeft size={15}/> Provider checkout <ArrowRightLeft size={15}/> Signed webhook verification <ArrowRightLeft size={15}/> Idempotent ledger posting <ArrowRightLeft size={15}/> Reconciliation</div>
      <p className='ea-note'>No live gateway is connected. API credentials, merchant onboarding, webhook secrets, sandbox certification and settlement testing must be completed before accepting real payments.</p>
    </section>
    <section className='panel ea-panel'>
      <div className='ea-section-head'><div><h2>Upcoming implementation register</h2><p>Every placeholder has a purpose and named dependencies; status is explicit to avoid presenting planned functionality as complete.</p></div><CircleDashed size={19}/></div>
      {modules.map(group=><div className='ea-module-group' key={group.group}><h3>{group.group}</h3><div className='ea-module-list'>{group.items.map(item=><article key={item.name}><div><b>{item.name}</b><p>{item.purpose}</p><small>Dependencies: {item.dependency}</small></div><Status value={item.status}/></article>)}</div></div>)}
    </section>
    <section className='panel ea-panel'>
      <div className='ea-section-head'><div><h2>Functional reference: eSkooly-style school workflows</h2><p>Use familiar operational journeys as acceptance references while improving the underlying controls.</p></div><CheckCircle2 size={19}/></div>
      <div className='ea-reference-grid'>
        <article><b>School workflows to benchmark</b><p>Admissions and student profiles; class/subject setup; attendance; exams, marks and report cards; fee invoices and receipts; parent communication; timetable; staff; library and transport.</p></article>
        <article><b>Enterprise improvements required</b><p>Normalised relational data, composite tenant foreign keys, transaction-safe finance, immutable audit history, scoped permissions, configurable approval policies, API contracts, idempotent integrations and automated regression tests.</p></article>
      </div>
    </section>
    <div className='ea-footnote'><Activity size={16}/> Current runtime authority: AppDeploy authentication, backend, persistence and centralized tenant/RBAC/ABAC services. The PostgreSQL/Supabase SQL package is future-only scaffolding; no live Supabase Auth, persistence or competing runtime is configured. Module statuses above distinguish existing foundations from partial and not-yet-implemented workflows.</div>
  </div>;
}
