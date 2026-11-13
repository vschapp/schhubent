// @ts-nocheck -- imported School Hub source, kept as-is
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '@/lib/appdeploy-client';
import { AlertCircle, CheckCircle2, ClipboardList, FileText, LoaderCircle, Plus, RefreshCw, Search, Upload, X } from 'lucide-react';
import { useTenantSession } from './AuthenticationGate';
import { apiErrorMessage } from '../lib/api-error';
import './AdmissionsManagement.css';

type School = { id: string; name: string };
type RefItem = { id: string; name: string; startsOn?: string; endsOn?: string };
type Status = 'submitted'|'under_review'|'waitlisted'|'offered'|'accepted'|'rejected'|'withdrawn'|'enrolled';
type Application = {
 id:string; schoolId:string; applicationNumber:string; academicYearId:string; requestedClassId:string|null;
 applicantFirstName:string; applicantLastName:string; otherNames:string|null; dateOfBirth:string|null; gender:string|null;
 applicantEmail:string|null; applicantPhone:string|null; guardianName:string|null; guardianRelationship:string|null;
 guardianEmail:string|null; guardianPhone:string|null; previousSchool:string|null; notes:string|null;
 status:Status; submittedAt:string; decisionAt:string|null; studentId:string|null; version:number;
};
type Decision = {id:string;decision:string;reason:string|null;actorUserId:string;decidedAt:string};
type DocumentItem = {id:string;fileName:string;contentType:string;sizeBytes:number;uploadedAt:string;url:string|null};
type FormState = {
 schoolId:string; academicYearId:string; requestedClassId:string; applicantFirstName:string; applicantLastName:string;
 otherNames:string; dateOfBirth:string; gender:string; applicantEmail:string; applicantPhone:string;
 guardianName:string; guardianRelationship:string; guardianEmail:string; guardianPhone:string; previousSchool:string; notes:string;
};
const emptyForm:FormState={schoolId:'',academicYearId:'',requestedClassId:'',applicantFirstName:'',applicantLastName:'',otherNames:'',dateOfBirth:'',gender:'',applicantEmail:'',applicantPhone:'',guardianName:'',guardianRelationship:'',guardianEmail:'',guardianPhone:'',previousSchool:'',notes:''};
const labels:Record<Status,string>={submitted:'Submitted',under_review:'Under review',waitlisted:'Waitlisted',offered:'Offer made',accepted:'Accepted',rejected:'Rejected',withdrawn:'Withdrawn',enrolled:'Enrolled'};
const nextStatuses:Record<Status,Status[]>={submitted:['under_review','withdrawn'],under_review:['waitlisted','offered','rejected','withdrawn'],waitlisted:['offered','rejected','withdrawn'],offered:['accepted','rejected','withdrawn'],accepted:['enrolled','withdrawn'],rejected:[],withdrawn:[],enrolled:[]};
function dateLabel(value:string){return value?new Date(value).toLocaleDateString(): '—';}
function messageFrom(cause:unknown,fallback:string){return apiErrorMessage(cause,fallback);}
export default function AdmissionsManagement(){
 const {tenantId}=useTenantSession();
 const [schools,setSchools]=useState<School[]>([]),[schoolId,setSchoolId]=useState('');
 const [years,setYears]=useState<RefItem[]>([]),[classes,setClasses]=useState<RefItem[]>([]);
 const [items,setItems]=useState<Application[]>([]),[nextToken,setNextToken]=useState<string|null>(null);
 const [status,setStatus]=useState('all'),[search,setSearch]=useState(''),[appliedSearch,setAppliedSearch]=useState('');
 const [form,setForm]=useState<FormState>(emptyForm),[showForm,setShowForm]=useState(false),[saving,setSaving]=useState(false);
 const [requestKey,setRequestKey]=useState<{fingerprint:string;id:string}|null>(null);
 const [selected,setSelected]=useState<Application|null>(null),[decisions,setDecisions]=useState<Decision[]>([]),[documents,setDocuments]=useState<DocumentItem[]>([]);
 const [transition,setTransition]=useState<Status | ''>(''),[reason,setReason]=useState(''),[studentId,setStudentId]=useState('');
 const [file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false);
 const [failure,setFailure]=useState(''),[notice,setNotice]=useState('');
 const [academicLoading,setAcademicLoading]=useState(false);
 const [schoolError,setSchoolError]=useState('');
 const [refreshed,setRefreshed]=useState(0);

 const params=useMemo(()=>new URLSearchParams({tenantId,schoolId,limit:'50',status,...(appliedSearch?{search:appliedSearch}:{})}),[tenantId,schoolId,status,appliedSearch]);
 const loadSchools=useCallback(async()=>{
  const response=await api.get('/api/platform/schools?tenantId='+encodeURIComponent(tenantId));
  const list=(response.data.items||[]) as School[];setSchools(list);
  if(!schoolId&&list.length)setSchoolId(list[0].id);
 },[tenantId,schoolId]);
 const loadReferences=useCallback(async(id:string)=>{
  if(!id){setYears([]);setClasses([]);return;}
  setAcademicLoading(true);
  try{const q=new URLSearchParams({tenantId,schoolId:id});const response=await api.get('/api/platform/academic-catalog?'+q.toString());setYears(response.data.academicYears||[]);setClasses(response.data.classes||[]);}
  catch(cause){setFailure(messageFrom(cause,'Unable to load academic year and class options.'));setYears([]);setClasses([]);}
  finally{setAcademicLoading(false);}
 },[tenantId]);
 const loadApplications=useCallback(async(token?:string)=>{
  if(!schoolId){setItems([]);setNextToken(null);return;}
  setLoading(true);setFailure('');
  try{const q=new URLSearchParams(params);if(token)q.set('nextToken',token);const response=await api.get('/api/admissions?'+q.toString());const page=(response.data.items||[]) as Application[];
   setItems(current=>token?[...current,...page.filter(x=>!current.some(y=>y.id===x.id))]:page);setNextToken(response.data.nextToken||null);
  }catch(cause){setFailure(messageFrom(cause,'Unable to load admissions applications.'));}
  finally{setLoading(false);}
 },[params,schoolId]);
 const loadDetail=useCallback(async(app:Application)=>{
  setSelected(app);setFailure('');setNotice('');
  try{const response=await api.get('/api/admissions/'+encodeURIComponent(app.id)+'?tenantId='+encodeURIComponent(tenantId));setSelected(response.data.application);setDecisions(response.data.decisions||[]);setDocuments(response.data.documents||[]);}
  catch(cause){setFailure(messageFrom(cause,'Unable to load application details.'));setDecisions([]);setDocuments([]);}
 },[tenantId]);
 useEffect(()=>{void loadSchools().catch(cause=>setSchoolError(messageFrom(cause,'Unable to load authorised schools.')));},[loadSchools]);
 useEffect(()=>{void loadReferences(schoolId);},[loadReferences,schoolId]);
 useEffect(()=>{void loadApplications();},[loadApplications,refreshed]);
 function startCreate(){setRequestKey(null);setForm({...emptyForm,schoolId,academicYearId:years[0]?.id||''});setShowForm(true);setSelected(null);setFailure('');setNotice('');}
 async function saveApplication(event:FormEvent){
  event.preventDefault();setSaving(true);setFailure('');setNotice('');
  const basePayload={...form,requestedClassId:form.requestedClassId||null,dateOfBirth:form.dateOfBirth||null};
  const requestFingerprint=JSON.stringify(basePayload);
  const requestId=requestKey?.fingerprint===requestFingerprint?requestKey.id:crypto.randomUUID();
  setRequestKey({fingerprint:requestFingerprint,id:requestId});
  const payload={...basePayload,requestId};
  try{const response=await api.post('/api/admissions?tenantId='+encodeURIComponent(tenantId),payload);setRequestKey(null);setShowForm(false);setForm(emptyForm);setNotice('Application '+response.data.application.applicationNumber+' created.');setRefreshed(v=>v+1);}
  catch(cause){setFailure(messageFrom(cause,'Unable to submit the application.'));}
  finally{setSaving(false);}
 }
 async function updateStatus(event:FormEvent){
  event.preventDefault();if(!selected||!transition)return;setBusy(true);setFailure('');setNotice('');
  try{await api.put('/api/admissions/'+encodeURIComponent(selected.id)+'/status?tenantId='+encodeURIComponent(tenantId),{status:transition,reason,expectedVersion:selected.version,...(transition==='enrolled'?{studentId}: {})});
   setNotice('Application status updated.');setTransition('');setReason('');setStudentId('');await loadApplications();const latest={...selected,status:transition,version:selected.version+1,studentId:transition==='enrolled'?studentId:selected.studentId};await loadDetail(latest);
  }catch(cause){setFailure(messageFrom(cause,'Unable to update application status. Reload and retry.'));}
  finally{setBusy(false);}
 }
 async function uploadDocument(event:FormEvent){
  event.preventDefault();if(!selected||!file)return;setBusy(true);setFailure('');setNotice('');
  try{
   if(file.size>600*1024)throw new Error('Choose a document no larger than 600 KB.');
   const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('Unable to read the selected file.'));reader.onload=()=>{const result=String(reader.result||'');const comma=result.indexOf(',');if(comma<0)reject(new Error('Invalid file encoding.'));else resolve(result.slice(comma+1));};reader.readAsDataURL(file);});
   const response=await api.post('/api/admissions/'+encodeURIComponent(selected.id)+'/documents?tenantId='+encodeURIComponent(tenantId),{fileName:file.name,contentType:file.type,contentBase64:base64,sizeBytes:file.size});
   setFile(null);setDocuments(current=>[...current,response.data.document]);setNotice('Document uploaded securely.');
   await loadDetail(selected);
  }catch(cause){setFailure(messageFrom(cause,'Unable to upload the document.'));}
  finally{setBusy(false);}
 }
 async function removeDocument(doc:DocumentItem){
  if(!selected)return;setBusy(true);setFailure('');
  try{await api.delete('/api/admissions/'+encodeURIComponent(selected.id)+'/documents/'+encodeURIComponent(doc.id)+'?tenantId='+encodeURIComponent(tenantId));setDocuments(current=>current.filter(x=>x.id!==doc.id));setNotice('Document removed.');}
  catch(cause){setFailure(messageFrom(cause,'Unable to remove the document.'));}
  finally{setBusy(false);}
 }
 const summary=useMemo(()=>({total:items.length,review:items.filter(x=>x.status==='under_review').length,offers:items.filter(x=>['offered','accepted'].includes(x.status)).length,enrolled:items.filter(x=>x.status==='enrolled').length}),[items]);
 return <div className="admissions-page">
  <div className="admissions-heading"><div><div className="admissions-eyebrow">SCHOOL OPERATIONS</div><h1>Admissions</h1><p>Manage applications, reviews, admission decisions and student enrolment links.</p></div><button className="admissions-btn primary" onClick={startCreate} disabled={!schoolId}><Plus size={16}/> New application</button></div>
  {failure&&<div className="admissions-alert error"><AlertCircle size={15}/>{failure}<button onClick={()=>setFailure('')}><X size={14}/></button></div>}
  {notice&&<div className="admissions-alert success"><CheckCircle2 size={15}/>{notice}<button onClick={()=>setNotice('')}><X size={14}/></button></div>}
  {schoolError&&<div className="admissions-alert error">{schoolError}</div>}
  <section className="admissions-summary"><div><span>APPLICATIONS IN THIS PAGE</span><b>{summary.total}</b></div><div><span>UNDER REVIEW</span><b>{summary.review}</b></div><div><span>OFFERS / ACCEPTED</span><b>{summary.offers}</b></div><div><span>ENROLLED</span><b>{summary.enrolled}</b></div></section>
  <section className="admissions-panel">
   <div className="admissions-toolbar">
    <label>School<select value={schoolId} onChange={e=>{setSchoolId(e.target.value);setSelected(null);setShowForm(false);}}><option value="">Choose school</option>{schools.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <label>Status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All statuses</option>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    <form className="admissions-search" onSubmit={e=>{e.preventDefault();setAppliedSearch(search.trim());}}><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search applicant or application no."/><button type="submit">Search</button></form>
    <button className="admissions-btn secondary" onClick={()=>{setSelected(null);setRefreshed(v=>v+1);}} disabled={loading}><RefreshCw size={14}/> Refresh</button>
   </div>
   {showForm&&<form className="admissions-form" onSubmit={saveApplication}>
    <div className="admissions-form-head"><div><b>New admission application</b><p>Application numbers and record identifiers are generated by the server.</p></div><button type="button" onClick={()=>setShowForm(false)}><X size={16}/></button></div>
    <div className="admissions-form-grid">
     <label>Applicant first name *<input required maxLength={80} value={form.applicantFirstName} onChange={e=>setForm(v=>({...v,applicantFirstName:e.target.value}))}/></label>
     <label>Applicant last name *<input required maxLength={80} value={form.applicantLastName} onChange={e=>setForm(v=>({...v,applicantLastName:e.target.value}))}/></label>
     <label>Other names<input maxLength={100} value={form.otherNames} onChange={e=>setForm(v=>({...v,otherNames:e.target.value}))}/></label>
     <label>Date of birth<input type="date" value={form.dateOfBirth} onChange={e=>setForm(v=>({...v,dateOfBirth:e.target.value}))}/></label>
     <label>Gender<select value={form.gender} onChange={e=>setForm(v=>({...v,gender:e.target.value}))}><option value="">Not specified</option><option>Female</option><option>Male</option><option>Other</option></select></label>
     <label>Applicant email<input type="email" maxLength={254} value={form.applicantEmail} onChange={e=>setForm(v=>({...v,applicantEmail:e.target.value}))}/></label>
     <label>Applicant phone<input type="tel" maxLength={40} value={form.applicantPhone} onChange={e=>setForm(v=>({...v,applicantPhone:e.target.value}))}/></label>
     <label>Academic year *<select required value={form.academicYearId} onChange={e=>setForm(v=>({...v,academicYearId:e.target.value}))}><option value="">Choose year</option>{years.map(y=><option key={y.id} value={y.id}>{y.name}</option>)}</select></label>
     <label>Requested class<select value={form.requestedClassId} onChange={e=>setForm(v=>({...v,requestedClassId:e.target.value}))}><option value="">Not specified</option>{classes.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
     <label>Previous school<input maxLength={180} value={form.previousSchool} onChange={e=>setForm(v=>({...v,previousSchool:e.target.value}))}/></label>
     <label>Parent / guardian name<input maxLength={160} value={form.guardianName} onChange={e=>setForm(v=>({...v,guardianName:e.target.value}))}/></label>
     <label>Relationship<input maxLength={80} value={form.guardianRelationship} onChange={e=>setForm(v=>({...v,guardianRelationship:e.target.value}))}/></label>
     <label>Guardian email<input type="email" maxLength={254} value={form.guardianEmail} onChange={e=>setForm(v=>({...v,guardianEmail:e.target.value}))}/></label>
     <label>Guardian phone<input type="tel" maxLength={40} value={form.guardianPhone} onChange={e=>setForm(v=>({...v,guardianPhone:e.target.value}))}/></label>
     <label className="wide">Application notes<textarea rows={3} maxLength={2000} value={form.notes} onChange={e=>setForm(v=>({...v,notes:e.target.value}))}/></label>
    </div>
    <div className="admissions-form-actions"><button type="button" className="admissions-btn secondary" onClick={()=>setShowForm(false)}>Cancel</button><button type="submit" className="admissions-btn primary" disabled={saving||academicLoading||!form.academicYearId}>{saving?<LoaderCircle className="spin" size={15}/>:<CheckCircle2 size={15}/>} Submit application</button></div>
   </form>}
   {loading?<div className="admissions-loading"><LoaderCircle className="spin"/> Loading applications…</div>:!schoolId?<div className="admissions-empty">Choose an authorised school to view its admissions register.</div>:items.length===0?<div className="admissions-empty"><ClipboardList size={25}/><b>No applications found</b><span>Submit a new application or adjust the filters.</span></div>:<div className="admissions-table-wrap"><table className="admissions-table"><thead><tr><th>APPLICATION</th><th>APPLICANT</th><th>ACADEMIC YEAR</th><th>SUBMITTED</th><th>STATUS</th><th></th></tr></thead><tbody>{items.map(item=><tr key={item.id} className={selected?.id===item.id?'selected':''} onClick={()=>void loadDetail(item)}><td><b>{item.applicationNumber}</b><small>{item.id.slice(0,8)}</small></td><td><b>{item.applicantFirstName} {item.applicantLastName}</b><small>{item.applicantEmail||item.applicantPhone||'No contact details'}</small></td><td>{years.find(y=>y.id===item.academicYearId)?.name||'—'}</td><td>{dateLabel(item.submittedAt)}</td><td><span className={'admissions-status '+item.status}>{labels[item.status]}</span></td><td><button className="admissions-btn tiny" onClick={e=>{e.stopPropagation();void loadDetail(item);}}>Review</button></td></tr>)}</tbody></table></div>}
   {nextToken&&<div className="admissions-pagination"><span>More applications are available.</span><button className="admissions-btn secondary" onClick={()=>void loadApplications(nextToken)} disabled={loading}>Load next page</button></div>}
  </section>
  {selected&&<section className="admissions-panel admissions-detail">
   <div className="admissions-detail-head"><div><div className="admissions-eyebrow">APPLICATION REVIEW</div><h2>{selected.applicantFirstName} {selected.applicantLastName}</h2><p>{selected.applicationNumber} · Submitted {dateLabel(selected.submittedAt)}</p></div><span className={'admissions-status '+selected.status}>{labels[selected.status]}</span></div>
   <div className="admissions-detail-grid"><div><small>Applicant contact</small><b>{selected.applicantEmail||'Email not provided'}</b><span>{selected.applicantPhone||'Phone not provided'}</span></div><div><small>Parent / guardian</small><b>{selected.guardianName||'Not provided'}</b><span>{[selected.guardianRelationship,selected.guardianPhone].filter(Boolean).join(' · ')||'No guardian details'}</span></div><div><small>Previous school</small><b>{selected.previousSchool||'Not provided'}</b><span>DOB: {selected.dateOfBirth||'Not provided'}</span></div><div><small>Enrolled student</small><b>{selected.studentId||'Not linked'}</b><span>Version {selected.version}</span></div></div>
   {selected.notes&&<div className="admissions-notes"><b>Application notes</b><p>{selected.notes}</p></div>}
   <div className="admissions-subsection"><h3>Application documents</h3><form className="admissions-upload" onSubmit={uploadDocument}><input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={e=>setFile(e.target.files?.[0]||null)}/><span>PDF, JPEG or PNG · up to 600 KB</span><button className="admissions-btn secondary" disabled={!file||busy}><Upload size={14}/> Upload</button></form>
    {documents.length===0?<p className="admissions-muted">No documents attached.</p>:documents.map(doc=><div className="admissions-document" key={doc.id}><FileText size={17}/><div><b>{doc.fileName}</b><small>{doc.contentType} · {(doc.sizeBytes/1024).toFixed(0)} KB</small></div>{doc.url&&<a href={doc.url} target="_blank" rel="noreferrer">Open</a>}<button onClick={()=>void removeDocument(doc)} disabled={busy} aria-label="Remove document"><X size={15}/></button></div>)}
   </div>
   <div className="admissions-subsection"><h3>Admission decisions & history</h3>{decisions.length===0?<p className="admissions-muted">No formal decisions recorded yet.</p>:<div className="admissions-history">{decisions.map(d=><div key={d.id}><b>{d.decision.replace(/_/g,' ')}</b><span>{dateLabel(d.decidedAt)} · {d.actorUserId.slice(0,8)}</span>{d.reason&&<p>{d.reason}</p>}</div>)}</div>}</div>
   {nextStatuses[selected.status].length>0&&<form className="admissions-transition" onSubmit={updateStatus}><h3>Update application status</h3><div className="admissions-transition-grid"><label>Next status<select required value={transition} onChange={e=>setTransition(e.target.value as Status)}><option value="">Choose action</option>{nextStatuses[selected.status].map(s=><option key={s} value={s}>{labels[s]}</option>)}</select></label>{transition==='enrolled'&&<label>Existing admitted student ID *<input required value={studentId} onChange={e=>setStudentId(e.target.value)} placeholder="Paste student record ID"/></label>}<label className="wide">Decision / action reason<textarea rows={2} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label></div><div className="admissions-form-actions"><button className="admissions-btn primary" disabled={!transition||busy}>{busy?<LoaderCircle className="spin" size={15}/>:<CheckCircle2 size={15}/>} Save transition</button></div></form>}
  </section>}
 </div>;
}
