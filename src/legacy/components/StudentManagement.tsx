// @ts-nocheck -- imported School Hub source, kept as-is
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '@/lib/appdeploy-client';
import { AlertCircle, CheckCircle2, ChevronRight, LoaderCircle, Plus, RefreshCw, Search, Trash2, UserRound, X } from 'lucide-react';
import { useTenantSession } from './AuthenticationGate';
import { apiErrorMessage as messageFrom } from '../lib/api-error';
import './StudentManagement.css';

type School = { id: string; schoolId: string; tenantId: string; name: string; status: string };
type AcademicOptions = { academicYears: Array<{id:string;name:string}>; classes: Array<{id:string;name:string}>; sections: Array<{id:string;name:string;classId:string}> };
type Student = {
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
  version: number;
};
type StudentForm = {
  schoolId: string;
  firstName: string;
  lastName: string;
  preferredName: string;
  dateOfBirth: string;
  classId: string;
  sectionId: string;
  academicYearId: string;
  admissionStatus: Student['admissionStatus'];
};
const blankForm: StudentForm = {
  schoolId: '' ,
  firstName: '',
  lastName: '',
  preferredName: '',
  dateOfBirth: '',
  classId: '',
  sectionId: '',
  academicYearId: '',
  admissionStatus: 'registered',
};

export default function StudentManagement() {
  const { tenantId, user } = useTenantSession();
  const [schools, setSchools] = useState<School[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [academicOptions, setAcademicOptions] = useState<AcademicOptions>({ academicYears: [], classes: [], sections: [] });
  const [academicLoading, setAcademicLoading] = useState(false);
  const [form, setForm] = useState<StudentForm>(blankForm);
  const [schoolName, setSchoolName] = useState('');
  const [showSchoolForm, setShowSchoolForm] = useState(false);
  const [showStudentForm, setShowStudentForm] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const schoolNames = useMemo(
    () => new Map(schools.map(school => [school.id, school.name])),
    [schools]
  );

  async function loadAcademicOptions(selectedSchoolId: string) {
    if (!selectedSchoolId) { setAcademicOptions({ academicYears: [], classes: [], sections: [] }); return; }
    setAcademicLoading(true);
    try {
      const params = new URLSearchParams({ tenantId, schoolId: selectedSchoolId });
      const response = await api.get('/api/platform/academic-catalog?' + params.toString());
      setAcademicOptions({ academicYears: response.data.academicYears || [], classes: response.data.classes || [], sections: response.data.sections || [] });
    } catch (cause) {
      setError(messageFrom(cause, 'Unable to load academic options.'));
      setAcademicOptions({ academicYears: [], classes: [], sections: [] });
    } finally { setAcademicLoading(false); }
  }

  async function loadSchools() {
    const response = await api.get('/api/platform/schools?tenantId=' + encodeURIComponent(tenantId));
    setSchools((response.data.items || []) as School[]);
  }

  const loadStudents = useCallback(async (token?: string) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        tenantId,
        limit: '50',
      });
      if (appliedSearch) params.set('search', appliedSearch);
      if (token) params.set('nextToken', token);
      const response = await api.get('/api/students?' + params.toString());
      const pageItems = (response.data.items || []) as Student[];
      setStudents(current => {
        if (!token) return pageItems;
        const byId = new Map(current.map(item => [item.id, item]));
        for (const item of pageItems) byId.set(item.id, item);
        return Array.from(byId.values());
      });
      setNextToken(response.data.nextToken || null);
    } catch (cause) {
      setError(messageFrom(cause, 'Unable to load student records.'));
    } finally {
      setLoading(false);
    }
  }, [tenantId, appliedSearch]);

  useEffect(() => {
    let active = true;
    setError('');
    api.get('/api/platform/schools?tenantId=' + encodeURIComponent(tenantId)).then(response => {
      if (active) setSchools((response.data.items || []) as School[]);
    }).catch(cause => {
      if (active) setError(messageFrom(cause, 'Unable to load authorised schools.'));
    });
    return () => { active = false; };
  }, [tenantId]);

  useEffect(() => {
    void loadStudents();
  }, [loadStudents]);

  function startCreate() {
    setEditing(null);
    const selectedSchoolId = schools[0]?.id || '';
    setForm({ ...blankForm, schoolId: selectedSchoolId });
    void loadAcademicOptions(selectedSchoolId);
    setShowStudentForm(true);
    setError('');
    setNotice('');
  }

  function startEdit(student: Student) {
    setEditing(student);
    void loadAcademicOptions(student.schoolId);
    setForm({
      schoolId: student.schoolId,
      firstName: student.firstName,
      lastName: student.lastName,
      preferredName: student.preferredName || '',
      dateOfBirth: student.dateOfBirth || '',
      classId: student.classId || '',
      sectionId: student.sectionId || '',
      academicYearId: student.academicYearId || '',
      admissionStatus: student.admissionStatus,
    });
    setShowStudentForm(true);
    setError('');
    setNotice('');
  }

  async function saveSchool(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await api.post('/api/platform/schools?tenantId=' + encodeURIComponent(tenantId), { name: schoolName.trim() });
      setSchoolName('');
      setShowSchoolForm(false);
      await loadSchools();
      setNotice('School added to this workspace.');
    } catch (cause) {
      setError(messageFrom(cause, 'Unable to create the school.'));
    } finally {
      setSaving(false);
    }
  }

  async function saveStudent(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    const payload = {
      ...form,
      preferredName: form.preferredName || null,
      dateOfBirth: form.dateOfBirth || null,
      classId: form.classId || null,
      sectionId: form.sectionId || null,
      academicYearId: form.academicYearId || null,
      ...(editing ? { expectedVersion: editing.version } : {}),
    };
    try {
      if (editing) {
        await api.put('/api/students/' + encodeURIComponent(editing.id) + '?tenantId=' + encodeURIComponent(tenantId), payload);
        setNotice('Student profile updated.');
      } else {
        const pendingKey = 'school-hub:student-registration:' + tenantId + ':' + user.userId;
        const fingerprint = JSON.stringify(payload);
        let pending: { intentId: string; fingerprint: string } | null = null;
        const saved = sessionStorage.getItem(pendingKey);
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (typeof parsed?.intentId === 'string' && typeof parsed?.fingerprint === 'string') pending = parsed;
          } catch {
            sessionStorage.removeItem(pendingKey);
          }
        }
        if (pending && pending.fingerprint !== fingerprint) {
          try {
            await api.post('/api/students?tenantId=' + encodeURIComponent(tenantId), { registrationIntentId: pending.intentId });
          } catch (resolveError: any) {
            const status = resolveError?.response?.status;
            if (status !== 404 && status !== 410) throw resolveError;
          }
          sessionStorage.removeItem(pendingKey);
          pending = null;
        }
        if (!pending) {
          const prepared = await api.post('/api/students/registration-intents?tenantId=' + encodeURIComponent(tenantId), payload);
          pending = { intentId: prepared.data.intentId, fingerprint };
          sessionStorage.setItem(pendingKey, JSON.stringify(pending));
        }
        await api.post('/api/students?tenantId=' + encodeURIComponent(tenantId), { registrationIntentId: pending.intentId });
        sessionStorage.removeItem(pendingKey);
        setNotice('Student registered successfully.');
      }
      setShowStudentForm(false);
      setEditing(null);
      setForm(blankForm);
      await loadStudents();
    } catch (cause) {
      setError(messageFrom(cause, 'Unable to save the student profile.'));
    } finally {
      setSaving(false);
    }
  }

  async function archiveStudent(student: Student) {
    const confirmed = window.confirm('Archive ' + student.firstName + ' ' + student.lastName + '? The record will be soft-deleted and retained in the audit history.');
    if (!confirmed) return;
    setError('');
    setNotice('');
    try {
      await api.delete('/api/students/' + encodeURIComponent(student.id) + '?tenantId=' + encodeURIComponent(tenantId));
      setNotice('Student record archived.');
      await loadStudents();
    } catch (cause) {
      setError(messageFrom(cause, 'Unable to archive this student.'));
    }
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setAppliedSearch(search.trim());
  }

  return (
    <div className='student-page'>
      <div className='student-heading'>
        <div>
          <div className='student-eyebrow'>STUDENT INFORMATION SYSTEM</div>
          <h1>Students</h1>
          <p>Manage authorised student master records for the selected organisation workspace.</p>
        </div>
        <div className='student-heading-actions'>
          <button className='student-button secondary' onClick={() => { void loadSchools(); void loadStudents(); }}>
            <RefreshCw size={15}/> Refresh
          </button>
          <button className='student-button primary' onClick={startCreate} disabled={!schools.length}>
            <Plus size={16}/> Register student
          </button>
        </div>
      </div>

      {error && <div className='student-alert error'><AlertCircle size={16}/>{error}</div>}
      {notice && <div className='student-alert success'><CheckCircle2 size={16}/>{notice}<button aria-label='Dismiss notice' onClick={() => setNotice('')}><X size={14}/></button></div>}

      <div className='student-summary-grid'>
        <section className='student-summary-card'><span>VISIBLE RECORDS</span><b>{students.length}</b><small>Authorised records on this page</small></section>
        <section className='student-summary-card'><span>REGISTERED SCHOOLS</span><b>{schools.length}</b><small>Schools available in this workspace</small></section>
        <section className='student-summary-card'><span>PAGE SIZE</span><b>50</b><small>Bounded API pagination</small></section>
      </div>

      <section className='student-panel'>
        <div className='student-panel-head'>
          <div><h2>School registry</h2><p>Student records must belong to an authorised school.</p></div>
          <button className='student-button secondary' onClick={() => setShowSchoolForm(value => !value)}><Plus size={15}/>{showSchoolForm ? 'Close' : 'Add school'}</button>
        </div>
        {showSchoolForm && (
          <form className='student-inline-form' onSubmit={saveSchool}>
            <label>School name<input value={schoolName} onChange={event => setSchoolName(event.target.value)} minLength={2} maxLength={120} required placeholder='Enter the school name'/></label>
            <button className='student-button primary' disabled={saving || schoolName.trim().length < 2}>{saving ? 'Saving…' : 'Create school'}</button>
          </form>
        )}
        {!schools.length && !loading && <div className='student-empty-inline'>No authorised schools are available. Add a school if your role has permission, or ask your tenant administrator to assign your school access.</div>}
        {!!schools.length && <div className='student-school-chips'>{schools.map(school => <span key={school.id}>{school.name}</span>)}</div>}
      </section>

      <section className='student-panel'>
        <div className='student-panel-head'>
          <div><h2>Student register</h2><p>Search and manage student profiles within your permitted tenant and school scope.</p></div>
          <form className='student-search' onSubmit={submitSearch}>
            <Search size={15}/>
            <input value={search} onChange={event => setSearch(event.target.value)} maxLength={80} placeholder='Search student name'/>
            <button type='submit'>Search</button>
          </form>
        </div>

        {showStudentForm && (
          <form className='student-form' onSubmit={saveStudent}>
            <div className='student-form-title'><h3>{editing ? 'Edit student profile' : 'Register a student'}</h3><button type='button' aria-label='Close form' onClick={() => setShowStudentForm(false)}><X size={17}/></button></div>
            <p className='student-footnote'>Academic choices are loaded from the selected school's authorised registry. Existing student relationships are preserved unless changed here.</p>
            <div className='student-form-grid'>
              <label>School<select value={form.schoolId} onChange={event => { const schoolId = event.target.value; setForm({ ...form, schoolId, classId: '', sectionId: '', academicYearId: '' }); void loadAcademicOptions(schoolId); }} required><option value=''>Select school</option>{schools.map(school => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label>
              <label>First name<input value={form.firstName} onChange={event => setForm({ ...form, firstName: event.target.value })} maxLength={80} required/></label>
              <label>Last name<input value={form.lastName} onChange={event => setForm({ ...form, lastName: event.target.value })} maxLength={80} required/></label>
              <label>Preferred name<input value={form.preferredName} onChange={event => setForm({ ...form, preferredName: event.target.value })} maxLength={80}/></label>
              <label>Date of birth<input type='date' value={form.dateOfBirth} onChange={event => setForm({ ...form, dateOfBirth: event.target.value })}/></label>
              <label>Class<select value={form.classId} onChange={event => setForm({ ...form, classId: event.target.value, sectionId: '' })}><option value=''>Not assigned</option>{academicOptions.classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label>Section<select value={form.sectionId} onChange={event => setForm({ ...form, sectionId: event.target.value })} disabled={!form.classId}><option value=''>Not assigned</option>{academicOptions.sections.filter(item => item.classId === form.classId).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label>Academic year<select value={form.academicYearId} onChange={event => setForm({ ...form, academicYearId: event.target.value })}><option value=''>Not assigned</option>{academicOptions.academicYears.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label>Admission status<select value={form.admissionStatus} onChange={event => setForm({ ...form, admissionStatus: event.target.value as Student['admissionStatus'] })}><option value='registered'>Registered</option><option value='admitted'>Admitted</option><option value='transferred'>Transferred</option><option value='withdrawn'>Withdrawn</option></select></label>
            </div>
            {academicLoading && <p className='student-footnote'>Loading academic choices…</p>}
            <div className='student-form-actions'><button type='button' className='student-button secondary' onClick={() => setShowStudentForm(false)}>Cancel</button><button className='student-button primary' disabled={saving || academicLoading || !schools.length}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create student record'}</button></div>
          </form>
        )}

        {loading ? <div className='student-loading'><LoaderCircle size={19}/> Loading authorised student records…</div> : !students.length ? (
          <div className='student-empty'><UserRound size={28}/><b>No student records found</b><span>{appliedSearch ? 'Try another search term or clear the search.' : 'Register the first student after an authorised school is available.'}</span></div>
        ) : (
          <div className='student-table-wrap'>
            <table className='student-table'>
              <thead><tr><th>STUDENT</th><th>SCHOOL</th><th>ADMISSION</th><th>ACTIONS</th></tr></thead>
              <tbody>{students.map(student => <tr key={student.id}>
                <td><b>{student.preferredName || student.firstName} {student.lastName}</b><small>Student profile</small></td>
                <td>{schoolNames.get(student.schoolId) || 'School record'}</td>
                <td><span className={'student-status ' + student.admissionStatus}>{student.admissionStatus}</span></td>
                <td><div className='student-row-actions'><button onClick={() => startEdit(student)}>Edit</button><button className='danger' onClick={() => void archiveStudent(student)} aria-label={'Archive ' + student.firstName + ' ' + student.lastName}><Trash2 size={14}/></button></div></td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
        {nextToken && <div className='student-pagination'><span>More authorised records are available.</span><button className='student-button secondary' onClick={() => void loadStudents(nextToken)}>Next page <ChevronRight size={15}/></button></div>}
      </section>
      <p className='student-footnote'>All writes are checked by the server against tenant membership and record-level RBAC/ABAC. Updates use record versions; deletions are soft deletes with audit and domain events.</p>
    </div>
  );
}
