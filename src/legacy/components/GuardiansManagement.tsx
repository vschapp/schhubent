// @ts-nocheck -- imported School Hub source, kept as-is
import { useCallback,useEffect,useMemo,useState,type FormEvent } from 'react';
import { api } from '@/lib/appdeploy-client';
import { AlertCircle,CheckCircle2,LoaderCircle,Plus,RefreshCw,Search,Trash2,Users } from 'lucide-react';
import { useTenantSession } from './AuthenticationGate';
import { apiErrorMessage } from '../lib/api-error';
import './GuardiansManagement.css';
type Student={id:string;schoolId:string;studentNumber:string;firstName:string;lastName:string;preferredName:string|null;status:string};
type Link={id:string;guardianId:string;relationship:string;isPrimary:boolean;canReceiveReports:boolean;guardian:{id:string;fullName:string;phone:string|null;email:string|null}};
const blank={fullName:'',phone:'',email:'',relationship:'Mother',isPrimary:true,canReceiveReports:true};
const relationships=['Mother','Father','Guardian','Grandparent','Sibling','Other relative'];
export default function GuardiansManagement(){
 const {tenantId}=useTenantSession();
 const [students,setStudents]=useState<Student[]>([]),[selectedId,setSelectedId]=useState('');
 const [links,setLinks]=useState<Link[]>([]),[form,setForm]=useState(blank),[showForm,setShowForm]=useState(false);
 const [search,setSearch]=useState(''),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const selected=students.find(s=>s.id===selectedId)||null;
 const loadStudents=useCallback(async()=>{setLoading(true);try{const r=await api.get('/api/students?tenantId='+encodeURIComponent(tenantId)+'&limit=100');const rows=(r.data.items||[]) as Student[];setStudents(rows);setSelectedId(v=>v&&rows.some(x=>x.id===v)?v:rows[0]?.id||'');}catch(e){setError(apiErrorMessage(e,'Unable to load authorised students.'));}finally{setLoading(false);}},[tenantId]);
 const loadLinks=useCallback(async()=>{if(!selectedId){setLinks([]);return;}try{const r=await api.get('/api/students/'+encodeURIComponent(selectedId)+'/guardians?tenantId='+encodeURIComponent(tenantId));setLinks((r.data.items||[]) as Link[]);}catch(e){setError(apiErrorMessage(e,'Unable to load guardian relationships.'));}},[tenantId,selectedId]);
 useEffect(()=>{void loadStudents();},[loadStudents]);useEffect(()=>{void loadLinks();},[loadLinks]);
 const filtered=useMemo(()=>students.filter(s=>(s.firstName+' '+s.lastName+' '+s.studentNumber).toLowerCase().includes(search.toLowerCase())),[students,search]);
 async function save(e:FormEvent){e.preventDefault();if(!selected)return;setSaving(true);setError('');setNotice('');try{await api.post('/api/students/'+encodeURIComponent(selected.id)+'/guardians?tenantId='+encodeURIComponent(tenantId),form);setShowForm(false);setForm(blank);setNotice('Guardian linked to the student.');await loadLinks();}catch(cause){setError(apiErrorMessage(cause,'Unable to link guardian.'));}finally{setSaving(false);}}
 async function remove(item:Link){if(!selected||!window.confirm('Remove '+item.guardian.fullName+' from this student? The guardian profile will be retained for other relationships.'))return;setSaving(true);setError('');try{await api.delete('/api/students/'+encodeURIComponent(selected.id)+'/guardians/'+encodeURIComponent(item.guardianId)+'?tenantId='+encodeURIComponent(tenantId));setNotice('Guardian relationship removed.');await loadLinks();}catch(cause){setError(apiErrorMessage(cause,'Unable to remove guardian relationship.'));}finally{setSaving(false);}}
 return <div className='guardian-page'>
  <header className='guardian-heading'><div><span>STUDENT INFORMATION SYSTEM</span><h1>Guardians &amp; Parents</h1><p>Maintain reusable guardian profiles and each student's authorised family relationships.</p></div><button className='guardian-primary' disabled={!selected} onClick={()=>{setForm(blank);setShowForm(true);setError('');}}><Plus size={16}/> Link guardian</button></header>
  {error&&<div className='guardian-alert'><AlertCircle size={16}/>{error}</div>}{notice&&<div className='guardian-notice'><CheckCircle2 size={16}/>{notice}</div>}
  <div className='guardian-toolbar'><label><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder='Search students by name or number'/></label><button onClick={()=>{void loadStudents();void loadLinks();}} disabled={loading}><RefreshCw size={15}/> Refresh</button></div>
  <div className='guardian-layout'><section className='guardian-panel'><h2>Students</h2>{loading?<p>Loading students…</p>:filtered.length===0?<p className='guardian-muted'>No authorised students found.</p>:<div className='guardian-students'>{filtered.map(s=><button key={s.id} className={selectedId===s.id?'selected':''} onClick={()=>setSelectedId(s.id)}><b>{s.preferredName||s.firstName} {s.lastName}</b><small>{s.studentNumber}</small></button>)}</div>}</section>
  <section className='guardian-panel'><div className='guardian-panel-head'><div><h2>{selected?selected.firstName+' '+selected.lastName:'Select a student'}</h2><p>{links.length} linked guardian(s)</p></div><Users size={20}/></div>
  {showForm&&<form className='guardian-form' onSubmit={save}><h3>Link a guardian</h3><div className='guardian-fields'>
   <label>Full name<input required maxLength={180} value={form.fullName} onChange={e=>setForm({...form,fullName:e.target.value})}/></label>
   <label>Relationship<select value={form.relationship} onChange={e=>setForm({...form,relationship:e.target.value})}>{relationships.map(x=><option key={x}>{x}</option>)}</select></label>
   <label>Phone<input maxLength={40} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label>
   <label>Email<input type='email' maxLength={320} value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
   </div><label className='guardian-check'><input type='checkbox' checked={form.isPrimary} onChange={e=>setForm({...form,isPrimary:e.target.checked})}/> Primary contact</label><label className='guardian-check'><input type='checkbox' checked={form.canReceiveReports} onChange={e=>setForm({...form,canReceiveReports:e.target.checked})}/> May receive student reports</label>
   <p className='guardian-muted'>Provide at least one contact method. Existing guardian profiles are reused when their email or phone matches exactly.</p>
   <div className='guardian-form-actions'><button type='button' onClick={()=>setShowForm(false)}>Cancel</button><button className='guardian-primary' disabled={saving}>{saving?'Saving…':'Save relationship'}</button></div>
  </form>}
  {!selected?<p className='guardian-muted'>Select a student to manage their guardian relationships.</p>:links.length===0?<div className='guardian-empty'><Users size={28}/><b>No guardians linked</b><span>Add a parent or guardian for this student.</span></div>:<div className='guardian-cards'>{links.map(item=><article key={item.id}><div><b>{item.guardian.fullName}</b>{item.isPrimary&&<span className='guardian-primary-tag'>Primary</span>}<small>{item.relationship} · {item.canReceiveReports?'Receives reports':'No report access'}</small><small>{item.guardian.phone||'No phone'} · {item.guardian.email||'No email'}</small></div><button disabled={saving} aria-label='Remove relationship' onClick={()=>void remove(item)}><Trash2 size={15}/></button></article>)}</div>}
  </section></div><p className='guardian-footnote'>Guardian contact profiles are tenant-scoped and can be linked to multiple students. Removing a link retains the guardian profile and its other family relationships. Portal login access is not granted by linking a guardian.</p>
 </div>;
}
