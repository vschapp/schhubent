// @ts-nocheck -- imported School Hub source, kept as-is
import { useEffect, useState } from 'react';
import { api } from '@/lib/appdeploy-client';
import { Activity, AlertCircle, CalendarCheck, GraduationCap, RefreshCw, Users } from 'lucide-react';
import { useTenantSession } from './AuthenticationGate';
type Overview = { generatedAt: string; metrics: { activeStudents: number; activeStaff: number; pendingAdmissions: number; attendanceRate: number | null; attendanceRecordsToday: number; pendingAttendanceCorrections: number }; recentActivity: Array<{ id: string; eventType: string; aggregateType: string; occurredAt: string }>; coverage: Record<string, boolean>; limitations: string[] };
const number = (value: number) => new Intl.NumberFormat('en-GH').format(value);
const label = (value: string) => value.replace(/[._-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
export default function DashboardWorkspace({ onNavigate }: { onNavigate: (module: string) => void }) {
 const { tenantId } = useTenantSession(); const [overview,setOverview]=useState<Overview|null>(null); const [loading,setLoading]=useState(true); const [failure,setFailure]=useState('');
 async function load(){setLoading(true);setFailure('');try{const response=await api.get('/api/dashboard/overview?tenantId='+encodeURIComponent(tenantId));setOverview(response.data as Overview);}catch(cause:any){setFailure(cause?.response?.data?.error||cause?.message||'Dashboard data is unavailable.');setOverview(null);}finally{setLoading(false);}}
 useEffect(()=>{void load();},[tenantId]);
 const cards=overview?[{title:'Active students',value:number(overview.metrics.activeStudents),icon:GraduationCap},{title:'Active staff',value:number(overview.metrics.activeStaff),icon:Users},{title:'Admissions to review',value:number(overview.metrics.pendingAdmissions),icon:Activity},{title:'Attendance today',value:overview.metrics.attendanceRate===null?'No register':overview.metrics.attendanceRate+'%',icon:CalendarCheck}]:[];
 return <section style={{display:'grid',gap:20}}>
  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12}}><div><div className='eyebrow'>LIVE TENANT WORKSPACE</div><h1>School overview</h1><p>Operational indicators from records visible to your current membership and school scope.</p></div><button className='btn secondary' onClick={()=>void load()} disabled={loading}><RefreshCw size={16}/> {loading?'Refreshing…':'Refresh data'}</button></div>
  {failure&&<div className='warning-note' role='alert'><AlertCircle size={16}/> {failure}</div>}
  {loading&&<div className='panel'>Loading authorised school data…</div>}
  {!loading&&overview&&<>
   <div className='metric-grid'>{cards.map(card=><div className='panel' key={card.title} style={{display:'flex',alignItems:'center',gap:14}}><card.icon size={22}/><div><small>{card.title}</small><h2 style={{margin:0}}>{card.value}</h2></div></div>)}</div>
   <div className='dashboard-grid'><section className='panel'><h2>Needs attention</h2><button className='task-row' onClick={()=>onNavigate('Admissions')}><b>{number(overview.metrics.pendingAdmissions)}</b><span>Admissions awaiting review</span></button><button className='task-row' onClick={()=>onNavigate('Attendance')}><b>{number(overview.metrics.pendingAttendanceCorrections)}</b><span>Attendance corrections pending</span></button><p>Attendance records counted today: {number(overview.metrics.attendanceRecordsToday)}</p></section>
   <section className='panel'><h2>Recent authorised activity</h2>{!overview.recentActivity.length&&<p>No readable activity events are available yet.</p>}{overview.recentActivity.map(event=><div key={event.id} style={{padding:'10px 0',borderBottom:'1px solid var(--border, #e5e7eb)'}}><b>{label(event.eventType)}</b><small style={{display:'block'}}>{label(event.aggregateType)} · {new Date(event.occurredAt).toLocaleString('en-GH')}</small></div>)}</section></div>
   {Object.values(overview.coverage).some(Boolean)&&<div className='warning-note'>Some registers exceed the dashboard aggregation cap. Displayed counts are partial; open the relevant module for complete paginated records.</div>}
   <div className='bottom-note'>AppDeploy persistence · Tenant membership · School-scope filtering · Server-side RBAC/ABAC · Updated {new Date(overview.generatedAt).toLocaleString('en-GH')}</div><ul>{overview.limitations.map(item=><li key={item}>{item}</li>)}</ul>
  </>}
 </section>;
}
