// @ts-nocheck -- imported School Hub source, kept as-is
import { useEffect, useMemo, useState } from 'react';
import { api, auth } from '@/lib/appdeploy-client';
import { AlertCircle, CheckCircle2, ChevronDown, KeyRound, LoaderCircle, Plus, RefreshCw, Save, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { apiErrorMessage } from '../lib/api-error';

type Tenant = { tenantId: string; name: string; role: string; schoolIds: string[] };
type Definition = { key: string; label: string; category: string; valueType: 'string' | 'number' | 'boolean' | 'object'; description: string; defaultValue: unknown };
type Setting = { key: string; value: unknown; version: number; updatedAt: string; updatedBy: string };

export default function CentralConfiguration() {
  const [user, setUser] = useState<any>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [settings, setSettings] = useState<Record<string, Setting>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newTenant, setNewTenant] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const [historyKey, setHistoryKey] = useState('');
  const [historyItems, setHistoryItems] = useState<Record<string, any[]>>({});

  const grouped = useMemo(() => definitions.reduce<Record<string, Definition[]>>((all, item) => {
    all[item.category] = [...(all[item.category] || []), item];
    return all;
  }, {}), [definitions]);

  useEffect(() => {
    auth.getUser().then(async current => {
      setUser(current);
      if (current) await loadTenants();
    }).catch(() => setFailure('Authentication could not be restored. Please retry sign-in.'));
  }, []);

  async function loadTenants() {
    setLoading(true);
    setFailure('');
    try {
      const response = await api.get('/api/platform/tenants');
      const items = response.data.items as Tenant[];
      setTenants(items);
      if (!tenantId && items.length) setTenantId(items[0].tenantId);
    } catch (err: any) {
      setFailure(apiErrorMessage(err, 'Unable to load your school workspaces.'));
    } finally {
      setLoading(false);
    }
  }

  async function loadConfiguration(id = tenantId) {
    if (!id) return;
    setLoading(true);
    setFailure('');
    try {
      const response = await api.get('/api/platform/configuration?tenantId=' + encodeURIComponent(id));
      const records = response.data.settings as Setting[];
      const next: Record<string, Setting> = {};
      const nextDrafts: Record<string, string> = {};
      for (const record of records) {
        next[record.key] = record;
        nextDrafts[record.key] = JSON.stringify(record.value, null, 2);
      }
      setDefinitions(response.data.definitions as Definition[]);
      setSettings(next);
      setDrafts(nextDrafts);
    } catch (err: any) {
      setFailure(apiErrorMessage(err, 'Unable to load central configuration.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (tenantId) loadConfiguration(tenantId);
  }, [tenantId]);

  async function signIn() {
    setFailure('');
    try { await auth.signInWithRedirect(); }
    catch (err: any) { setFailure(err?.message || 'Sign-in could not start. Please retry.'); }
  }

  async function createTenant(event: React.FormEvent) {
    event.preventDefault();
    if (newTenant.trim().length < 2) return;
    setBusy(true);
    setFailure('');
    try {
      const response = await api.post('/api/platform/tenants', { name: newTenant.trim() });
      setNewTenant('');
      await loadTenants();
      setTenantId(response.data.tenantId);
      setMessage('School workspace created. You are its initial owner.');
    } catch (err: any) {
      setFailure(apiErrorMessage(err, 'Workspace creation failed.'));
    } finally { setBusy(false); }
  }

  async function saveSetting(definition: Definition) {
    const record = settings[definition.key];
    if (!record) return;
    setBusy(true);
    setFailure('');
    try {
      const raw = drafts[definition.key] ?? '';
      const value = JSON.parse(raw);
      const response = await api.put('/api/platform/configuration/' + encodeURIComponent(definition.key), { tenantId, value, expectedVersion: record.version });
      setSettings(current => ({ ...current, [definition.key]: { ...record, value: response.data.value, version: response.data.version, updatedAt: response.data.updatedAt } }));
      setDrafts(current => ({ ...current, [definition.key]: JSON.stringify(response.data.value, null, 2) }));
      setMessage('Saved ' + definition.label + '. Connected modules will consume the new authoritative value through the configuration service.');
    } catch (err: any) {
      setFailure(apiErrorMessage(err, 'Invalid JSON or configuration update failed.'));
    } finally { setBusy(false); }
  }

  async function loadHistory(key: string) {
    if (!tenantId) return;
    setHistoryKey(historyKey === key ? '' : key);
    try {
      const response = await api.get('/api/platform/configuration/' + encodeURIComponent(key) + '/history?tenantId=' + encodeURIComponent(tenantId));
      setHistoryItems(current => ({ ...current, [key]: response.data.items || [] }));
    } catch (err: any) { setFailure(apiErrorMessage(err, 'Unable to load configuration history.')); }
  }

  if (!user) {
    return <div className='config-page'>
      <div className='page-heading'><div className='eyebrow'>CENTRAL GOVERNANCE</div><h1>School-wide configuration</h1><p>Authoritative settings, access policies and tenant-scoped configuration management.</p></div>
      <section className='panel config-auth-card'><div className='config-feature-icon'><ShieldCheck size={24}/></div><h2>Sign in to manage school configuration</h2><p>Configuration data is available only to authenticated users with an active tenant membership and the required central permissions. Access is denied by default.</p><button className='btn primary' onClick={signIn}>Sign in securely <KeyRound size={16}/></button>{failure&&<div className='config-error'><AlertCircle size={15}/>{failure}</div>}</section>
    </div>;
  }

  return <div className='config-page'>
    <div className='page-heading'><div className='eyebrow'>CENTRAL GOVERNANCE</div><h1>School-wide configuration</h1><p>One authoritative configuration service for all modules. Changes are versioned, permission-checked and audited.</p></div>
    <div className='config-toolbar panel'>
      <div><span className='config-kicker'>SIGNED IN</span><b>{user.name || user.email || 'Signed-in account'}</b><small>Tenant membership and backend policy determine available operations.</small></div>
      <div className='config-toolbar-actions'><button className='btn secondary' onClick={loadTenants}><RefreshCw size={15}/> Refresh</button><button className='btn secondary' onClick={async()=>{await auth.signOut();setUser(null);setTenants([]);setTenantId('');}}>Sign out</button></div>
    </div>
    {failure&&<div className='config-error'><AlertCircle size={15}/>{failure}</div>}
    {message&&<div className='config-success'><CheckCircle2 size={15}/>{message}</div>}
    {!tenants.length&&!loading?<section className='panel config-create'><div className='config-feature-icon'><Plus size={22}/></div><h2>Create your school workspace</h2><p>The signed-in account becomes the initial tenant owner. Each workspace has separate configuration, memberships and policy records.</p><form onSubmit={createTenant}><input value={newTenant} onChange={event=>setNewTenant(event.target.value)} placeholder='School or organisation name' minLength={2} maxLength={120} required/><button className='btn primary' disabled={busy}><Plus size={15}/> Create workspace</button></form></section>:null}
    {tenants.length>0&&<><div className='config-tenant-select'><label htmlFor='tenant-select'>Active school workspace</label><select id='tenant-select' value={tenantId} onChange={event=>setTenantId(event.target.value)}>{tenants.map(item=><option key={item.tenantId} value={item.tenantId}>{item.name} · {item.role}</option>)}</select><button className='btn secondary' onClick={()=>loadConfiguration()}><RefreshCw size={15}/> Reload settings</button></div>
      <div className='config-summary-grid'><div className='panel'><span>CONFIGURATION KEYS</span><b>{definitions.length}</b><small>Central registered settings</small></div><div className='panel'><span>ACTIVE MEMBERSHIP</span><b>{tenants.find(item=>item.tenantId===tenantId)?.role || '—'}</b><small>Server-verified role</small></div><div className='panel'><span>GOVERNANCE</span><b>Versioned</b><small>Optimistic concurrency and audit events</small></div></div>
      {Object.entries(grouped).map(([category, items])=><section className='panel config-category' key={category}><div className='panel-head'><div><h2>{category}</h2><p>Values are stored centrally and read through the platform configuration API.</p></div><SlidersHorizontal size={18}/></div><div className='config-settings'>{items.map(definition=>{const record=settings[definition.key];return <div className='config-setting' key={definition.key}><div className='config-setting-label'><b>{definition.label}</b><span>{definition.key.replace(/Id/g, '')}</span><small>{definition.description}</small></div><div className='config-setting-editor'>{['academic.currentYearId','assessment.gradingScaleId'].includes(definition.key) ? <p className='config-note'>This reference will be selected by name from its authorised registry when that registry is available. Internal record identifiers are not entered here.</p> : <><textarea aria-label={definition.label} rows={definition.valueType==='object'?4:2} value={drafts[definition.key]??''} onChange={event=>setDrafts(current=>({...current,[definition.key]:event.target.value}))}/><div><small>Type: {definition.valueType} · Version: {record?.version??'—'}</small><button className='btn primary' disabled={busy||!record||drafts[definition.key]===JSON.stringify(record.value,null,2)} onClick={()=>saveSetting(definition)}><Save size={14}/> Save setting</button><button className='btn secondary' onClick={()=>loadHistory(definition.key)}>Version history</button>{historyKey===definition.key&&<ul className='config-note'>{(historyItems[definition.key]||[]).map(item=><li key={item.id}>Version {item.version} · {new Date(item.changedAt).toLocaleString()} · by {item.changedBy}</li>)}</ul>}</div></>}</div></div>})}</div></section>)}
    </>}
    {loading&&<div className='config-loading'><LoaderCircle size={17}/> Loading governed configuration…</div>}
    <div className='config-footnote'><ShieldCheck size={16}/> Backend-enforced tenant membership · Central policy checks · Version history · Append-only audit API (tamper-proof storage requires the relational migration)</div>
  </div>;
}