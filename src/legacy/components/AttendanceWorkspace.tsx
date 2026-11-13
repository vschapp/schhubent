// @ts-nocheck -- imported School Hub source, kept as-is
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/appdeploy-client';
import { AlertCircle, CheckCircle2, ClipboardList, LoaderCircle, Plus, RefreshCw } from 'lucide-react';
import { useTenantSession } from './AuthenticationGate';
import { apiErrorMessage } from '../lib/api-error';

type School = { id: string; name: string };
type Ref = { id: string; name: string; academicYearId?: string; classId?: string };
type Student = { id: string; studentNumber: string; firstName: string; lastName: string };
type Session = { id: string; classId: string; sessionDate: string; sessionType: string; status: string; version: number };
type AttendanceRecord = { id: string; studentId: string; attendanceStatus: string; version: number; student?: Student };

const statuses = ['present', 'absent', 'late', 'excused', 'sick', 'authorised_absence'];

export default function AttendanceWorkspace() {
  const { tenantId } = useTenantSession();
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolId, setSchoolId] = useState('');
  const [years, setYears] = useState<Ref[]>([]);
  const [terms, setTerms] = useState<Ref[]>([]);
  const [classes, setClasses] = useState<Ref[]>([]);
  const [sections, setSections] = useState<Ref[]>([]);
  const [subjects, setSubjects] = useState<Ref[]>([]);
  const [yearId, setYearId] = useState('');
  const [termId, setTermId] = useState('');
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().slice(0, 10));
  const [sessionType, setSessionType] = useState('class');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [corrections, setCorrections] = useState<any[]>([]);
  const [marking, setMarking] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');

  async function loadSchools() {
    const response = await api.get('/api/platform/schools?tenantId=' + encodeURIComponent(tenantId));
    const items = response.data.items || [];
    setSchools(items);
    if (!schoolId && items.length) setSchoolId(items[0].id);
  }

  async function loadCatalog() {
    if (!schoolId) return;
    const query = new URLSearchParams({ tenantId, schoolId });
    const response = await api.get('/api/platform/academic-catalog?' + query.toString());
    setYears(response.data.academicYears || []);
    setTerms(response.data.terms || []);
    setClasses(response.data.classes || []);
    setSections(response.data.sections || []);
    setSubjects(response.data.subjects || []);
  }

  async function loadSessions() {
    if (!schoolId) return;
    const query = new URLSearchParams({ tenantId, schoolId, limit: '100' });
    if (classId) query.set('classId', classId);
    const response = await api.get('/api/attendance/sessions?' + query.toString());
    setSessions(response.data.items || []);
  }

  async function loadRegister(sessionId = selectedSession) {
    if (!sessionId) return;
    setLoading(true);
    try {
      const query = new URLSearchParams({ tenantId, limit: '100' });
      const [sessionResponse, studentResponse, recordResponse] = await Promise.all([
        api.get('/api/attendance/sessions?tenantId=' + encodeURIComponent(tenantId) + '&schoolId=' + encodeURIComponent(schoolId) + '&limit=100'),
        api.get('/api/students?' + new URLSearchParams({ tenantId, schoolId, classId, academicYearId: yearId, limit: '100' }).toString()),
        api.get('/api/attendance/sessions/' + encodeURIComponent(sessionId) + '/records?' + query.toString()),
      ]);
      const session = (sessionResponse.data.items || []).find((item: Session) => item.id === sessionId);
      if (session) {
        const studentsForClass = (studentResponse.data.items || []).filter((student: Student) => !sectionId || (student as any).sectionId === sectionId);
        setStudents(studentsForClass);
        setRecords(recordResponse.data.items || []);
        setMarking(Object.fromEntries(studentsForClass.map((student: Student) => [student.id, (recordResponse.data.items || []).find((record: AttendanceRecord) => record.studentId === student.id)?.attendanceStatus || 'present'])));
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadCorrections() {
    if (!schoolId) return;
    const query = new URLSearchParams({ tenantId, schoolId, limit: '100' });
    const response = await api.get('/api/attendance/corrections?' + query.toString());
    setCorrections(response.data.items || []);
  }

  async function createSession(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setFailure(''); setNotice('');
    try {
      const response = await api.post('/api/attendance/sessions?tenantId=' + encodeURIComponent(tenantId), {
        schoolId, classId, sectionId: sectionId || null, subjectId: subjectId || null,
        academicYearId: yearId, termId: termId || null, sessionDate, sessionType,
      });
      setSelectedSession(response.data.item.id);
      await loadSessions();
      setNotice('Attendance register created.');
    } catch (cause) { setFailure(apiErrorMessage(cause, 'Unable to create attendance register.')); }
    finally { setBusy(false); }
  }

  async function saveRegister(event: FormEvent) {
    event.preventDefault();
    if (!selectedSession || !students.length || students.length > 100) return;
    setBusy(true); setFailure(''); setNotice('');
    try {
      const existingIds = new Set(records.map(record => record.studentId));
      const newRecords = students.filter(student => !existingIds.has(student.id)).map(student => ({ studentId: student.id, status: marking[student.id] || 'present' }));
      if (newRecords.length) {
        await api.post('/api/attendance/sessions/' + selectedSession + '/records?tenantId=' + encodeURIComponent(tenantId), { records: newRecords });
      }
      await loadRegister(selectedSession);
      setNotice(newRecords.length ? 'Attendance entries saved.' : 'No new entries to save. Use controlled correction requests to change existing marks.');
    } catch (cause) { setFailure(apiErrorMessage(cause, 'Unable to save attendance register.')); }
    finally { setBusy(false); }
  }

  async function requestCorrection(record: AttendanceRecord) {
    const proposedStatus = window.prompt('New attendance status: ' + statuses.join(', '), record.attendanceStatus);
    if (!proposedStatus || !statuses.includes(proposedStatus)) return;
    const reason = window.prompt('Reason for attendance correction (required).');
    if (!reason?.trim()) return;
    setBusy(true); setFailure('');
    try {
      await api.post('/api/attendance/records/' + record.id + '/corrections?tenantId=' + encodeURIComponent(tenantId), { proposedStatus, reason, expectedVersion: record.version });
      await loadRegister(selectedSession); await loadCorrections();
      setNotice('Attendance correction submitted under the central approval policy.');
    } catch (cause) { setFailure(apiErrorMessage(cause, 'Unable to request attendance correction.')); }
    finally { setBusy(false); }
  }

  async function reviewCorrection(item: any, decision: string) {
    setBusy(true); setFailure('');
    try {
      await api.post('/api/attendance/corrections/' + item.id + '/review?tenantId=' + encodeURIComponent(tenantId), { decision, expectedVersion: item.version });
      await loadRegister(selectedSession); await loadCorrections();
      setNotice('Attendance correction ' + decision + 'd.');
    } catch (cause) { setFailure(apiErrorMessage(cause, 'Unable to review attendance correction.')); }
    finally { setBusy(false); }
  }

  useEffect(() => { void loadSchools().catch(cause => setFailure(apiErrorMessage(cause, 'Unable to load schools.'))); }, [tenantId]);
  useEffect(() => { if (schoolId) { void loadCatalog().catch(cause => setFailure(apiErrorMessage(cause, 'Unable to load academic registry.'))); void loadCorrections().catch(cause => setFailure(apiErrorMessage(cause, 'Unable to load correction queue.'))); } }, [schoolId, tenantId]);
  useEffect(() => { if (schoolId) void loadSessions().catch(cause => setFailure(apiErrorMessage(cause, 'Unable to load attendance sessions.'))); }, [schoolId, classId, yearId]);
  useEffect(() => { if (selectedSession) void loadRegister(selectedSession).catch(cause => setFailure(apiErrorMessage(cause, 'Unable to load attendance register.'))); }, [selectedSession]);

  return <div className="student-page">
    <div className="student-heading"><div><div className="student-eyebrow">ACADEMIC OPERATIONS</div><h1>Attendance</h1><p>Take class attendance using existing student enrolments and the central academic registry. Backdating and corrections follow centrally governed policies.</p></div><div className="student-heading-actions"><button className="student-button secondary" onClick={() => { void loadSessions(); void loadCorrections(); }}><RefreshCw size={14}/>Refresh</button></div></div>
    {failure && <div className="student-alert error"><AlertCircle size={15}/>{failure}</div>}
    {notice && <div className="student-alert success"><CheckCircle2 size={15}/>{notice}</div>}
    <section className="student-panel"><div className="student-form-grid">
      <label className="student-inline-label">School<select value={schoolId} onChange={event => { setSchoolId(event.target.value); setSelectedSession(''); }}><option value="">Select school</option>{schools.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="student-inline-label">Academic year<select value={yearId} onChange={event => setYearId(event.target.value)}><option value="">Select year</option>{years.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="student-inline-label">Term<select value={termId} onChange={event => setTermId(event.target.value)}><option value="">No term</option>{terms.filter(item => !yearId || item.academicYearId === yearId).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="student-inline-label">Class<select value={classId} onChange={event => setClassId(event.target.value)}><option value="">Select class</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </div></section>
    <section className="student-panel"><div className="student-panel-head"><div><h2>Open an attendance register</h2><p>Class, section, subject and academic period are resolved through the active school registry.</p></div></div>
      <form className="student-form" onSubmit={createSession}><div className="student-form-grid">
        <label>Section<select value={sectionId} onChange={event => setSectionId(event.target.value)}><option value="">All sections</option>{sections.filter(item => !classId || item.classId === classId).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Subject (optional)<select value={subjectId} onChange={event => setSubjectId(event.target.value)}><option value="">General register</option>{subjects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Date<input type="date" value={sessionDate} onChange={event => setSessionDate(event.target.value)} required/></label>
        <label>Session type<select value={sessionType} onChange={event => setSessionType(event.target.value)}>{['class','assembly','event','examination','other'].map(item => <option key={item}>{item}</option>)}</select></label>
      </div><div className="student-form-actions"><button className="student-button primary" disabled={busy || !schoolId || !classId || !yearId}><Plus size={14}/>Create register</button></div></form>
    </section>
    <section className="student-panel"><div className="student-panel-head"><div><h2>Attendance sessions</h2><p>Select a register to view and record attendance.</p></div><select value={selectedSession} onChange={event => setSelectedSession(event.target.value)}><option value="">Select session</option>{sessions.map(item => <option key={item.id} value={item.id}>{item.sessionDate} · {item.sessionType} · {item.id.slice(0, 8)}</option>)}</select></div>
      {selectedSession && <form onSubmit={saveRegister}><div className="student-table-wrap"><table className="student-table"><thead><tr><th>Student</th><th>Attendance status</th><th>Existing mark</th></tr></thead><tbody>{students.map(student => { const record = records.find(item => item.studentId === student.id); return <tr key={student.id}><td><b>{student.firstName} {student.lastName}</b><small>{student.studentNumber}</small></td><td><select value={marking[student.id] || 'present'} onChange={event => setMarking(current => ({ ...current, [student.id]: event.target.value }))}>{statuses.map(status => <option key={status}>{status}</option>)}</select></td><td>{record?.attendanceStatus || 'Not recorded'}{record && <button type="button" className="student-button secondary" onClick={() => void requestCorrection(record)}>Request correction</button>}</td></tr>; })}</tbody></table></div><div className="student-form-actions"><button className="student-button primary" disabled={busy || !students.length || students.length > 100}><ClipboardList size={14}/>Save attendance</button>{students.length > 100 && <span>Registers above 100 students require paged marking.</span>}</div></form>}
      {loading && <div className="student-loading"><LoaderCircle size={16}/>Loading register…</div>}
      {selectedSession && !students.length && !loading && <div className="student-empty">No active students were found for the selected class and academic year.</div>}
    </section>
    <section className="student-panel"><div className="student-panel-head"><div><h2>Attendance correction approvals</h2><p>Requests are independently reviewed when the central correction-approval policy is enabled.</p></div></div>
      <div className="student-table-wrap"><table className="student-table"><thead><tr><th>Record</th><th>Change</th><th>Reason</th><th>Status</th><th>Review</th></tr></thead><tbody>{corrections.map(item => <tr key={item.id}><td>{item.attendanceRecordId}</td><td>{item.originalStatus} → {item.proposedStatus}</td><td>{item.reason}</td><td>{item.status}</td><td>{item.status === 'pending' && <div className="student-row-actions"><button onClick={() => void reviewCorrection(item, 'approve')}>Approve</button><button className="danger" onClick={() => void reviewCorrection(item, 'reject')}>Reject</button></div>}</td></tr>)}</tbody></table>{!corrections.length && <div className="student-empty">No attendance correction requests.</div>}</div>
    </section>
  </div>;
}
