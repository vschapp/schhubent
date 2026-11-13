// @ts-nocheck -- imported School Hub source, kept as-is
import { useEffect, useState } from 'react';
import { api } from '@/lib/appdeploy-client';
import { AlertCircle, CheckCircle2, RefreshCw, Plus, ShieldCheck, Network, ClipboardList } from 'lucide-react';
import { useTenantSession } from './AuthenticationGate';
import { apiErrorMessage } from '../lib/api-error';

type Node = { id: string; type: string; name: string; parentId: string | null; schoolId?: string | null; version: number };
type Membership = { userId: string; status: string; role?: string; email?: string; schoolIds?: string[]; isTenantSuperAdmin?: boolean; delegations?: any[] };
type Workflow = { id: string; name: string; steps: any[] };
type Instance = { id: string; title: string; status: string; version: number; submittedBy: string; steps: any[]; currentStep: number; canDecide?: boolean; overdue?: boolean; escalationStatus?: string };

export default function PlatformGovernance() {
  const { tenantId } = useTenantSession();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [schools, setSchools] = useState<any[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [type, setType] = useState('campus');
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('root');
  const [schoolId, setSchoolId] = useState('');
  const [userId, setUserId] = useState('');
  const [workflowName, setWorkflowName] = useState('General approval');
  const [secondStepEnabled, setSecondStepEnabled] = useState(false);
  const [secondStepName, setSecondStepName] = useState('Independent second review');
  const [requestTitle, setRequestTitle] = useState('');
  const [evidenceRefs, setEvidenceRefs] = useState('');
  const [delegationResource, setDelegationResource] = useState('student');
  const [delegationAction, setDelegationAction] = useState('read');
  const [delegationSchoolId, setDelegationSchoolId] = useState('');
  const [selectedWorkflow, setSelectedWorkflow] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    if (!tenantId) return;
    setFailure('');
    try {
      const [n, s, m, w, a] = await Promise.all([
        api.get('/api/platform/organisation-nodes?tenantId=' + encodeURIComponent(tenantId)),
        api.get('/api/platform/schools?tenantId=' + encodeURIComponent(tenantId)),
        api.get('/api/platform/memberships?tenantId=' + encodeURIComponent(tenantId)),
        api.get('/api/platform/workflows?tenantId=' + encodeURIComponent(tenantId)),
        api.get('/api/platform/audit?tenantId=' + encodeURIComponent(tenantId) + '&limit=30'),
      ]);
      setNodes(n.data.items || []);
      setSchools(s.data.items || []);
      setMemberships(m.data.items || []);
      setWorkflows(w.data.definitions || []);
      setInstances(w.data.instances || []);
      setAudit(a.data.items || []);
      if (!selectedWorkflow && w.data.definitions?.length) setSelectedWorkflow(w.data.definitions[0].id);
    } catch (err: any) {
      setFailure(apiErrorMessage(err, 'Unable to load platform governance records. Check your tenant permissions.'));
    }
  }
  useEffect(() => { load(); }, [tenantId]);

  async function createNode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setFailure(''); setMessage('');
    try {
      const payload: any = { type, name, parentId: parentId || null };
      if (type === 'school') payload.schoolId = schoolId;
      await api.post('/api/platform/organisation-nodes?tenantId=' + encodeURIComponent(tenantId), payload);
      setName(''); setMessage('Organisation hierarchy record created.'); await load();
    } catch (err: any) { setFailure(apiErrorMessage(err, 'Could not create the organisation node.')); }
    finally { setBusy(false); }
  }
  async function changeStatus(id: string, status: string) {
    setBusy(true); setFailure('');
    try { await api.put('/api/platform/memberships/' + encodeURIComponent(id) + '/status?tenantId=' + encodeURIComponent(tenantId), { status }); setMessage('Membership status updated.'); await load(); }
    catch (err: any) { setFailure(apiErrorMessage(err, 'Membership status could not be updated.')); }
    finally { setBusy(false); }
  }
  async function prepareInvitation(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setFailure('');
    try { const result = await api.post('/api/platform/memberships/invitations?tenantId=' + encodeURIComponent(tenantId), { userId }); setMessage(result.data.invitationDelivery === 'not_sent; AppDeploy invitation/email delivery must be configured separately' ? 'Membership invitation prepared. No email was sent; the user must already have an AppDeploy account.' : 'Invitation prepared.'); setUserId(''); await load(); }
    catch (err: any) { setFailure(apiErrorMessage(err, 'Could not prepare membership invitation.')); }
    finally { setBusy(false); }
  }
  async function grantDelegation(member: Membership) {
    if (!delegationSchoolId) { setFailure('Choose a school scope before granting delegation.'); return; }
    setBusy(true); setFailure('');
    try {
      await api.post('/api/platform/memberships/' + encodeURIComponent(member.userId) + '/delegations?tenantId=' + encodeURIComponent(tenantId), { resources: [delegationResource], actions: [delegationAction], schoolIds: [delegationSchoolId], expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() });
      setMessage('Delegated authority granted for the selected school and action for seven days.'); await load();
    } catch (err: any) { setFailure(apiErrorMessage(err, 'Could not grant delegated authority.')); }
    finally { setBusy(false); }
  }
  async function revokeDelegation(member: Membership, delegationId: string) {
    setBusy(true); setFailure('');
    try {
      await api.delete('/api/platform/memberships/' + encodeURIComponent(member.userId) + '/delegations/' + encodeURIComponent(delegationId) + '?tenantId=' + encodeURIComponent(tenantId));
      setMessage('Delegated authority revoked.'); await load();
    } catch (err: any) { setFailure(apiErrorMessage(err, 'Could not revoke delegated authority.')); }
    finally { setBusy(false); }
  }
  async function createWorkflow(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setFailure('');
    const steps = [{ name: 'Independent approval', approverRoles: [], dueHours: 48 }, ...(secondStepEnabled ? [{ name: secondStepName, approverRoles: [], dueHours: 48 }] : [])];
    try { const result = await api.post('/api/platform/workflows?tenantId=' + encodeURIComponent(tenantId), { name: workflowName, steps }); setSelectedWorkflow(result.data.definition.id); setMessage('Approval workflow created with ' + steps.length + ' approval step(s).'); await load(); }
    catch (err: any) { setFailure(apiErrorMessage(err, 'Could not create workflow.')); }
    finally { setBusy(false); }
  }
  async function submitRequest(event: React.FormEvent) {
    event.preventDefault(); if (!selectedWorkflow) return;
    setBusy(true); setFailure('');
    try { const refs = evidenceRefs.split(',').map(value => value.trim()).filter(Boolean); await api.post('/api/platform/workflow-instances?tenantId=' + encodeURIComponent(tenantId), { workflowId: selectedWorkflow, title: requestTitle, evidenceRefs: refs }); setRequestTitle(''); setEvidenceRefs(''); setMessage('Approval request submitted. The requester cannot approve their own request.'); await load(); }
    catch (err: any) { setFailure(apiErrorMessage(err, 'Could not submit approval request.')); }
    finally { setBusy(false); }
  }
  async function decide(item: Instance, decision: 'approve' | 'reject') {
    setBusy(true); setFailure('');
    try { await api.post('/api/platform/workflow-instances/' + encodeURIComponent(item.id) + '/decision?tenantId=' + encodeURIComponent(tenantId), { decision, expectedVersion: item.version }); setMessage('Workflow decision recorded.'); await load(); }
    catch (err: any) { setFailure(apiErrorMessage(err, 'Workflow decision was rejected.')); }
    finally { setBusy(false); }
  }

  if (!tenantId) return <div className='panel'>Select an active organisation workspace to manage governance.</div>;
  return <div className='config-page'>
    <div className='page-heading'><div><span className='eyebrow'>PLATFORM GOVERNANCE</span><h1>Organisation, identity & workflow controls</h1><p>Tenant-scoped registries, membership lifecycle, approvals and audit visibility.</p></div><button className='btn secondary' onClick={load}><RefreshCw size={15}/> Refresh</button></div>
    {failure && <div className='config-error'><AlertCircle size={16}/>{failure}</div>}
    {message && <div className='config-success'><CheckCircle2 size={15}/>{message}</div>}
    <section className='panel config-category'><div className='panel-head'><div><h2><Network size={17}/> Organisation hierarchy</h2><p>School records are linked from the existing school registry, not duplicated.</p></div></div>
      <form className='rpm-create' onSubmit={createNode}>
        <select value={type} onChange={e=>setType(e.target.value)}>{['educational_level','school','campus','branch','department','unit','location'].map(x=><option key={x} value={x}>{x.replace('_',' ')}</option>)}</select>
        {type === 'school' ? <select value={schoolId} onChange={e=>setSchoolId(e.target.value)} required><option value=''>Select existing school</option>{schools.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select> : <input value={name} onChange={e=>setName(e.target.value)} placeholder='Name' minLength={2} maxLength={160} required/>}
        <select value={parentId} onChange={e=>setParentId(e.target.value)}><option value='root'>Organisation root</option>{nodes.filter(n=>['organisation','school','campus','branch','department'].includes(n.type)).map(n=><option key={n.id} value={n.id}>{n.name} · {n.type}</option>)}</select>
        <button className='btn primary' disabled={busy}><Plus size={14}/> Add node</button>
      </form>
      <div className='config-settings'>{nodes.map(n=><div className='config-setting' key={n.id}><div className='config-setting-label'><b>{n.name}</b><span>{n.type} · {n.id}</span></div><div className='config-setting-editor'><small>Parent: {nodes.find(p=>p.id===n.parentId)?.name || 'Organisation root'} · Version {n.version}</small>{n.type !== 'organisation' && <button className='btn secondary' disabled={busy} onClick={async()=>{try{await api.delete('/api/platform/organisation-nodes/'+encodeURIComponent(n.id)+'?tenantId='+encodeURIComponent(tenantId));await load();}catch(e:any){setFailure(apiErrorMessage(e,'Could not archive node.'));}}}>Archive</button>}</div></div>)}</div>
    </section>
    <section className='panel config-category'><div className='panel-head'><div><h2><ShieldCheck size={17}/> Membership lifecycle & delegation</h2><p>Prepare memberships for existing AppDeploy user IDs, then activate, suspend or revoke them.</p></div></div>
      <form className='rpm-create' onSubmit={prepareInvitation}><input value={userId} onChange={e=>setUserId(e.target.value)} placeholder='Existing AppDeploy user ID' minLength={8} required/><button className='btn primary' disabled={busy}><Plus size={14}/> Prepare invitation</button></form>
      <div className='config-settings'>{memberships.map(m=><div className='config-setting' key={m.userId}><div className='config-setting-label'><b>{m.email || m.userId}</b><span>{m.role || 'No role'} · {m.userId}</span></div><div className='config-setting-editor'><select value={m.status} disabled={busy||m.isTenantSuperAdmin} onChange={e=>changeStatus(m.userId,e.target.value)}><option value='invited'>Invited</option><option value='active'>Active</option><option value='suspended'>Suspended</option><option value='revoked'>Revoked</option></select>{m.status==='active'&&!m.isTenantSuperAdmin&&<><select value={delegationSchoolId} onChange={e=>setDelegationSchoolId(e.target.value)}><option value=''>School scope</option>{schools.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select><select value={delegationResource} onChange={e=>setDelegationResource(e.target.value)}><option value='student'>Student records</option><option value='school'>School records</option><option value='organisation-node'>Organisation nodes</option><option value='academic-year'>Academic years</option><option value='attendance-register'>Attendance</option><option value='assessment'>Assessments</option><option value='workflow'>Workflows</option></select><select value={delegationAction} onChange={e=>setDelegationAction(e.target.value)}><option value='read'>Read</option><option value='create'>Create</option><option value='update'>Update</option><option value='delete'>Delete</option></select><button className='btn secondary' disabled={busy||!delegationSchoolId} onClick={()=>grantDelegation(m)}>Delegate 7 days</button></>}{(m.delegations||[]).filter(grant=>Date.parse(grant.expiresAt)>Date.now()).map(grant=><div className='config-note' key={grant.id}><span>{grant.resources.join(', ')} · {grant.actions.join(', ')} · {grant.schoolIds.map((id:string)=>schools.find(s=>s.id===id)?.name||id).join(', ')} · expires {new Date(grant.expiresAt).toLocaleString()}</span><button className='btn secondary' disabled={busy} onClick={()=>revokeDelegation(m,grant.id)}>Revoke</button></div>)}</div></div>)}</div>
      <p className='config-note'>Invitation preparation does not send email or create an identity-provider account. MFA enforcement and external identity lifecycle require provider support.</p>
    </section>
    <section className='panel config-category'><div className='panel-head'><div><h2><ClipboardList size={17}/> Approval workflows</h2><p>Sequential approvals, due dates, evidence references and requester/approver separation.</p></div></div>
      <form className='rpm-create' onSubmit={createWorkflow}><input value={workflowName} onChange={e=>setWorkflowName(e.target.value)} minLength={2} required/><label><input type='checkbox' checked={secondStepEnabled} onChange={e=>setSecondStepEnabled(e.target.checked)}/> Add a second approval step</label>{secondStepEnabled&&<input value={secondStepName} onChange={e=>setSecondStepName(e.target.value)} minLength={2} required/>}<button className='btn primary' disabled={busy}><Plus size={14}/> Create approval flow</button></form>
      <form className='rpm-create' onSubmit={submitRequest}><select value={selectedWorkflow} onChange={e=>setSelectedWorkflow(e.target.value)} required><option value=''>Choose workflow</option>{workflows.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select><input value={requestTitle} onChange={e=>setRequestTitle(e.target.value)} placeholder='Approval request title' minLength={2} required/><input value={evidenceRefs} onChange={e=>setEvidenceRefs(e.target.value)} placeholder='Evidence reference IDs (comma separated)'/><button className='btn primary' disabled={busy||!workflows.length}>Submit request</button></form>
      <div className='config-settings'>{instances.map(item=><div className='config-setting' key={item.id}><div className='config-setting-label'><b>{item.title}</b><span>{item.status}{item.overdue ? ' · overdue' : ''}{item.escalationStatus ? ' · escalated' : ''} · Step {item.currentStep+1} · {item.id}</span></div><div className='config-setting-editor'>{item.status==='pending' && item.canDecide && <><button className='btn secondary' disabled={busy} onClick={()=>decide(item,'approve')}>Approve</button><button className='btn secondary' disabled={busy} onClick={()=>decide(item,'reject')}>Reject</button></>}</div></div>)}</div>
    </section>
    <section className='panel config-category'><div className='panel-head'><div><h2>Recent audit activity</h2><p>Read-only audit API; current storage does not guarantee tamper-proof immutability.</p></div></div>
      <div className='config-settings'>{audit.map(item=><div className='config-setting' key={item.id}><div className='config-setting-label'><b>{item.action}</b><span>{item.resource} · {item.actorId}</span></div><div className='config-setting-editor'><small>{new Date(item.occurredAt).toLocaleString()}</small></div></div>)}</div>
    </section>
  </div>;
}
