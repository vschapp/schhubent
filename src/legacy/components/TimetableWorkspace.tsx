// @ts-nocheck -- imported School Hub source, kept as-is
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '@/lib/appdeploy-client';
import { AlertCircle, CalendarDays, CheckCircle2, LoaderCircle, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useTenantSession } from './AuthenticationGate';
import { apiErrorMessage } from '../lib/api-error';

type School = { id: string; name: string };
type Ref = { id: string; name: string; code?: string; academicYearId?: string; classId?: string };
type Teaching = { id: string; teacherUserId: string; classId: string; subjectId: string; academicYearId: string; termId?: string | null };
type Membership = { userId: string; name?: string; displayName?: string; email?: string; status: string };
type Entry = {
  id: string; schoolId: string; academicYearId: string; termId?: string | null;
  classId: string; sectionId?: string | null; subjectId: string; teacherUserId: string;
  weekday: number; periodNo: number; startsAt: string; endsAt: string; room?: string | null;
  effectiveFrom?: string | null; effectiveUntil?: string | null; version: number;
};
type Catalog = { academicYears: Ref[]; terms: Ref[]; classes: Ref[]; sections: Ref[]; subjects: Ref[] };

const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function TimetableWorkspace() {
  const { tenantId } = useTenantSession();
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolId, setSchoolId] = useState('');
  const [catalog, setCatalog] = useState<Catalog>({ academicYears: [], terms: [], classes: [], sections: [], subjects: [] });
  const [teaching, setTeaching] = useState<Teaching[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [yearId, setYearId] = useState('');
  const [termId, setTermId] = useState('');
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [teacherUserId, setTeacherUserId] = useState('');
  const [weekday, setWeekday] = useState('1');
  const [periodNo, setPeriodNo] = useState('1');
  const [startsAt, setStartsAt] = useState('08:00');
  const [endsAt, setEndsAt] = useState('08:40');
  const [room, setRoom] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveUntil, setEffectiveUntil] = useState('');
  const [editing, setEditing] = useState<Entry | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');

  const teacherOptions = useMemo(() => teaching.filter(item =>
    item.classId === classId && item.subjectId === subjectId &&
    item.academicYearId === yearId && (!termId || !item.termId || item.termId === termId)
  ), [teaching, classId, subjectId, yearId, termId]);

  function teacherLabel(userId: string) {
    const member = memberships.find(item => item.userId === userId);
    return member?.displayName || member?.name || member?.email || 'Teacher ' + userId.slice(-6);
  }

  async function loadSchools() {
    const response = await api.get('/api/platform/schools?tenantId=' + encodeURIComponent(tenantId));
    const items = (response.data.items || []) as School[];
    setSchools(items);
    if (!schoolId && items.length) setSchoolId(items[0].id);
  }

  async function loadEntries(reset = true) {
    if (!schoolId || !yearId) { setEntries([]); setNextToken(null); return; }
    setLoading(true);
    setFailure('');
    try {
      const params = new URLSearchParams({ tenantId, schoolId, academicYearId: yearId, limit: '100' });
      if (termId) params.set('termId', termId);
      if (!reset && nextToken) params.set('nextToken', nextToken);
      const response = await api.get('/api/timetable/entries?' + params.toString());
      setEntries(current => reset ? response.data.items || [] : [...current, ...(response.data.items || [])]);
      setNextToken(response.data.nextToken || null);
    } catch (cause) {
      setFailure(apiErrorMessage(cause, 'Unable to load timetable entries.'));
    } finally {
      setLoading(false);
    }
  }

  async function loadSchoolData(selectedSchool: string) {
    if (!selectedSchool) return;
    setFailure('');
    const params = new URLSearchParams({ tenantId, schoolId: selectedSchool });
    const assignmentParams = new URLSearchParams({ tenantId, schoolId: selectedSchool, limit: '100' });
    const [catalogResult, teachingResult, memberResult] = await Promise.allSettled([
      api.get('/api/platform/academic-catalog?' + params.toString()),
      api.get('/api/academic/teaching-assignments?' + assignmentParams.toString()),
      api.get('/api/platform/memberships?tenantId=' + encodeURIComponent(tenantId)),
    ]);
    if (catalogResult.status === 'fulfilled') setCatalog(catalogResult.value.data as Catalog);
    else setFailure(apiErrorMessage(catalogResult.reason, 'Unable to load academic references.'));
    if (teachingResult.status === 'fulfilled') setTeaching(teachingResult.value.data.items || []);
    else setTeaching([]);
    if (memberResult.status === 'fulfilled') setMemberships((memberResult.value.data.items || []).filter((item: Membership) => item.status === 'active'));
    else setMemberships([]);
  }

  useEffect(() => {
    void loadSchools().catch(cause => setFailure(apiErrorMessage(cause, 'Unable to load schools.')));
  }, [tenantId]);

  useEffect(() => {
    if (schoolId) {
      setYearId(''); setTermId(''); setClassId(''); setSectionId(''); setSubjectId(''); setTeacherUserId('');
      setEntries([]); setNextToken(null);
      void loadSchoolData(schoolId);
    }
  }, [schoolId, tenantId]);

  useEffect(() => {
    void loadEntries(true);
  }, [schoolId, yearId, termId]);

  useEffect(() => {
    if (teacherUserId && !teacherOptions.some(item => item.teacherUserId === teacherUserId)) setTeacherUserId('');
  }, [teacherOptions, teacherUserId]);

  function resetForm() {
    setEditing(null); setClassId(''); setSectionId(''); setSubjectId(''); setTeacherUserId('');
    setWeekday('1'); setPeriodNo('1'); setStartsAt('08:00'); setEndsAt('08:40');
    setRoom(''); setEffectiveFrom(''); setEffectiveUntil('');
  }

  function editEntry(item: Entry) {
    setEditing(item); setYearId(item.academicYearId); setTermId(item.termId || '');
    setClassId(item.classId); setSectionId(item.sectionId || ''); setSubjectId(item.subjectId);
    setTeacherUserId(item.teacherUserId); setWeekday(String(item.weekday)); setPeriodNo(String(item.periodNo));
    setStartsAt(item.startsAt); setEndsAt(item.endsAt); setRoom(item.room || '');
    setEffectiveFrom(item.effectiveFrom || ''); setEffectiveUntil(item.effectiveUntil || '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!schoolId) return;
    setBusy(true); setFailure(''); setNotice('');
    const payload = {
      schoolId, academicYearId: yearId, termId: termId || null, classId, sectionId: sectionId || null,
      subjectId, teacherUserId, weekday: Number(weekday), periodNo: Number(periodNo),
      startsAt, endsAt, room: room.trim() || null,
      effectiveFrom: effectiveFrom || null, effectiveUntil: effectiveUntil || null,
    };
    try {
      if (editing) {
        await api.put('/api/timetable/entries/' + encodeURIComponent(editing.id) + '?tenantId=' + encodeURIComponent(tenantId), {
          ...payload, expectedVersion: editing.version,
        });
        setNotice('Timetable entry updated.');
      } else {
        await api.post('/api/timetable/entries?tenantId=' + encodeURIComponent(tenantId), payload);
        setNotice('Timetable entry created.');
      }
      resetForm();
      await loadEntries(true);
    } catch (cause) {
      setFailure(apiErrorMessage(cause, 'Unable to save timetable entry.'));
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(item: Entry) {
    if (!window.confirm('Deactivate this timetable entry? Its audit history will be retained.')) return;
    setBusy(true); setFailure(''); setNotice('');
    try {
      await api.delete('/api/timetable/entries/' + encodeURIComponent(item.id) + '?tenantId=' + encodeURIComponent(tenantId), {
        expectedVersion: item.version,
      });
      setNotice('Timetable entry deactivated.');
      if (editing?.id === item.id) resetForm();
      await loadEntries(true);
    } catch (cause) {
      setFailure(apiErrorMessage(cause, 'Unable to deactivate timetable entry.'));
    } finally {
      setBusy(false);
    }
  }

  const labelFor = (items: Ref[], id: string) => items.find(item => item.id === id)?.name || 'Unavailable reference';
  return <div className="student-page">
    <div className="student-heading">
      <div><div className="student-eyebrow">ACADEMIC OPERATIONS</div><h1>Timetable</h1>
        <p>Build school schedules from active teaching assignments. Class, teacher and room clashes are checked by the server before saving.</p></div>
      <button className="student-button secondary" onClick={() => void loadEntries(true)} disabled={loading}><RefreshCw size={14}/>Refresh</button>
    </div>
    {failure && <div className="student-alert error"><AlertCircle size={15}/>{failure}</div>}
    {notice && <div className="student-alert success"><CheckCircle2 size={15}/>{notice}</div>}
    <section className="student-panel">
      <div className="student-form-grid">
        <label className="student-inline-label">School<select value={schoolId} onChange={event => setSchoolId(event.target.value)}><option value="">Select school</option>{schools.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="student-inline-label">Academic year<select value={yearId} onChange={event => setYearId(event.target.value)}><option value="">Select year</option>{catalog.academicYears.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="student-inline-label">Term filter<select value={termId} onChange={event => setTermId(event.target.value)}><option value="">All terms</option>{catalog.terms.filter(item => !yearId || item.academicYearId === yearId).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </div>
    </section>
    <section className="student-panel">
      <div className="student-panel-head"><div><h2>{editing ? 'Edit timetable period' : 'Add timetable period'}</h2><p>Only teachers with an active matching teaching assignment can be scheduled.</p></div></div>
      <form className="student-form" onSubmit={save}>
        <div className="student-form-grid">
          <label>Class<select required value={classId} onChange={event => { setClassId(event.target.value); setSectionId(''); setTeacherUserId(''); }}><option value="">Select class</option>{catalog.classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Section (optional)<select value={sectionId} onChange={event => setSectionId(event.target.value)}><option value="">All sections</option>{catalog.sections.filter(item => !classId || item.classId === classId).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Subject<select required value={subjectId} onChange={event => { setSubjectId(event.target.value); setTeacherUserId(''); }}><option value="">Select subject</option>{catalog.subjects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Teacher<select required value={teacherUserId} onChange={event => setTeacherUserId(event.target.value)}><option value="">Select assigned teacher</option>{teacherOptions.map(item => <option key={item.id} value={item.teacherUserId}>{teacherLabel(item.teacherUserId)}</option>)}</select></label>
          <label>Weekday<select value={weekday} onChange={event => setWeekday(event.target.value)}>{weekdays.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></label>
          <label>Period number<input type="number" min="1" max="30" value={periodNo} onChange={event => setPeriodNo(event.target.value)} required/></label>
          <label>Starts at<input type="time" value={startsAt} onChange={event => setStartsAt(event.target.value)} required/></label>
          <label>Ends at<input type="time" value={endsAt} onChange={event => setEndsAt(event.target.value)} required/></label>
          <label>Room / venue<input value={room} onChange={event => setRoom(event.target.value)} maxLength={80} placeholder="e.g. Science laboratory"/></label>
          <label>Effective from<input type="date" value={effectiveFrom} onChange={event => setEffectiveFrom(event.target.value)}/></label>
          <label>Effective until<input type="date" value={effectiveUntil} onChange={event => setEffectiveUntil(event.target.value)}/></label>
        </div>
        <div className="student-form-actions">
          <button className="student-button primary" disabled={busy || loading || !schoolId || !yearId || !classId || !subjectId || !teacherUserId || startsAt >= endsAt}><Plus size={14}/>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add period'}</button>
          {editing && <button type="button" className="student-button secondary" onClick={resetForm}>Cancel edit</button>}
        </div>
      </form>
      {!teacherOptions.length && classId && subjectId && yearId && <p className="student-muted">No active teaching assignment matches this class, subject and academic period.</p>}
    </section>
    <section className="student-panel">
      <div className="student-panel-head"><div><h2>Scheduled periods</h2><p>Active periods for the selected school and academic year.</p></div><CalendarDays size={18}/></div>
      <div className="student-table-wrap"><table className="student-table"><thead><tr><th>Day / period</th><th>Class / subject</th><th>Teacher</th><th>Time</th><th>Room</th><th>Actions</th></tr></thead>
        <tbody>{entries.map(item => <tr key={item.id}><td><b>{weekdays[item.weekday - 1]}</b><small>Period {item.periodNo}</small></td><td>{labelFor(catalog.classes, item.classId)}{item.sectionId && <small>{labelFor(catalog.sections, item.sectionId)}</small>}<small>{labelFor(catalog.subjects, item.subjectId)}</small></td><td>{teacherLabel(item.teacherUserId)}</td><td>{item.startsAt}–{item.endsAt}</td><td>{item.room || '—'}</td><td><div className="student-row-actions"><button type="button" onClick={() => editEntry(item)} disabled={busy}><Pencil size={13}/>Edit</button><button type="button" className="danger" onClick={() => void deactivate(item)} disabled={busy}><Trash2 size={13}/>Deactivate</button></div></td></tr>)}</tbody>
      </table>{!entries.length && !loading && <div className="student-empty">No timetable periods are configured for this selection.</div>}</div>
      {loading && <div className="student-loading"><LoaderCircle size={16}/>Loading timetable…</div>}
      {nextToken && <div className="student-form-actions"><button className="student-button secondary" onClick={() => void loadEntries(false)} disabled={loading}>Load more periods</button></div>}
    </section>
  </div>;
}
