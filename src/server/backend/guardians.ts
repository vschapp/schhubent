// @ts-nocheck -- imported School Hub source, kept as-is
import { db, error, json, requireAuth } from '@/server/appdeploy-sdk';
import { apiFailure, auditRecord, authorizeRecord, domainEvent, isRecord, isValidRecordId, tenantAccessFromRequest, tenantTable } from './platform';

type Guardian = { id:string; tenantId:string; fullName:string; phone:string|null; email:string|null; createdAt:string; createdBy:string };
type GuardianLink = { id:string; tenantId:string; schoolId:string; studentId:string; guardianId:string; relationship:string; isPrimary:boolean; canReceiveReports:boolean; createdAt:string; createdBy:string; removedAt:string|null; removedBy:string|null };
const validId=isValidRecordId;
const now=()=>new Date().toISOString();
const guardianTable=(t:string)=>tenantTable('guardians',t);
const linkTable=(t:string)=>tenantTable('student_guardians',t);
const linkId=(studentId:string,guardianId:string)=>studentId+'_'+guardianId;

async function access(ctx:any){
 const a=await tenantAccessFromRequest(ctx,{allowBodyFallback:false,requireTenantId:true,maxTenantLength:128,invalidTenantMessage:'A valid tenantId query parameter is required.',membershipMessage:'Tenant membership not found or access denied.'});
 if(!a.ok)return {response:a.response};
 return {tenantId:a.tenantId!,membership:a.membership!,response:null};
}
async function loadStudent(tenantId:string,id:string){
 const [s]=await db.get<Record<string,any>>(tenantTable('students',tenantId),[id],{consistent:true});
 return s&&s.id===id&&s.tenantId===tenantId&&s.status==='active'?s:null;
}
async function authorisedStudent(tenantId:string,membership:any,id:string,action:'read'|'create'|'update'|'delete'){
 const s=await loadStudent(tenantId,id);
 if(!s)return {student:null,response:error('Student record not found.',404)};
 if(!(await authorizeRecord(tenantId,membership,'student',action,s)))return {student:null,response:error('Permission denied for this student scope.',403)};
 return {student:s,response:null};
}
function validOptional(value:unknown,max:number){if(value===undefined||value===null||value==='')return null;return typeof value==='string'&&value.trim().length<=max?value.trim():undefined;}
function validEmail(value:string|null){return !value||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);}
export const guardianRoutes={
 'GET /api/students/:studentId/guardians':[requireAuth(),async(ctx:any)=>{
  try{
   const a=await access(ctx);if(a.response)return a.response;
   const id=String(ctx.params.studentId||'');if(!validId(id))return error('Invalid student identifier.',400);
   const scoped=await authorisedStudent(a.tenantId,a.membership,id,'read');if(scoped.response)return scoped.response;
   if(!(await authorizeRecord(a.tenantId,a.membership,'student-guardian','read',scoped.student)))return error('Permission denied for guardian relationships.',403);
   const page=await db.list<GuardianLink>(linkTable(a.tenantId),{limit:100});
   const links=page.items.filter(x=>x.tenantId===a.tenantId&&x.studentId===id&&!x.removedAt);
   const guardians=[];
   for(const link of links){
    const [g]=await db.get<Guardian>(guardianTable(a.tenantId),[link.guardianId],{consistent:true});
    if(g&&g.tenantId===a.tenantId&&await authorizeRecord(a.tenantId,a.membership,'guardian','read',{...g,schoolId:scoped.student.schoolId}))guardians.push({...link,guardian:{id:g.id,fullName:g.fullName,phone:g.phone,email:g.email}});
   }
   return json({items:guardians,hasMore:Boolean(page.nextToken)});
  }catch(cause){return apiFailure(cause,'Unable to retrieve guardian relationships.',{logLabel:'guardian.list failed'});}
 }],
 'POST /api/students/:studentId/guardians':[requireAuth(),async(ctx:any)=>{
  try{
   const a=await access(ctx);if(a.response)return a.response;
   const studentId=String(ctx.params.studentId||'');if(!validId(studentId))return error('Invalid student identifier.',400);
   const scoped=await authorisedStudent(a.tenantId,a.membership,studentId,'update');if(scoped.response)return scoped.response;
   if(!isRecord(ctx.body))return error('Guardian details are required.',400);
   if(Object.keys(ctx.body).some(k=>!['fullName','phone','email','relationship','isPrimary','canReceiveReports'].includes(k)))return error('Submit only guardian contact and relationship fields.',400);
   const fullName=typeof ctx.body.fullName==='string'?ctx.body.fullName.trim():'';
   const phone=validOptional(ctx.body.phone,40),email=validOptional(ctx.body.email,320),relationship=validOptional(ctx.body.relationship,60);
   if(fullName.length<2||fullName.length>180||phone===undefined||email===undefined||relationship===undefined||!relationship||!validEmail(email)||(!phone&&!email)||typeof ctx.body.isPrimary!=='boolean'||typeof ctx.body.canReceiveReports!=='boolean')return error('Provide a valid guardian name, at least one contact method, relationship and contact preferences.',400);
   if(!(await authorizeRecord(a.tenantId,a.membership,'student-guardian','create',scoped.student)))return error('Permission denied to link a guardian to this student.',403);
   const linksPage=await db.list<GuardianLink>(linkTable(a.tenantId),{limit:100});
   const active=linksPage.items.filter(x=>x.tenantId===a.tenantId&&x.studentId===studentId&&!x.removedAt);
   if(active.length>=3)return error('The configured default limit of three guardians per student has been reached.',409);
   const normalizedEmail=email?.toLowerCase()||null, normalizedPhone=phone?.replace(/\s+/g,'')||null;
   const all=await db.list<Guardian>(guardianTable(a.tenantId),{limit:500});
   const matches=all.items.filter(g=>g.tenantId===a.tenantId&&((normalizedEmail&&g.email?.toLowerCase()===normalizedEmail)||(normalizedPhone&&g.phone?.replace(/\s+/g,'')===normalizedPhone)));
   if(matches.length>1)return error('More than one guardian profile matches these contact details. Resolve the duplicate records before linking.',409);
   let guardian=matches[0];
   if(guardian&&guardian.fullName.toLowerCase()!==fullName.toLowerCase())return error('The contact details match an existing guardian with a different name. Verify the contact details before linking.',409);
   const timestamp=now(),createdGuardian=!guardian;
   if(!guardian)guardian={id:crypto.randomUUID(),tenantId:a.tenantId,fullName,phone,email,createdAt:timestamp,createdBy:ctx.user.userId};
   if(!(await authorizeRecord(a.tenantId,a.membership,'guardian',createdGuardian?'create':'read',{...guardian,schoolId:scoped.student.schoolId})))return error('Permission denied for this guardian record.',403);
   const id=linkId(studentId,guardian.id);
   const existing=active.find(x=>x.guardianId===guardian!.id);
   if(existing)return error('This guardian is already linked to the student.',409);
   const link:GuardianLink={id,tenantId:a.tenantId,schoolId:scoped.student.schoolId,studentId,guardianId:guardian.id,relationship,isPrimary:ctx.body.isPrimary,canReceiveReports:ctx.body.canReceiveReports,createdAt:timestamp,createdBy:ctx.user.userId,removedAt:null,removedBy:null};
   const ops:any[]=[];
   if(createdGuardian)ops.push(db.tx.add(guardianTable(a.tenantId),[guardian]));
   if(link.isPrimary)for(const old of active.filter(x=>x.isPrimary))ops.push(db.tx.update(linkTable(a.tenantId),[{id:old.id,if:{removedAt:null},record:{...old,isPrimary:false}}]));
   ops.push(db.tx.add(linkTable(a.tenantId),[link]));
   ops.push(db.tx.add(tenantTable('audit_events',a.tenantId),[auditRecord(a.tenantId,ctx.user.userId,'student.guardian-linked',studentId,{guardianId:guardian.id,relationship,isPrimary:link.isPrimary})]));
   ops.push(db.tx.add(tenantTable('domain_events',a.tenantId),[domainEvent(a.tenantId,ctx.user.userId,'student.guardian-linked','student',studentId,{guardianId:guardian.id,schoolId:scoped.student.schoolId,relationship},crypto.randomUUID(),timestamp)]));
   await db.transact(ops);
   return json({relationship:{...link,guardian:{id:guardian.id,fullName:guardian.fullName,phone:guardian.phone,email:guardian.email}}},201);
  }catch(cause){return apiFailure(cause,'Unable to link the guardian to this student.',{logLabel:'guardian.link failed'});}
 }],
 'DELETE /api/students/:studentId/guardians/:guardianId':[requireAuth(),async(ctx:any)=>{
  try{
   const a=await access(ctx);if(a.response)return a.response;
   const studentId=String(ctx.params.studentId||''),guardianId=String(ctx.params.guardianId||'');
   if(!validId(studentId)||!validId(guardianId))return error('Invalid student or guardian identifier.',400);
   const scoped=await authorisedStudent(a.tenantId,a.membership,studentId,'update');if(scoped.response)return scoped.response;
   const [link]=await db.get<GuardianLink>(linkTable(a.tenantId),[linkId(studentId,guardianId)],{consistent:true});
   if(!link||link.tenantId!==a.tenantId||link.studentId!==studentId||link.guardianId!==guardianId||link.removedAt)return error('Guardian relationship not found.',404);
   if(!(await authorizeRecord(a.tenantId,a.membership,'student-guardian','delete',scoped.student)))return error('Permission denied to remove this relationship.',403);
   const timestamp=now();
   await db.transact([
    db.tx.update(linkTable(a.tenantId),[{id:link.id,if:{removedAt:null},record:{...link,removedAt:timestamp,removedBy:ctx.user.userId}}]),
    db.tx.add(tenantTable('audit_events',a.tenantId),[auditRecord(a.tenantId,ctx.user.userId,'student.guardian-unlinked',studentId,{guardianId})]),
    db.tx.add(tenantTable('domain_events',a.tenantId),[domainEvent(a.tenantId,ctx.user.userId,'student.guardian-unlinked','student',studentId,{guardianId,schoolId:scoped.student.schoolId},crypto.randomUUID(),timestamp)]),
   ]);
   return json({removed:true});
  }catch(cause){return apiFailure(cause,'Unable to remove the guardian relationship.',{logLabel:'guardian.unlink failed'});}
 }]
};
