// @ts-nocheck -- imported School Hub source, kept as-is
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '@/lib/appdeploy-client';
import { AlertCircle, BriefcaseBusiness, History, LoaderCircle, Plus, RefreshCw, Search, UserRound } from 'lucide-react';
import { useTenantSession } from './AuthenticationGate';
import { apiErrorMessage } from '../lib/api-error';
import './StaffManagement.css';

type School = { id: string; name: string; status: string };
type Staff = {
  id: string; schoolId: string; staffNumber: string; firstName: string; lastName: string;
  otherNames: string | null; workEmail: string | null; workPhone: string | null;
  employmentStatus: string; employmentType: string; departmentNodeId: string | null;
  jobTitle: string | null; startDate: string | null; endDate: string | null; version: number;
};
type History = { id: string; changeType: string; effectiveOn: string; reason: string | null; newState: Record<string, unknown> };
const empty = { schoolId: '', firstName: '', lastName: '', otherNames: '', workEmail: '', workPhone: '', employmentType: 'permanent', jobTitle: '', startDate: '', reason: '' };
const statusLabels: Record<string, string> = { pending: 'Pending', active: 'Active', on_leave: 'On leave', suspended: 'Suspended', terminated: 'Terminated', retired: 'Retired' };

export default function StaffManagement() {
  const { tenantId } = useTenantSession();
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolId, setSchoolId] = useState('');
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selected, setSelected] = useState<Staff | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadSchools = useCallback(async () => {
    const response = await api.get('/api/platform/schools?tenantId=' + encodeURIComponent(tenantId));
    const items = (response.data.items || []) as School[];
    setSchools(items);
    setSchoolId(current => current || items[0]?.id || '');
  }, [tenantId]);
  const loadStaff = useCallback(async () => {
    if (!schoolId) { setStaff([]); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ tenantId, schoolId, limit: '100' });
      if (search.trim()) params.set('search', search.trim());
      const response = await api.get('/api/staff?' + params.toString());
      setStaff((response.data.items || []) as Staff[]);
    } catch (cause) { setError(apiErrorMessage(cause, 'Unable to load staff records.')); }
    finally { setLoading(false); }
  }, [tenantId, schoolId, search]);
  useEffect(() => { void loadSchools().catch(cause => setError(apiErrorMessage(cause, 'Unable to load authorised schools.'))); }, [loadSchools]);
  useEffect(() => { void loadStaff(); }, [loadStaff]);

  const metrics = useMemo(() => ({
    total: staff.length,
    active: staff.filter(x => x.employmentStatus === 'active').length,
    pending: staff.filter(x => x.employmentStatus === 'pending').length,
    leave: staff.filter(x => x.employmentStatus === 'on_leave').length,
  }), [staff]);

  function startCreate() {
    setSelected(null); setEditing(false); setForm({ ...empty, schoolId }); setShowForm(true); setError(''); setNotice('');
  }
  function startEdit(item: Staff) {
    setSelected(item); setEditing(true);
    setForm({ schoolId: item.schoolId, firstName: item.firstName, lastName: item.lastName, otherNames: item.otherNames || '',
      workEmail: item.workEmail || '', workPhone: item.workPhone || '', employmentType: item.employmentType,
      jobTitle: item.jobTitle || '', startDate: item.startDate || '', reason: '' });
    setShowForm(true); setError(''); setNotice('');
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      const payload = { firstName: form.firstName, lastName: form.lastName, otherNames: form.otherNames || null,
        workEmail: form.workEmail || null, workPhone: form.workPhone || null, employmentType: form.employmentType,
        jobTitle: form.jobTitle || null, startDate: form.startDate || null, reason: form.reason || null,
        ...(editing && selected ? { expectedVersion: selected.version } : { schoolId }) };
      if (editing && selected) await api.put('/api/staff/' + encodeURIComponent(selected.id) + '?tenantId=' + encodeURIComponent(tenantId), payload);
      else await api.post('/api/staff?tenantId=' + encodeURIComponent(tenantId), payload);
      setShowForm(false); setNotice(editing ? 'Staff profile updated.' : 'Staff profile created.');
      await loadStaff();
      if (editing && selected) await openHistory(selected);
    } catch (cause) { setError(apiErrorMessage(cause, 'Unable to save the staff profile.')); }
    finally { setSaving(false); }
  }
  async function changeStatus(item: Staff, status: string) {
    const reason = window.prompt('Enter the reason for this employment status change:');
    if (!reason?.trim()) return;
    setSaving(true); setError('');
    try {
      await api.post('/api/staff/' + encodeURIComponent(item.id) + '/status?tenantId=' + encodeURIComponent(tenantId),
        { status, expectedVersion: item.version, effectiveOn: new Date().toISOString().slice(0, 10), reason: reason.trim() });
      setNotice('Employment status updated with a history entry.');
      await loadStaff();
      if (selected?.id === item.id) await openHistory(item);
    } catch (cause) { setError(apiErrorMessage(cause, 'Unable to change employment status.')); }
    finally { setSaving(false); }
  }
  async function openHistory(item: Staff) {
    setSelected(item); setHistory([]);
    try {
      const response = await api.get('/api/staff/' + encodeURIComponent(item.id) + '/history?tenantId=' + encodeURIComponent(tenantId));
      setHistory((response.data.items || []) as History[]);
    } catch (cause) { setError(apiErrorMessage(cause, 'Unable to load employment history.')); }
  }

  return (
    <div className='staff-workspace'>
      <div className='staff-heading'>
        <div><span className='staff-eyebrow'>PEOPLE OPERATIONS</span><h2>Staff &amp; HR</h2><p>Maintain school staff records and an accountable employment history.</p></div>
        <button className='btn primary' onClick={startCreate} disabled={!schoolId}><Plus size={16}/> Add staff member</button>
      </div>
      <div className='staff-toolbar'>
        <label>School<select value={schoolId} onChange={e => setSchoolId(e.target.value)}>{schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className='staff-search'><Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder='Search staff number, name, email or position'/></label>
        <button className='btn secondary' onClick={() => void loadStaff()} disabled={loading}><RefreshCw size={15}/> Refresh</button>
      </div>
      {error && <div className='staff-alert'><AlertCircle size={17}/>{error}</div>}
      {notice && <div className='staff-notice'>{notice}</div>}
      <div className='staff-metrics'>
        <div><span>Total staff</span><b>{metrics.total}</b></div><div><span>Active</span><b>{metrics.active}</b></div>
        <div><span>Pending</span><b>{metrics.pending}</b></div><div><span>On leave</span><b>{metrics.leave}</b></div>
      </div>
      {showForm && <form className='staff-form panel' onSubmit={save}>
        <div className='staff-form-title'><h3>{editing ? 'Edit staff profile' : 'Register staff member'}</h3><button type='button' className='btn secondary' onClick={() => setShowForm(false)}>Close</button></div>
        <div className='staff-form-grid'>
          <label>First name<input required maxLength={100} value={form.firstName} onChange={e => setForm({...form,firstName:e.target.value})}/></label>
          <label>Last name<input required maxLength={100} value={form.lastName} onChange={e => setForm({...form,lastName:e.target.value})}/></label>
          <label>Other names<input maxLength={120} value={form.otherNames} onChange={e => setForm({...form,otherNames:e.target.value})}/></label>
          <label>Work email<input type='email' maxLength={320} value={form.workEmail} onChange={e => setForm({...form,workEmail:e.target.value})}/></label>
          <label>Work phone<input maxLength={40} value={form.workPhone} onChange={e => setForm({...form,workPhone:e.target.value})}/></label>
          <label>Job title / position<input maxLength={120} value={form.jobTitle} onChange={e => setForm({...form,jobTitle:e.target.value})}/></label>
          <label>Employment type<select value={form.employmentType} onChange={e => setForm({...form,employmentType:e.target.value})}>
            <option value='permanent'>Permanent</option><option value='contract'>Contract</option><option value='temporary'>Temporary</option>
            <option value='national_service'>National service</option><option value='volunteer'>Volunteer</option><option value='other'>Other</option>
          </select></label>
          <label>Start date<input type='date' value={form.startDate} onChange={e => setForm({...form,startDate:e.target.value})}/></label>
          <label className='staff-form-wide'>Reason / appointment note<textarea maxLength={1000} value={form.reason} onChange={e => setForm({...form,reason:e.target.value})}/></label>
        </div>
        <div className='staff-form-actions'><button className='btn primary' disabled={saving}>{saving ? 'Saving…' : 'Save staff profile'}</button></div>
      </form>}
      <div className='staff-layout'>
        <section className='panel staff-list-panel'>
          <div className='staff-section-title'><div><h3>Staff register</h3><p>{staff.length} records in this page</p></div>{loading && <LoaderCircle className='staff-spin' size={18}/>}</div>
          {staff.length === 0 && !loading ? <div className='staff-empty'><UserRound size={28}/><b>No staff records found</b><span>Register the first staff member for this school.</span></div> :
            <div className='staff-table-wrap'><table className='staff-table'><thead><tr><th>Staff member</th><th>Position</th><th>Status</th><th>Employment</th><th>Actions</th></tr></thead>
              <tbody>{staff.map(item => <tr key={item.id}><td><b>{item.firstName} {item.lastName}</b><small>{item.staffNumber}{item.workEmail ? ' · '+item.workEmail : ''}</small></td>
                <td>{item.jobTitle || '—'}</td><td><span className={'staff-status status-'+item.employmentStatus}>{statusLabels[item.employmentStatus] || item.employmentStatus}</span></td>
                <td>{item.employmentType.replace('_',' ')}</td><td><div className='staff-actions'><button onClick={() => startEdit(item)}>Edit</button><button onClick={() => void openHistory(item)}><History size={14}/> History</button>
                  {item.employmentStatus === 'pending' && <button onClick={() => void changeStatus(item,'active')} disabled={saving}>Activate</button>}
                  {item.employmentStatus === 'active' && <button onClick={() => void changeStatus(item,'on_leave')} disabled={saving}>Set leave</button>}
                  {item.employmentStatus === 'on_leave' && <button onClick={() => void changeStatus(item,'active')} disabled={saving}>Return</button>}
                </div></td></tr>)}</tbody></table></div>}
        </section>
        <aside className='panel staff-history-panel'>
          <div className='staff-section-title'><div><h3>Employment history</h3><p>{selected ? selected.firstName+' '+selected.lastName : 'Select a staff member'}</p></div><BriefcaseBusiness size={18}/></div>
          {!selected ? <div className='staff-empty'><History size={26}/><span>Choose a staff record to review its employment changes.</span></div> :
            history.length === 0 ? <p className='staff-muted'>No history entries are available.</p> :
            <ol className='staff-history'>{history.map(h => <li key={h.id}><b>{h.changeType.replace('_',' ')}</b><time>{h.effectiveOn}</time><span>{h.reason || 'No reason recorded'}</span></li>)}</ol>}
        </aside>
      </div>
      <p className='staff-footnote'>Staff profiles are separate from login identities. Creating a staff record does not create an account or grant system access.</p>
    </div>
  );
}
