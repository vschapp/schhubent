// @ts-nocheck -- imported School Hub source, kept as-is
import { useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Bell,
  BookOpen,
  Bus,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  CreditCard,
  FileBarChart,
  GraduationCap,
  Grid2X2,
  LayoutDashboard,
  Library,
  LockKeyhole,
  Menu,
  MessageSquare,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
  Layers3,
  Database,
  Building2,
  Plus,
  Download,
  X,
} from 'lucide-react';
import CentralConfiguration from './components/CentralConfiguration';
import EnterpriseArchitecture from './components/EnterpriseArchitecture';
import RolePermissionManager from './components/RolePermissionManager';
import AuthenticationGate, { useTenantSession } from './components/AuthenticationGate';
import StudentManagement from './components/StudentManagement';
import AcademicConfiguration from './components/AcademicConfiguration';
import PlatformGovernance from './components/PlatformGovernance';
import AdmissionsManagement from './components/AdmissionsManagement';
import StaffManagement from './components/StaffManagement';
import GuardiansManagement from './components/GuardiansManagement';
import AssessmentWorkspace from './components/AssessmentWorkspace';
import AttendanceWorkspace from './components/AttendanceWorkspace';
import DashboardWorkspace from './components/DashboardWorkspace';
import LearningWorkspace from './components/LearningWorkspace';
import TimetableWorkspace from './components/TimetableWorkspace';

const groups = [
  { title: 'OVERVIEW', items: [['Dashboard', LayoutDashboard]] },
  {
    title: 'SCHOOL OPERATIONS',
    items: [
      ['Admissions', ClipboardCheck],
      ['Students', GraduationCap],
      ['Academic Setup', BookOpen],
      ['Guardians & Parents', Users],
      ['Staff & HR', Users],
      ['Attendance', CalendarDays],
      ['Lessons & Assignments', BookOpen],
      ['Timetable', BookOpen],
      ['Examinations', ClipboardCheck],
      ['Results & Reports', FileBarChart],
    ],
  },
  {
    title: 'CAMPUS SERVICES',
    items: [
      ['Library', Library],
      ['Transport', Bus],
      ['Hostel & Dormitory', Building2],
      ['Inventory', Grid2X2],
      ['Communication', MessageSquare],
    ],
  },
  {
    title: 'FINANCE & ADMIN',
    items: [
      ['Fees & Billing', Wallet],
      ['Accounting', CreditCard],
      ['Payroll', Wallet],
      ['Analytics & Reports', FileBarChart],
      ['System Configuration', Settings],
      ['Platform Governance', ShieldCheck],
      ['Architecture & Roadmap', Layers3],
      ['Engineering Architecture', Server],
      ['Role & Permission Management', ShieldCheck],
    ],
  },
];
const phases = [
  [
    '01',
    'Discovery, governance & product foundation',
    'Weeks 1–3',
    'Approved requirements, domain glossary, tenancy model, architecture decisions and delivery backlog.',
    [
      'Confirm school types, Ghana GES workflows, multi-campus and multi-tenant operating model',
      'Map roles, user journeys, approvals, reports and statutory requirements',
      'Define security, data classification, service levels and acceptance criteria',
      'Establish repository, coding standards, CI pipeline and architecture decision log',
    ],
  ],
  [
    '02',
    'Platform core, identity & tenant foundation',
    'Weeks 4–7',
    'Secure tenant-aware platform with identity, RBAC/ABAC, audit trail and configuration framework.',
    [
      'Implement organisation → school/branch → department → unit hierarchy',
      'Build users, memberships, role permissions and delegated administration',
      'Add tenant context enforcement, audit events, MFA strategy and account lifecycle',
      'Build academic year, term, grading, currency, locale and school configuration',
    ],
  ],
  [
    '03',
    'Admissions, student information & guardians',
    'Weeks 8–12',
    'Complete student lifecycle from enquiry and application through admission, enrolment and transfer.',
    [
      'Admissions pipeline, applicant documents, review and approval',
      'Student master profile, identifiers, guardian relationships and emergency contacts',
      'Class, section, house, category, cohort and academic-year enrolment',
      'Bulk import, duplicate detection, student history and promotion readiness',
    ],
  ],
  [
    '04',
    'Academics, attendance & timetable',
    'Weeks 13–17',
    'Operational academic administration with reliable attendance and scheduling.',
    [
      'Curriculum, subjects, class-teacher and subject-teacher assignments',
      'Daily and period attendance, correction approvals and attendance analytics',
      'Timetable builder, room allocation, teacher availability and clash detection',
      'Homework, learning resources, syllabus coverage and academic calendar',
    ],
  ],
  [
    '05',
    'Assessment, examinations & reporting',
    'Weeks 18–22',
    'End-to-end assessment, grading, moderation, results and report-card workflows.',
    [
      'Assessment plans, examination schedules, question bank and online assessment options',
      'Marks entry, validation, moderation, grade scales and configurable weighting',
      'Results publication, merit lists, transcripts, report cards and progression rules',
      'Result audit history, controlled amendments and parent/student visibility',
    ],
  ],
  [
    '06',
    'Finance, billing, accounting & payroll',
    'Weeks 23–29',
    'Auditable financial operations with controlled receivables, payments and payroll.',
    [
      'Fee structures, billing schedules, discounts, scholarships, fines and waivers',
      'Invoices, receipts, balances, arrears, payment allocation and reconciliation',
      'Double-entry chart of accounts, journals, income, expenses, budgets and reports',
      'Staff payroll, deductions, payslips, approvals and period close controls',
    ],
  ],
  [
    '07',
    'People, communication & campus services',
    'Weeks 30–35',
    'Integrated HR, parent engagement and supporting campus operations.',
    [
      'Staff records, leave, attendance, contracts and HR workflows',
      'Notices, SMS/email/push adapters, message logs and parent portal',
      'Library circulation, transport routes, hostel allocation and inventory',
      'Certificates, ID cards, visitor management, complaints and document registry',
    ],
  ],
  [
    '08',
    'Analytics, integrations & mobile experience',
    'Weeks 36–40',
    'Role-specific insight, external integrations and responsive user experiences.',
    [
      'Operational dashboards, risk indicators and configurable report builder',
      'Payment, SMS, email, identity and LMS integration adapters',
      'API versioning, webhooks, import/export jobs and integration monitoring',
      'Progressive web app, low-bandwidth optimisation and offline-tolerant workflows',
    ],
  ],
  [
    '09',
    'Hardening, migration, pilot & rollout',
    'Weeks 41–46',
    'Production-ready release with verified recovery, security and school onboarding.',
    [
      'Performance, accessibility, penetration and regression testing',
      'Data migration rehearsals, backup restore drills and disaster recovery exercise',
      'Pilot with representative schools, user training and feedback remediation',
      'Production cutover, monitoring, support playbooks and staged tenant onboarding',
    ],
  ],
];
const layers = [
  [
    'Experience layer',
    'React + TypeScript',
    'Responsive web/PWA, role-aware navigation, design system, accessible forms, dashboards and portals.',
  ],
  [
    'API & application layer',
    'AppDeploy TypeScript backend',
    'Authenticated AppDeploy HTTP routes, shared validation and authorization services, domain events, workflow orchestration and provider adapters.',
  ],
  [
    'Domain layer',
    'Bounded contexts',
    'Admissions, SIS, academics, attendance, assessment, finance, HR, communications and campus services.',
  ],
  [
    'Identity & policy layer',
    'AppDeploy Auth + centralized RBAC/ABAC',
    'AppDeploy identity, active tenant membership, dynamic role grants, record-derived school scope and deny-by-default policy evaluation. MFA assurance remains a gated capability.',
  ],
  [
    'Persistence & integration',
    'AppDeploy persistence (current); PostgreSQL SQL (future only)',
    'AppDeploy native persistence is authoritative today. Versioned PostgreSQL SQL and RLS scaffolding is retained for a separately approved future migration and is not connected.',
  ],
  [
    'Operations & platform',
    'AppDeploy managed runtime',
    'AppDeploy deployment and runtime status, managed secrets, scheduled handlers and platform operational controls; additional observability and recovery evidence remains a release gate.',
  ],
];
const descriptions: Record<string, string> = {
  Admissions:
    'Enquiries, applications, document review, admission decisions and enrolment conversion.',
  Students:
    'Student master records, guardians, history, houses, categories, transfers and promotion.',
  'Guardians & Parents':
    'Guardian relationships, portal access, communication preferences and student-linked visibility.',
  'Staff & HR':
    'Staff profiles, departments, positions, contracts, leave, attendance and payroll records.',
  Attendance:
    'Daily and period attendance, authorised corrections, registers and trend reporting.',
  Timetable:
    'Academic calendars, class schedules, room allocation and teacher/room clash detection.',
  Examinations:
    'Assessment plans, examination schedules, question banks, marks entry and moderation.',
  'Results & Reports':
    'Grading, result publication, report cards, transcripts, merit lists and progression.',
  Library:
    'Cataloguing, circulation, reservations, fines and inventory reconciliation.',
  Transport:
    'Routes, vehicles, stops, student assignments, schedules and transport billing.',
  'Hostel & Dormitory':
    'Hostel capacity, room allocation, occupancy, inspections and boarding records.',
  Inventory:
    'Items, stores, stock movements, requisitions, purchase records and asset tracking.',
  Communication:
    'Notices, messages, SMS/email delivery, parent engagement and communication logs.',
  'Fees & Billing':
    'Fee structures, invoices, discounts, scholarships, collections, arrears and receipts.',
  Accounting:
    'Chart of accounts, journals, ledgers, income, expenses, budgets and reconciliations.',
  Payroll:
    'Payroll periods, salary components, deductions, approvals and payslips.',
  'Analytics & Reports':
    'Cross-module KPIs, scheduled reports, export controls and management insights.',
  'System Configuration':
    'Tenant profile, branches, academic setup, financial rules, grading, workflows and security settings.',
  'Platform Governance':
    'Organisation hierarchy, membership lifecycle, delegated authority, approval workflows and audit history.',
};
function SchoolHubWorkspace() {
  const { tenantId, tenants } = useTenantSession();
  const activeTenant = tenants.find(tenant => tenant.tenantId === tenantId);
  const [active, setActive] = useState('Dashboard');
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState(false);
  const [open, setOpen] = useState(phases.map((_, i) => i));
  const [toast, setToast] = useState('');
  const filtered = useMemo(
    () =>
      groups
        .map(g => ({
          ...g,
          items: g.items.filter(i =>
            i[0].toLowerCase().includes(query.toLowerCase())
          ),
        }))
        .filter(g => g.items.length),
    [query]
  );
  const notify = (s: string) => {
    setToast(s);
    window.setTimeout(() => setToast(''), 2600);
  };
  const go = (s: string) => {
    setActive(s);
    setMenu(false);
  };
  const toggle = (i: number) =>
    setOpen(v => (v.includes(i) ? v.filter(x => x !== i) : [...v, i]));
  const architecture = active === 'Architecture & Roadmap';
  const dashboard = false; // Legacy illustrative view retained only as migration reference.
  return (
    <div className="shell">
      <aside className={'sidebar ' + (menu ? 'open' : '')}>
        <div className="brand">
          <div className="brand-mark">
            <GraduationCap size={22} />
          </div>
          <div>
            <strong>School Hub</strong>
            <span>ENTERPRISE</span>
          </div>
          <button
            className="icon-btn mobile-close"
            onClick={() => setMenu(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="tenant-switch">
          <div className="tenant-avatar">AA</div>
          <div className="tenant-copy">
            <b>{activeTenant?.name || 'School workspace'}</b>
            <span>Tenant workspace</span>
          </div>
          <ChevronDown size={16} />
        </div>
        <div className="nav-search">
          <Search size={15} />
          <input
            aria-label="Search modules"
            placeholder="Find a module..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        <nav className="navigation">
          {filtered.map(g => (
            <section className="nav-group" key={g.title}>
              <div className="nav-heading">{g.title}</div>
              {g.items.map(([name, Icon]: any) => (
                <button
                  key={name}
                  className={'nav-item ' + (active === name ? 'active' : '')}
                  onClick={() => go(name)}
                >
                  <Icon size={17} />
                  <span>{name}</span>
                </button>
              ))}
            </section>
          ))}
          {!filtered.length && (
            <div className="empty-nav">No matching modules</div>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card">
            <CircleHelpIcon />
            <div>
              <b>Need a hand?</b>
              <span>Explore the platform guide</span>
            </div>
            <ChevronRight size={15} />
          </div>
          <div className="profile">
            <div className="profile-avatar">NA</div>
            <div className="profile-copy">
              <b>School Administrator</b>
              <span>Platform owner</span>
            </div>
          </div>
        </div>
      </aside>
      {menu && (
        <button
          className="scrim"
          onClick={() => setMenu(false)}
          aria-label="Close navigation"
        />
      )}
      <main className="main">
        <header className="topbar">
          <div className="top-left">
            <button className="icon-btn menu-btn" onClick={() => setMenu(true)}>
              <Menu size={20} />
            </button>
            <div className="crumb">
              Workspace <ChevronRight size={14} />
              <b>{active}</b>
            </div>
          </div>
          <div className="top-actions">
            <span className="env-pill">● APPDEPLOY LIVE RUNTIME</span>
            <button
              className="icon-btn"
              onClick={() => notify('You are all caught up.')}
            >
              <Bell size={18} />
            </button>
            <div className="top-avatar">NA</div>
          </div>
        </header>
        <div className="content">
          {dashboard ? (
            <>
              <div className="welcome-row">
                <div>
                  <div className="eyebrow">
                    SUNDAY, NOVEMBER 8, 2026 · TERM 1
                  </div>
                  <h1>
                    Good evening, Administrator <span>✦</span>
                  </h1>
                  <p>
                    Here is what is happening across your school workspace
                    today.
                  </p>
                </div>
                <div className="welcome-actions">
                  <button
                    className="btn secondary"
                    onClick={() =>
                      notify(
                        'Report export will be enabled in the reporting phase.'
                      )
                    }
                  >
                    <Download size={16} /> Export overview
                  </button>
                  <button
                    className="btn primary"
                    onClick={() => go('Admissions')}
                  >
                    <Plus size={17} /> New admission
                  </button>
                </div>
              </div>
              <div className="metric-grid">
                <Metric
                  title="Total students"
                  value="2,486"
                  change="+8.2%"
                  note="vs. previous term"
                  icon={GraduationCap}
                  tone="blue"
                />
                <Metric
                  title="Staff members"
                  value="148"
                  change="+3.4%"
                  note="vs. previous term"
                  icon={Users}
                  tone="violet"
                />
                <Metric
                  title="Attendance today"
                  value="94.8%"
                  change="+1.6%"
                  note="vs. last school day"
                  icon={CalendarDays}
                  tone="green"
                />
                <Metric
                  title="Fees collected"
                  value="GH₵ 486,250"
                  change="72.4%"
                  note="of termly target"
                  icon={Wallet}
                  tone="amber"
                />
              </div>
              <div className="dashboard-grid">
                <section className="panel performance">
                  <PanelHead
                    title="School performance"
                    subtitle="Key operational indicators · Term 1"
                  />
                  <div className="chart-legend">
                    <span>● Attendance</span>
                    <span>● Academic progress</span>
                  </div>
                  <div className="chart">
                    <div className="y-labels">
                      <span>100%</span>
                      <span>75%</span>
                      <span>50%</span>
                      <span>25%</span>
                      <span>0%</span>
                    </div>
                    <div className="chart-area">
                      <div className="grid-lines">
                        <i />
                        <i />
                        <i />
                        <i />
                        <i />
                      </div>
                      <svg
                        viewBox="0 0 660 210"
                        preserveAspectRatio="none"
                        role="img"
                        aria-label="Illustrative school performance trend"
                      >
                        <path
                          d="M0 80 C45 72 55 94 100 75 S160 62 200 68 S260 42 300 56 S360 48 400 52 S460 28 500 43 S560 25 600 32 S640 24 660 18 L660 210 L0 210Z"
                          fill="#4777ef"
                          opacity=".09"
                        />
                        <path
                          d="M0 80 C45 72 55 94 100 75 S160 62 200 68 S260 42 300 56 S360 48 400 52 S460 28 500 43 S560 25 600 32 S640 24 660 18"
                          fill="none"
                          stroke="#4777ef"
                          strokeWidth="3"
                        />
                        <path
                          d="M0 132 C45 125 55 142 100 124 S160 114 200 122 S260 98 300 110 S360 102 400 112 S460 90 500 98 S560 82 600 88 S640 76 660 82"
                          fill="none"
                          stroke="#9274df"
                          strokeWidth="3"
                          strokeDasharray="5 5"
                        />
                      </svg>
                      <div className="x-labels">
                        <span>Week 1</span>
                        <span>Week 2</span>
                        <span>Week 3</span>
                        <span>Week 4</span>
                        <span>Week 5</span>
                        <span>Week 6</span>
                        <span>Week 7</span>
                      </div>
                    </div>
                  </div>
                </section>
                <section className="panel">
                  <PanelHead
                    title="Quick actions"
                    subtitle="Common administrative tasks"
                  />
                  <div className="quick-grid">
                    <Quick
                      label="Register student"
                      icon={Users}
                      onClick={() => go('Admissions')}
                    />
                    <Quick
                      label="Take attendance"
                      icon={CalendarDays}
                      onClick={() => go('Attendance')}
                    />
                    <Quick
                      label="Record payment"
                      icon={Wallet}
                      onClick={() => go('Fees & Billing')}
                    />
                    <Quick
                      label="Enter results"
                      icon={ClipboardCheck}
                      onClick={() => go('Examinations')}
                    />
                    <Quick
                      label="Send notice"
                      icon={MessageSquare}
                      onClick={() => go('Communication')}
                    />
                    <Quick
                      label="View reports"
                      icon={FileBarChart}
                      onClick={() => go('Analytics & Reports')}
                    />
                  </div>
                </section>
                <section className="panel">
                  <PanelHead
                    title="Recent activity"
                    subtitle="Illustrative events across the workspace"
                  />
                  <ActivityRow
                    title="New student admission initiated"
                    detail="Application · SHS 1 · Admissions"
                    time="12 min ago"
                    icon={GraduationCap}
                  />
                  <ActivityRow
                    title="Fee payment recorded"
                    detail="Receipt · FIN-2026-0841"
                    time="38 min ago"
                    icon={Wallet}
                  />
                  <ActivityRow
                    title="Assessment marks submitted"
                    detail="Integrated Science · SHS 2"
                    time="1 hr ago"
                    icon={ClipboardCheck}
                  />
                  <ActivityRow
                    title="Parent notice published"
                    detail="General announcement · All parents"
                    time="2 hrs ago"
                    icon={MessageSquare}
                  />
                </section>
                <section className="panel">
                  <PanelHead
                    title="Needs your attention"
                    subtitle="Items requiring administrative action"
                  />
                  <Task
                    title="Review pending admission applications"
                    detail="12 applications awaiting review"
                    onClick={() => go('Admissions')}
                  />
                  <Task
                    title="Approve attendance corrections"
                    detail="5 requests submitted"
                    onClick={() => go('Attendance')}
                  />
                  <Task
                    title="Follow up overdue fee balances"
                    detail="GH₵ 38,450 outstanding"
                    onClick={() => go('Fees & Billing')}
                  />
                  <Task
                    title="Complete termly assessment setup"
                    detail="2 classes not configured"
                    onClick={() => go('Examinations')}
                  />
                </section>
              </div>
              <div className="bottom-note">
                <ShieldCheck size={16} /> Tenant-aware workspace · Role-based
                access · Audit-ready operations{' '}
                <span>Illustrative demo data</span>
              </div>
            </>
          ) : architecture ? (
            <>
              <PageHeading
                eyebrow="PRODUCT ENGINEERING BLUEPRINT"
                title="Architecture & implementation roadmap"
                subtitle="The system blueprint and delivery sequence that will govern implementation of School Hub Enterprise."
              />
              <div className="blueprint-banner">
                <div className="banner-icon">
                  <Layers3 size={23} />
                </div>
                <div>
                  <b>Build strategy: modular monolith, domain-first</b>
                  <p>
                    Start with a secure, well-bounded platform. Extract services
                    only when scale, team ownership or operational evidence
                    justifies it.
                  </p>
                </div>
                <span className="status-chip">BASELINE</span>
              </div>
              <section className="panel">
                <PanelHead
                  title="Target architecture"
                  subtitle="Six cooperating layers with clear ownership and dependency direction."
                />
                <div className="layer-list">
                  {layers.map((l, i) => (
                    <div className="layer-row" key={l[0]}>
                      <b className="layer-index">0{i + 1}</b>
                      <div className="layer-icon">
                        {i === 0 ? (
                          <Grid2X2 />
                        ) : i === 1 ? (
                          <Server />
                        ) : i === 2 ? (
                          <Layers3 />
                        ) : i === 3 ? (
                          <LockKeyhole />
                        ) : i === 4 ? (
                          <Database />
                        ) : (
                          <Activity />
                        )}
                      </div>
                      <div className="layer-copy">
                        <b>{l[0]}</b>
                        <span>{l[2]}</span>
                      </div>
                      <span className="layer-tech">{l[1]}</span>
                    </div>
                  ))}
                </div>
              </section>
              <div className="architecture-two">
                <section className="panel">
                  <PanelHead
                    title="Core engineering principles"
                    subtitle="Non-negotiable design rules"
                  />
                  {[
                    [
                      'Tenant isolation',
                      'Every request and data access is scoped to an authorised tenant and school.',
                    ],
                    [
                      'RBAC + ABAC',
                      'Role permissions combine with school, campus, class, ownership and workflow context.',
                    ],
                    [
                      'Financial integrity',
                      'Double-entry accounting, immutable posted transactions and controlled reversals.',
                    ],
                    [
                      'Audit by design',
                      'Actor, tenant, action, timestamp, before/after and correlation references.',
                    ],
                    [
                      'API-first contracts',
                      'Versioned APIs, validation, idempotency and generated client types.',
                    ],
                    [
                      'Preserve business rules',
                      'Regression tests protect existing workflows during every refactor.',
                    ],
                  ].map(x => (
                    <Principle key={x[0]} title={x[0]} text={x[1]} />
                  ))}
                </section>
                <section className="panel">
                  <PanelHead
                    title="Current runtime & future technology boundaries"
                    subtitle="Verified runtime authority now; separately gated migration and integration targets later"
                  />
                  {[
                    ['Frontend', 'React · TypeScript · Vite'],
                    ['Backend', 'AppDeploy TypeScript routes and shared services'],
                    ['Current persistence', 'AppDeploy native persistence'],
                    ['Identity & policy', 'AppDeploy Auth · centralized RBAC/ABAC'],
                    ['Future database', 'Versioned PostgreSQL SQL/RLS scaffolding only'],
                    ['Jobs & events', 'AppDeploy scheduled handlers · domain events'],
                    ['Integrations', 'Provider-neutral adapters; credentials in AppDeploy secrets'],
                    ['Delivery', 'AppDeploy deployment and QA gates'],
                  ].map(x => (
                    <div className="stack-row" key={x[0]}>
                      <span>{x[0]}</span>
                      <b>{x[1]}</b>
                    </div>
                  ))}
                  <div className="warning-note">
                    AppDeploy is the current runtime, identity, authorization and persistence authority. PostgreSQL/Supabase SQL is future-only migration scaffolding; no live Supabase project or competing runtime is configured.
                  </div>
                </section>
              </div>
              <section className="panel">
                <PanelHead
                  title="Phase-by-phase implementation plan"
                  subtitle="Indicative sequence · 46 weeks · gated releases"
                />
                <div className="roadmap">
                  {phases.map((p, i) => (
                    <div className="phase" key={p[0]}>
                      <button className="phase-head" onClick={() => toggle(i)}>
                        <b className="phase-number">{p[0]}</b>
                        <span>
                          <strong>{p[1]}</strong>
                          <small>
                            {p[2]} · {p[3]}
                          </small>
                        </span>
                        <ChevronDown size={18} />
                      </button>
                      {open.includes(i) && (
                        <div className="phase-body">
                          <b>Exit outcome</b>
                          <p>{p[3]}</p>
                          <ul>
                            {p[4].map(t => (
                              <li key={t}>{t}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
              <section className="panel">
                <PanelHead
                  title="Business domain map"
                  subtitle="Shared platform capabilities underpin all functional modules."
                />
                <div className="domain-grid">
                  {[
                    'Organisation & tenancy',
                    'Identity & access',
                    'Student information',
                    'Admissions',
                    'Academics',
                    'Attendance',
                    'Assessment & results',
                    'Finance & accounting',
                    'Human resources',
                    'Parent & student portals',
                    'Communication',
                    'Library & resources',
                    'Transport & hostel',
                    'Inventory & procurement',
                    'Analytics & reporting',
                    'Workflow & audit',
                  ].map((x, i) => (
                    <span key={x}>
                      <i>{String(i + 1).padStart(2, '0')}</i>
                      {x}
                    </span>
                  ))}
                </div>
              </section>
            </>
          ) : active === 'Dashboard' ? (
            <DashboardWorkspace onNavigate={go} />
          ) : active === 'Role & Permission Management' ? (
            <RolePermissionManager />
          ) : active === 'Platform Governance' ? (
            <PlatformGovernance />
          ) : active === 'Engineering Architecture' ? (
            <EnterpriseArchitecture />
          ) : active === 'System Configuration' ? (
            <CentralConfiguration />
          ) : active === 'Admissions' ? (
            <AdmissionsManagement />
          ) : active === 'Guardians & Parents' ? (
            <GuardiansManagement />
          ) : active === 'Staff & HR' ? (
            <StaffManagement />
          ) : active === 'Students' ? (
            <StudentManagement />
          ) : active === 'Academic Setup' ? (
            <AcademicConfiguration />
          ) : active === 'Attendance' ? (
            <AttendanceWorkspace />
          ) : active === 'Lessons & Assignments' ? (
            <LearningWorkspace />
          ) : active === 'Timetable' ? (
            <TimetableWorkspace />
          ) : active === 'Examinations' || active === 'Results & Reports' ? (
            <AssessmentWorkspace />
          ) : (
            <>
              <PageHeading
                eyebrow="SCHOOL MANAGEMENT"
                title={active}
                subtitle={
                  descriptions[active] ||
                  'A dedicated workspace for managing this school function.'
                }
              />
              <div className="module-intro">
                <div className="banner-icon">
                  <BookOpen size={23} />
                </div>
                <div>
                  <b>{active} workspace foundation</b>
                  <p>
                    This domain is included in the approved product
                    architecture. Detailed workflows, permissions, data model,
                    validations and reports will be implemented in their
                    scheduled delivery phase.
                  </p>
                </div>
              </div>
              <div className="module-cards">
                <section className="panel">
                  <PanelHead
                    title="Module scope"
                    subtitle="Capabilities planned for this domain"
                  />
                  {(active === 'Fees & Billing'
                    ? [
                        'Fee structures and billing schedules',
                        'Invoices, discounts and scholarships',
                        'Payment collection and receipt issuance',
                        'Outstanding balances and arrears',
                        'Payment reconciliation and audit trail',
                      ]
                    : active === 'Students'
                      ? [
                          'Student profile and unique identifiers',
                          'Guardian and emergency contact relationships',
                          'Class, section, house and category assignment',
                          'Student history, transfers and promotion',
                          'Bulk import, validation and duplicate detection',
                        ]
                      : [
                          'Domain-specific records and master data',
                          'Create, review, approve and update workflows',
                          'Role- and tenant-scoped access controls',
                          'Operational dashboards, filters and exports',
                          'Audit history and exception handling',
                        ]
                  ).map(s => (
                    <div className="scope-item" key={s}>
                      <CheckCircle2 size={16} />
                      {s}
                    </div>
                  ))}
                </section>
                <section className="panel">
                  <PanelHead
                    title="Delivery status"
                    subtitle="Implementation governance"
                  />
                  <span className="status-chip">PLANNED</span>
                  <h3>Architecture mapped</h3>
                  <p className="muted">
                    Module implementation will follow the phase gates in
                    Architecture & Roadmap. No production records are being
                    created in this demo foundation.
                  </p>
                  <button
                    className="btn primary full"
                    onClick={() => go('Architecture & Roadmap')}
                  >
                    View implementation roadmap <ChevronRight size={16} />
                  </button>
                </section>
              </div>
            </>
          )}
        </div>
      </main>
      {toast && (
        <div className="toast">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
function CircleHelpIcon() {
  return <span className="help-icon">?</span>;
}
function Metric({ title, value, change, note, icon: Icon, tone }: any) {
  return (
    <div className="metric-card">
      <div className="metric-top">
        <span>{title}</span>
        <div className={'metric-icon ' + tone}>
          <Icon size={19} />
        </div>
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-foot">
        <b>{change}</b>
        <span>{note}</span>
      </div>
    </div>
  );
}
function PanelHead({ title, subtitle }: any) {
  return (
    <div className="panel-head">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}
function Quick({ label, icon: Icon, onClick }: any) {
  return (
    <button className="quick-action" onClick={onClick}>
      <span>
        <Icon size={18} />
      </span>
      <b>{label}</b>
      <ChevronRight size={14} />
    </button>
  );
}
function ActivityRow({ title, detail, time, icon: Icon }: any) {
  return (
    <div className="activity-row">
      <div className="activity-icon">
        <Icon size={17} />
      </div>
      <div className="activity-copy">
        <b>{title}</b>
        <span>{detail}</span>
      </div>
      <time>{time}</time>
    </div>
  );
}
function Task({ title, detail, onClick }: any) {
  return (
    <button className="task-row" onClick={onClick}>
      <span className="task-dot" />
      <span>
        <b>{title}</b>
        <small>{detail}</small>
      </span>
      <ChevronRight size={15} />
    </button>
  );
}
function PageHeading({ eyebrow, title, subtitle }: any) {
  return (
    <div className="page-heading">
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>
  );
}
function Principle({ title, text }: any) {
  return (
    <div className="principle">
      <CheckCircle2 size={17} />
      <div>
        <b>{title}</b>
        <span>{text}</span>
      </div>
    </div>
  );
}
export default function App() { return <AuthenticationGate><SchoolHubWorkspace /></AuthenticationGate>; }
