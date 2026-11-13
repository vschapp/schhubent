// @ts-nocheck -- imported School Hub source, kept as-is
import { useEffect, useState } from 'react';
import { api } from '@/lib/appdeploy-client';
import { AlertCircle, BookOpen, CheckCircle2, ClipboardList, RefreshCw } from 'lucide-react';
import { useTenantSession } from './AuthenticationGate';

type School={id:string;name:string};
type Ref={id:string;name:string;code?:string};
type Teaching={id:string;classId:string;subjectId:string;academicYearId:string;termId?:string|null};
type Lesson={id:string;title:string;classId:string;subjectId:string;plannedFor?:string|null;status:string};
type Assignment={id:string;title:string;classId:string;subjectId:string;dueAt?:string|null;status:string};

export default function LearningWorkspace(){
 const {tenantId}=useTenantSession();
 const [schools,setSchools]=useState<School[]>([]),[schoolId,setSchoolId]=useState('');
 const [classes,setClasses]=useState<Ref[]>([]),[subjects,setSubjects]=useState<Ref[]>([]),[years,setYears]=useState<Ref[]>([]),[terms,setTerms]=useState<Ref[]>([]);
 const [teaching,setTeaching]=useState<Teaching[]>([]),[lessons,setLessons]=useState<Lesson[]>([]),[assignments,setAssignments]=useState<Assignment[]>([]);
 const [classId,setClassId]=useState(''),[subjectId,setSubjectId]=useState(''),[yearId,setYearId]=useState(''),[termId,setTermId]=useState('');
 const [title,setTitle]=useState(''),[objectives,setObjectives]=useState(''),[content,setContent]=useState(''),[plannedFor,setPlannedFor]=useState('');
 const [assignmentTitle,setAssignmentTitle]=useState(''),[instructions,setInstructions]=useState(''),[dueAt,setDueAt]=useState(''),[maximumScore,setMaximumScore]=useState('100');
 const [busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[notice,setNotice]=useState('');
 const selectedTeaching=teaching.find(x=>x.classId===classId&&x.subjectId===subjectId&&x.academicYearId===yearId&&(!termId||!x.termId||x.termId===termId));
 async function loadSchools(){const r=await api.get('/api/platform/schools?tenantId='+encodeURIComponent(tenantId));const items=r.data.items||[];setSchools(items);if(!schoolId&&items.length)setSchoolId(items[0].id);}
 async function loadCatalog(id=schoolId){if(!id)return;const q=new URLSearchParams({tenantId,schoolId:id});const [c,t]=await Promise.all([api.get('/api/platform/academic-catalog?'+q.toString()),api.get('/api/academic/teaching-assignments?'+q.toString())]);setClasses(c.data.classes||[]);setSubjects(c.data.subjects||[]);setYears(c.data.academicYears||[]);setTerms(c.data.terms||[]);setTeaching(t.data.items||[]);}
 async function loadWork(){if(!schoolId)return;const q=new URLSearchParams({tenantId,schoolId,limit:'100'});const [l,a]=await Promise.all([api.get('/api/learning/lessons?'+q.toString()),api.get('/api/learning/assignments?'+q.toString())]);setLessons(l.data.items||[]);setAssignments(a.data.items||[]);}
 useEffect(()=>{void loadSchools().catch(e=>setFailure(e?.response?.data?.error||e?.message||'Unable to load schools.'));},[tenantId]);
 useEffect(()=>{if(schoolId){void loadCatalog().catch(e=>setFailure(e?.response?.data?.error||e?.message||'Unable to load academic assignments.'));void loadWork().catch(e=>setFailure(e?.response?.data?.error||e?.message||'Unable to load learning records.'));}},[schoolId,tenantId]);
 async function createLesson(e:React.FormEvent){e.preventDefault();if(!selectedTeaching)return;setBusy(true);setFailure('');setNotice('');try{await api.post('/api/learning/lessons?tenantId='+encodeURIComponent(tenantId),{schoolId,classId,subjectId,academicYearId:yearId,termId:termId||null,title,learningObjectives:objectives,content,plannedFor:plannedFor||null});setTitle('');setObjectives('');setContent('');setPlannedFor('');await loadWork();setNotice('Lesson plan saved and linked to the active teaching assignment.');}catch(e:any){setFailure(e?.response?.data?.error||e?.message||'Unable to save lesson plan.');}finally{setBusy(false);}}
 async function createAssignment(e:React.FormEvent){e.preventDefault();if(!selectedTeaching)return;setBusy(true);setFailure('');setNotice('');try{await api.post('/api/learning/assignments?tenantId='+encodeURIComponent(tenantId),{schoolId,classId,subjectId,academicYearId:yearId,termId:termId||null,title:assignmentTitle,instructions,dueAt:dueAt||null,maximumScore:maximumScore?Number(maximumScore):null});setAssignmentTitle('');setInstructions('');setDueAt('');await loadWork();setNotice('Assignment published for the selected active class.');}catch(e:any){setFailure(e?.response?.data?.error||e?.message||'Unable to publish assignment.');}finally{setBusy(false);}}
 return <div className="student-page">
  <div className="student-heading"><div><div className="student-eyebrow">TEACHING & LEARNING</div><h1>Lessons & assignments</h1><p>Plan lessons and publish class assignments using the existing teacher, class, subject and academic-period registries.</p></div><button className="student-button secondary" onClick={()=>void loadWork()}><RefreshCw size={14}/>Refresh</button></div>
  <section className="student-panel"><div className="student-form-grid">
   <label className="student-inline-label">School<select value={schoolId} onChange={e=>{setSchoolId(e.target.value);setClassId('');setSubjectId('');setYearId('');setTermId('');}}><option value="">Select school</option>{schools.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
   <label className="student-inline-label">Class<select value={classId} onChange={e=>setClassId(e.target.value)}><option value="">Select class</option>{classes.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
   <label className="student-inline-label">Subject<select value={subjectId} onChange={e=>setSubjectId(e.target.value)}><option value="">Select subject</option>{subjects.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
   <label className="student-inline-label">Academic year<select value={yearId} onChange={e=>setYearId(e.target.value)}><option value="">Select year</option>{years.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
   <label className="student-inline-label">Term<select value={termId} onChange={e=>setTermId(e.target.value)}><option value="">Any term</option>{terms.filter(x=>!yearId||!(x as any).academicYearId||(x as any).academicYearId===yearId).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
  </div><p className="student-muted">{selectedTeaching?'An active teaching assignment matches this selection.':'Select a class, subject and academic year assigned to your account to enable lesson and assignment creation.'}</p></section>
  {failure&&<div className="student-alert error"><AlertCircle size={15}/>{failure}</div>}{notice&&<div className="student-alert success"><CheckCircle2 size={15}/>{notice}</div>}
  <div className="assessment-tabs"><span><BookOpen size={15}/> Lesson planning</span><span><ClipboardList size={15}/> Class assignments</span></div>
  <div className="student-form-grid">
   <section className="student-panel"><h2>Prepare a lesson</h2><form className="student-form" onSubmit={createLesson}><label>Lesson title<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={160} required/></label><label>Learning objectives<textarea value={objectives} onChange={e=>setObjectives(e.target.value)} maxLength={2000} required/></label><label>Lesson content / teaching notes<textarea value={content} onChange={e=>setContent(e.target.value)} maxLength={12000}/></label><label>Planned date<input type="date" value={plannedFor} onChange={e=>setPlannedFor(e.target.value)}/></label><button className="student-button primary" disabled={busy||!selectedTeaching}>Save lesson plan</button></form></section>
   <section className="student-panel"><h2>Publish an assignment</h2><form className="student-form" onSubmit={createAssignment}><label>Assignment title<input value={assignmentTitle} onChange={e=>setAssignmentTitle(e.target.value)} maxLength={160} required/></label><label>Instructions<textarea value={instructions} onChange={e=>setInstructions(e.target.value)} maxLength={8000} required/></label><label>Due date<input type="datetime-local" value={dueAt} onChange={e=>setDueAt(e.target.value?new Date(e.target.value).toISOString(): '')}/></label><label>Maximum score<input type="number" min="0.01" max="10000" step="0.01" value={maximumScore} onChange={e=>setMaximumScore(e.target.value)}/></label><button className="student-button primary" disabled={busy||!selectedTeaching}>Publish assignment</button></form></section>
  </div>
  <div className="student-form-grid"><section className="student-panel"><h2>Lesson plans</h2><div className="student-table-wrap"><table className="student-table"><thead><tr><th>Lesson</th><th>Planned date</th><th>Status</th></tr></thead><tbody>{lessons.map(x=><tr key={x.id}><td><b>{x.title}</b></td><td>{x.plannedFor||'—'}</td><td>{x.status}</td></tr>)}</tbody></table>{!lessons.length&&<div className="student-empty">No lesson plans for this school yet.</div>}</div></section>
  <section className="student-panel"><h2>Class assignments</h2><div className="student-table-wrap"><table className="student-table"><thead><tr><th>Assignment</th><th>Due</th><th>Status</th></tr></thead><tbody>{assignments.map(x=><tr key={x.id}><td><b>{x.title}</b></td><td>{x.dueAt?new Date(x.dueAt).toLocaleString():'—'}</td><td>{x.status}</td></tr>)}</tbody></table>{!assignments.length&&<div className="student-empty">No assignments for this school yet.</div>}</div></section></div>
 </div>;
}
