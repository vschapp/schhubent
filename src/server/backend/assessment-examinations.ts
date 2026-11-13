// @ts-nocheck -- imported School Hub source, kept as-is
import { db, error, json, requireAuth } from '@/server/appdeploy-sdk';
import {
  apiFailure, auditRecord, authorize, authorizeRecord, domainEvent, hasSchoolScope,
  isRecord, isValidRecordId, tenantAccessFromRequest, tenantTable,
} from './platform';
import { activeSchool, academicRecord, validDate } from './academic-operations';

const validId = isValidRecordId;
const now = () => new Date().toISOString();
const TYPES = ['class_test', 'assignment', 'project', 'practical', 'quiz', 'continuous_assessment', 'mock', 'other'];
const EXAM_TYPES = ['end_of_term', 'mid_term', 'mock', 'entrance', 'external', 'other'];

async function access(ctx: any) {
  const result = await tenantAccessFromRequest(ctx, {
    allowBodyFallback: false, requireTenantId: true, maxTenantLength: 128,
    invalidTenantMessage: 'A valid tenantId query parameter is required.',
    membershipMessage: 'Tenant membership not found or access denied.',
  });
  return result.ok
    ? { tenantId: result.tenantId, membership: result.membership, response: null }
    : { tenantId: '', membership: null, response: result.response };
}
function pageSize(value: unknown) {
  const n = value === undefined ? 50 : Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : null;
}
function cleanText(value: unknown, max: number) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length > 0 && v.length <= max ? v : null;
}
function validScore(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
async function completeBoundedList(table: string, tenantId: string) {
  const page = await db.list<Record<string, any>>(tenantTable(table, tenantId), { limit: 1000 });
  if (page.nextToken) throw new Error('This integrity check exceeds the supported bounded page. The operation was stopped safely; use a narrower indexed query before retrying.');
  return page.items.filter(x => x.tenantId === tenantId);
}
function gradeBandsValid(bands: any[]) {
  if (!Array.isArray(bands) || bands.length < 1 || bands.length > 20) return false;
  const sorted = [...bands].sort((a, b) => Number(a.minimumScore) - Number(b.minimumScore));
  let expected = 0;
  const codes = new Set<string>();
  for (const b of sorted) {
    if (!isRecord(b) || !cleanText(b.gradeCode, 20) || !cleanText(b.label, 80) ||
      !Number.isFinite(b.minimumScore) || !Number.isFinite(b.maximumScore) ||
      b.minimumScore !== expected || b.maximumScore < b.minimumScore || b.maximumScore > 100 ||
      (b.gradePoint !== undefined && b.gradePoint !== null && (!Number.isFinite(b.gradePoint) || b.gradePoint < 0)) ||
      codes.has(String(b.gradeCode).toLowerCase())) return false;
    codes.add(String(b.gradeCode).toLowerCase());
    expected = b.maximumScore + 0.001;
  }
  return Math.abs(expected - 100.001) < 0.000001;
}
async function validateContext(tenantId: string, input: any) {
  const [school, klass, subject, year] = await Promise.all([
    activeSchool(tenantId, input.schoolId),
    academicRecord(tenantId, input.schoolId, 'class_groups', input.classId),
    academicRecord(tenantId, input.schoolId, 'subjects', input.subjectId),
    academicRecord(tenantId, input.schoolId, 'academic_years', input.academicYearId),
  ]);
  if (!school || !klass || !subject || !year) return false;
  if (input.termId) {
    const term = await academicRecord(tenantId, input.schoolId, 'academic_terms', input.termId);
    if (!term || term.academicYearId !== input.academicYearId) return false;
  }
  if (input.sectionId) {
    const section = await academicRecord(tenantId, input.schoolId, 'sections', input.sectionId);
    if (!section || section.classId !== input.classId) return false;
  }
  return true;
}
async function assignmentExists(tenantId: string, input: any, teacherUserId?: string) {
  const rows = await completeBoundedList('teaching_assignments', tenantId);
  return rows.some(x => x.status === 'active' && x.schoolId === input.schoolId &&
    x.classId === input.classId && x.subjectId === input.subjectId &&
    x.academicYearId === input.academicYearId &&
    (!input.termId || !x.termId || x.termId === input.termId) &&
    (!teacherUserId || x.teacherUserId === teacherUserId));
}
async function listScoped(ctx: any, table: string, resource: string) {
  const a = await access(ctx);
  if (a.response) return a.response;
  const schoolId = String(ctx.query.schoolId || '');
  const limit = pageSize(ctx.query.limit);
  if (!validId(schoolId) || !limit || !(await activeSchool(a.tenantId, schoolId))) return error('Choose an active school and a page size from 1 to 100.', 400);
  if (!hasSchoolScope(a.membership, schoolId)) return error('This school is outside your authorised scope.', 403);
  const page = await db.list<Record<string, any>>(tenantTable(table, a.tenantId), {
    limit, ...(ctx.query.nextToken ? { nextToken: ctx.query.nextToken } : {}),
  });
  const items = [];
  for (const item of page.items) {
    if (item.tenantId !== a.tenantId || item.schoolId !== schoolId) continue;
    if (ctx.query.status && item.status !== ctx.query.status) continue;
    if (ctx.query.classId && item.classId !== ctx.query.classId) continue;
    if (ctx.query.subjectId && item.subjectId !== ctx.query.subjectId) continue;
    if (ctx.query.academicYearId && item.academicYearId !== ctx.query.academicYearId) continue;
    if (ctx.query.termId && item.termId !== ctx.query.termId) continue;
    if (await authorizeRecord(a.tenantId, a.membership, resource, 'read', item)) items.push(item);
  }
  return json({ items, nextToken: page.nextToken || null, pageSize: limit });
}

export const assessmentExaminationRoutes = {
  'GET /api/assessments/definitions': [requireAuth(), async (ctx: any) => {
    try { return await listScoped(ctx, 'assessment_definitions', 'assessment'); }
    catch (e) { return apiFailure(e, 'Unable to retrieve assessment definitions.', { logLabel: 'assessment.list failed' }); }
  }],
  'POST /api/assessments/definitions': [requireAuth(), async (ctx: any) => {
    try {
      const a = await access(ctx); if (a.response) return a.response;
      const b = ctx.body;
      if (!isRecord(b) || Object.keys(b).some(k => !['schoolId','classId','sectionId','subjectId','academicYearId','termId','title','assessmentType','maximumScore','weighting','dueDate','teacherUserId'].includes(k))) return error('Submit only registered assessment definition fields.', 400);
      const title = cleanText(b.title, 160);
      if (![b.schoolId,b.classId,b.subjectId,b.academicYearId].every(validId) || (b.sectionId && !validId(b.sectionId)) || (b.termId && !validId(b.termId)) ||
        !title || !TYPES.includes(String(b.assessmentType)) || !Number.isFinite(b.maximumScore) || b.maximumScore <= 0 ||
        (b.weighting !== undefined && (!Number.isFinite(b.weighting) || b.weighting <= 0 || b.weighting > 100)) ||
        (b.dueDate != null && !validDate(b.dueDate))) return error('Assessment fields, score maximum, weighting or due date are invalid.', 400);
      const input = { schoolId:b.schoolId, classId:b.classId, sectionId:b.sectionId || null, subjectId:b.subjectId, academicYearId:b.academicYearId, termId:b.termId || null };
      if (!hasSchoolScope(a.membership, input.schoolId) || !(await validateContext(a.tenantId,input))) return error('The academic references are unavailable or outside the selected school.', 400);
      if (!(await authorize(a.tenantId,a.membership,'assessment','create',input))) return error('Permission denied for assessment definitions.',403);
      if (!(await assignmentExists(a.tenantId,input,b.teacherUserId || undefined))) return error('An active teaching assignment is required for this class, subject and period.',409);
      const record = { id:crypto.randomUUID(), tenantId:a.tenantId, ...input, title, assessmentType:b.assessmentType,
        maximumScore:b.maximumScore, weighting:b.weighting ?? 1, dueDate:b.dueDate || null, status:'draft',
        createdBy:ctx.user.userId, version:1, createdAt:now(), updatedAt:now(), updatedBy:ctx.user.userId };
      if (!(await authorizeRecord(a.tenantId,a.membership,'assessment','create',record))) return error('Permission denied for this assessment scope.',403);
      await db.transact([
        db.tx.add(tenantTable('assessment_definitions',a.tenantId),[record]),
        db.tx.add(tenantTable('audit_events',a.tenantId),[auditRecord(a.tenantId,ctx.user.userId,'assessment-definition.created','assessment-definition',{schoolId:input.schoolId,classId:input.classId,subjectId:input.subjectId})]),
        db.tx.add(tenantTable('domain_events',a.tenantId),[domainEvent(a.tenantId,ctx.user.userId,'assessment-definition.created','assessment-definition',record.id,{schoolId:input.schoolId,classId:input.classId,subjectId:input.subjectId},crypto.randomUUID(),record.createdAt)]),
      ]);
      return json({item:record},201);
    } catch(e) { return apiFailure(e,'Unable to create assessment definition.',{logLabel:'assessment.create failed'}); }
  }],
  'POST /api/assessments/definitions/:assessmentId/lifecycle': [requireAuth(), async (ctx: any) => {
    try {
      const a=await access(ctx); if(a.response)return a.response;
      const id=String(ctx.params.assessmentId||''), b=ctx.body;
      if(!validId(id)||!isRecord(b)||!Number.isInteger(b.expectedVersion)||!['open','submitted','locked','cancelled'].includes(String(b.action))) return error('A valid assessment, expectedVersion and lifecycle action are required.',400);
      const [old]=await db.get<Record<string,any>>(tenantTable('assessment_definitions',a.tenantId),[id],{consistent:true});
      if(!old||old.id!==id||old.tenantId!==a.tenantId||!['draft','open','submitted'].includes(old.status))return error('Assessment is unavailable or terminal.',404);
      if(!(await authorizeRecord(a.tenantId,a.membership,'assessment','update',old)))return error('Permission denied for this assessment.',403);
      const allowed:Record<string,string[]>={draft:['open','cancelled'],open:['submitted','cancelled'],submitted:['locked']};
      if(!allowed[old.status]?.includes(b.action))return error('Invalid assessment lifecycle transition.',409);
      if(b.expectedVersion!==old.version)return error('Assessment changed; reload before transition.',409);
      if(b.action==='open' && !(await assignmentExists(a.tenantId,old)))return error('The active teaching assignment is no longer valid.',409);
      const timestamp=now(), next={...old,status:b.action,version:Number(old.version)+1,updatedAt:timestamp,updatedBy:ctx.user.userId,
        ...(b.action==='submitted'?{submittedAt:timestamp,submittedBy:ctx.user.userId}:{}),
        ...(b.action==='locked'?{lockedAt:timestamp,lockedBy:ctx.user.userId}:{})};
      await db.transact([
        db.tx.update(tenantTable('assessment_definitions',a.tenantId),[{id,if:{version:old.version,status:old.status},record:next}]),
        db.tx.add(tenantTable('audit_events',a.tenantId),[auditRecord(a.tenantId,ctx.user.userId,'assessment-definition.'+b.action,id,{version:next.version})]),
        db.tx.add(tenantTable('domain_events',a.tenantId),[domainEvent(a.tenantId,ctx.user.userId,'assessment-definition.'+b.action,'assessment-definition',id,{version:next.version},crypto.randomUUID(),timestamp)]),
      ]);
      return json({item:next});
    } catch(e){return apiFailure(e,'Unable to change assessment lifecycle.',{logLabel:'assessment.lifecycle failed'});}
  }],
  'GET /api/grading/scales': [requireAuth(), async (ctx:any)=>{try{return await listScoped(ctx,'grading_scales','grade-scale');}catch(e){return apiFailure(e,'Unable to retrieve grading scales.');}}],
  'POST /api/grading/scales': [requireAuth(), async(ctx:any)=>{
    try{
      const a=await access(ctx);if(a.response)return a.response;const b=ctx.body;
      if(!isRecord(b)||Object.keys(b).some(k=>!['schoolId','code','name','appliesTo','effectiveFrom','effectiveUntil','bands'].includes(k)))return error('Submit only registered grading scale fields.',400);
      const code=cleanText(b.code,60),name=cleanText(b.name,120),appliesTo=b.appliesTo??'general';
      if(!validId(b.schoolId)||!code||!name||!['general','subject','examination','continuous_assessment'].includes(appliesTo)||
        !gradeBandsValid(b.bands)||(b.effectiveFrom&&!validDate(b.effectiveFrom))||(b.effectiveUntil&&!validDate(b.effectiveUntil))||
        (b.effectiveFrom&&b.effectiveUntil&&b.effectiveUntil<b.effectiveFrom))return error('Grading scale metadata, effective dates or grade bands are invalid. Bands must cover 0–100 without gaps or overlaps.',400);
      if(!hasSchoolScope(a.membership,b.schoolId)||!(await activeSchool(a.tenantId,b.schoolId)))return error('Choose an active authorised school.',403);
      if(!(await authorize(a.tenantId,a.membership,'grade-scale','create',{schoolId:b.schoolId})))return error('Permission denied for grading scales.',403);
      const existing=await completeBoundedList('grading_scales',a.tenantId);
      if(existing.some(x=>x.schoolId===b.schoolId&&x.code.toLowerCase()===code.toLowerCase()&&x.status!=='retired'))return error('A grading scale with this code already exists.',409);
      const timestamp=now(),record={id:crypto.randomUUID(),tenantId:a.tenantId,schoolId:b.schoolId,code,name,appliesTo,
        bands:(b.bands as any[]).map((x:any,i:number)=>({gradeCode:String(x.gradeCode).trim(),label:String(x.label).trim(),minimumScore:x.minimumScore,maximumScore:x.maximumScore,gradePoint:x.gradePoint??null,remark:x.remark??null,sequenceNo:i+1})),
        status:'draft',version:1,effectiveFrom:b.effectiveFrom||null,effectiveUntil:b.effectiveUntil||null,createdBy:ctx.user.userId,createdAt:timestamp,updatedAt:timestamp};
      await db.transact([
        db.tx.add(tenantTable('grading_scales',a.tenantId),[record]),
        db.tx.add(tenantTable('audit_events',a.tenantId),[auditRecord(a.tenantId,ctx.user.userId,'grading-scale.created','grading-scale',{schoolId:b.schoolId,code})]),
        db.tx.add(tenantTable('domain_events',a.tenantId),[domainEvent(a.tenantId,ctx.user.userId,'grading-scale.created','grading-scale',record.id,{schoolId:b.schoolId,code},crypto.randomUUID(),timestamp)]),
      ]);return json({item:record},201);
    }catch(e){return apiFailure(e,'Unable to create grading scale.',{logLabel:'grading-scale.create failed'});}
  }],
  'POST /api/grading/scales/:scaleId/lifecycle': [requireAuth(),async(ctx:any)=>{
    try{
      const a=await access(ctx);if(a.response)return a.response;const id=String(ctx.params.scaleId||''),b=ctx.body;
      if(!validId(id)||!isRecord(b)||!Number.isInteger(b.expectedVersion)||!['active','retired'].includes(String(b.action)))return error('A valid grading scale lifecycle request is required.',400);
      const [old]=await db.get<Record<string,any>>(tenantTable('grading_scales',a.tenantId),[id],{consistent:true});
      if(!old||old.id!==id||old.tenantId!==a.tenantId||old.status==='retired')return error('Grading scale not found or retired.',404);
      if(!(await authorizeRecord(a.tenantId,a.membership,'grade-scale','update',old)))return error('Permission denied for grading scale.',403);
      if(old.version!==b.expectedVersion||(b.action==='active'&&old.status!=='draft'))return error('Scale version or lifecycle state changed.',409);
      if(b.action==='active'&&(!gradeBandsValid(old.bands)|| (old.effectiveUntil&&old.effectiveUntil<now().slice(0,10))))return error('Scale is not valid for activation.',409);
      const timestamp=now(),next={...old,status:b.action,version:Number(old.version)+1,updatedAt:timestamp,updatedBy:ctx.user.userId};
      await db.transact([
        db.tx.update(tenantTable('grading_scales',a.tenantId),[{id,if:{version:old.version,status:old.status},record:next}]),
        db.tx.add(tenantTable('audit_events',a.tenantId),[auditRecord(a.tenantId,ctx.user.userId,'grading-scale.'+b.action,id,{version:next.version})]),
        db.tx.add(tenantTable('domain_events',a.tenantId),[domainEvent(a.tenantId,ctx.user.userId,'grading-scale.'+b.action,'grading-scale',id,{version:next.version},crypto.randomUUID(),timestamp)]),
      ]);return json({item:next});
    }catch(e){return apiFailure(e,'Unable to change grading scale lifecycle.');}
  }],
  'GET /api/examinations/sessions': [requireAuth(),async(ctx:any)=>{try{return await listScoped(ctx,'examination_sessions','examination');}catch(e){return apiFailure(e,'Unable to retrieve examination sessions.');}}],
  'POST /api/examinations/sessions': [requireAuth(),async(ctx:any)=>{
    try{
      const a=await access(ctx);if(a.response)return a.response;const b=ctx.body;
      if(!isRecord(b)||Object.keys(b).some(k=>!['schoolId','academicYearId','termId','name','examinationType','startsOn','endsOn'].includes(k))||
        ![b.schoolId,b.academicYearId].every(validId)||(b.termId&&!validId(b.termId))||!cleanText(b.name,160)||!EXAM_TYPES.includes(String(b.examinationType))||
        !validDate(b.startsOn)||!validDate(b.endsOn)||b.endsOn<b.startsOn)return error('Examination session details or dates are invalid.',400);
      if(!hasSchoolScope(a.membership,b.schoolId)||!(await activeSchool(a.tenantId,b.schoolId)))return error('Choose an active authorised school.',403);
      const year=await academicRecord(a.tenantId,b.schoolId,'academic_years',b.academicYearId);
      if(!year)return error('Academic year is not active in this school.',400);
      if(b.termId){const term=await academicRecord(a.tenantId,b.schoolId,'academic_terms',b.termId);if(!term||term.academicYearId!==b.academicYearId)return error('Term does not belong to the selected year.',400);}
      if(!(await authorize(a.tenantId,a.membership,'examination','create',{schoolId:b.schoolId,academicYearId:b.academicYearId,termId:b.termId||null})))return error('Permission denied for examination sessions.',403);
      const all=await completeBoundedList('examination_sessions',a.tenantId);
      if(all.some(x=>x.schoolId===b.schoolId&&x.academicYearId===b.academicYearId&&x.name.toLowerCase()===String(b.name).trim().toLowerCase()&&x.status!=='cancelled'))return error('An examination with this name already exists for the academic year.',409);
      const timestamp=now(),record={id:crypto.randomUUID(),tenantId:a.tenantId,schoolId:b.schoolId,academicYearId:b.academicYearId,termId:b.termId||null,name:String(b.name).trim(),examinationType:b.examinationType,startsOn:b.startsOn,endsOn:b.endsOn,status:'planned',publishedAt:null,lockedAt:null,createdBy:ctx.user.userId,version:1,createdAt:timestamp};
      await db.transact([
        db.tx.add(tenantTable('examination_sessions',a.tenantId),[record]),
        db.tx.add(tenantTable('audit_events',a.tenantId),[auditRecord(a.tenantId,ctx.user.userId,'examination-session.created','examination-session',{schoolId:b.schoolId,academicYearId:b.academicYearId})]),
        db.tx.add(tenantTable('domain_events',a.tenantId),[domainEvent(a.tenantId,ctx.user.userId,'examination-session.created','examination-session',record.id,{schoolId:b.schoolId},crypto.randomUUID(),timestamp)]),
      ]);return json({item:record},201);
    }catch(e){return apiFailure(e,'Unable to create examination session.');}
  }],
  'GET /api/examinations/papers': [requireAuth(),async(ctx:any)=>{try{return await listScoped(ctx,'examination_papers','examination');}catch(e){return apiFailure(e,'Unable to retrieve examination papers.');}}],
  'POST /api/examinations/papers': [requireAuth(),async(ctx:any)=>{
    try{
      const a=await access(ctx);if(a.response)return a.response;const b=ctx.body;
      if(!isRecord(b)||Object.keys(b).some(k=>!['schoolId','examinationId','classId','subjectId','paperCode','maximumScore','durationMinutes','scheduledAt','venue'].includes(k))||
        ![b.schoolId,b.examinationId,b.classId,b.subjectId].every(validId)||!cleanText(b.paperCode,60)||!Number.isFinite(b.maximumScore)||b.maximumScore<=0||
        (b.durationMinutes!=null&&(!Number.isInteger(b.durationMinutes)||b.durationMinutes<1||b.durationMinutes>600))||
        (b.scheduledAt!=null&&(typeof b.scheduledAt!=='string'||!Number.isFinite(Date.parse(b.scheduledAt)))))return error('Examination paper details are invalid.',400);
      const [session]=await db.get<Record<string,any>>(tenantTable('examination_sessions',a.tenantId),[b.examinationId],{consistent:true});
      if(!session||session.id!==b.examinationId||session.tenantId!==a.tenantId||session.schoolId!==b.schoolId||session.status!=='planned')return error('Papers can only be added to a planned examination in this school.',409);
      if(!hasSchoolScope(a.membership,b.schoolId)||!(await validateContext(a.tenantId,{schoolId:b.schoolId,classId:b.classId,subjectId:b.subjectId,academicYearId:session.academicYearId,termId:session.termId})))return error('Class or subject is not active in this school.',400);
      const context={schoolId:b.schoolId,classId:b.classId,subjectId:b.subjectId,academicYearId:session.academicYearId,termId:session.termId};
      if(!(await authorize(a.tenantId,a.membership,'examination','create',context))||!(await assignmentExists(a.tenantId,context)))return error('Permission denied or no active teaching assignment exists for this paper.',403);
      const timestamp=now(),record={id:crypto.randomUUID(),tenantId:a.tenantId,schoolId:b.schoolId,examinationId:b.examinationId,classId:b.classId,subjectId:b.subjectId,paperCode:String(b.paperCode).trim(),maximumScore:b.maximumScore,durationMinutes:b.durationMinutes??null,scheduledAt:b.scheduledAt??null,venue:cleanText(b.venue,120),status:'scheduled',createdAt:timestamp,createdBy:ctx.user.userId,version:1};
      await db.transact([
        db.tx.add(tenantTable('examination_papers',a.tenantId),[record]),
        db.tx.add(tenantTable('audit_events',a.tenantId),[auditRecord(a.tenantId,ctx.user.userId,'examination-paper.created','examination-paper',{schoolId:b.schoolId,examinationId:b.examinationId,classId:b.classId,subjectId:b.subjectId})]),
        db.tx.add(tenantTable('domain_events',a.tenantId),[domainEvent(a.tenantId,ctx.user.userId,'examination-paper.created','examination-paper',record.id,{schoolId:b.schoolId,examinationId:b.examinationId},crypto.randomUUID(),timestamp)]),
      ]);return json({item:record},201);
    }catch(e){return apiFailure(e,'Unable to create examination paper.');}
  }],
  'POST /api/examinations/sessions/:sessionId/lifecycle': [requireAuth(),async(ctx:any)=>{
    try{
      const a=await access(ctx);if(a.response)return a.response;const id=String(ctx.params.sessionId||''),b=ctx.body;
      if(!validId(id)||!isRecord(b)||!Number.isInteger(b.expectedVersion)||!['published','in_progress','completed','locked','cancelled'].includes(String(b.action)))return error('A valid examination lifecycle request is required.',400);
      const [old]=await db.get<Record<string,any>>(tenantTable('examination_sessions',a.tenantId),[id],{consistent:true});
      if(!old||old.id!==id||old.tenantId!==a.tenantId||['locked','cancelled'].includes(old.status))return error('Examination session not found or terminal.',404);
      if(!(await authorizeRecord(a.tenantId,a.membership,'examination','update',old)))return error('Permission denied for examination session.',403);
      const transitions:Record<string,string[]>={planned:['published','cancelled'],published:['in_progress','cancelled'],in_progress:['completed','cancelled'],completed:['locked']};
      if(!transitions[old.status]?.includes(b.action)||old.version!==b.expectedVersion)return error('Invalid transition or stale examination version.',409);
      if(b.action==='published'){
        const papers=await completeBoundedList('examination_papers',a.tenantId);
        if(!papers.some(x=>x.examinationId===id&&x.status!=='cancelled'))return error('Add at least one active paper before publishing the examination.',409);
      }
      const timestamp=now(),next={...old,status:b.action,version:Number(old.version)+1,updatedAt:timestamp,updatedBy:ctx.user.userId,
        ...(b.action==='published'?{publishedAt:timestamp}:{}),...(b.action==='locked'?{lockedAt:timestamp}:{})};
      await db.transact([
        db.tx.update(tenantTable('examination_sessions',a.tenantId),[{id,if:{version:old.version,status:old.status},record:next}]),
        db.tx.add(tenantTable('audit_events',a.tenantId),[auditRecord(a.tenantId,ctx.user.userId,'examination-session.'+b.action,id,{version:next.version})]),
        db.tx.add(tenantTable('domain_events',a.tenantId),[domainEvent(a.tenantId,ctx.user.userId,'examination-session.'+b.action,'examination-session',id,{version:next.version},crypto.randomUUID(),timestamp)]),
      ]);return json({item:next});
    }catch(e){return apiFailure(e,'Unable to change examination lifecycle.');}
  }],
  'GET /api/examinations/papers/:paperId/candidates': [requireAuth(),async(ctx:any)=>{
    try{
      const a=await access(ctx);if(a.response)return a.response;const id=String(ctx.params.paperId||'');
      if(!validId(id))return error('A valid paper ID is required.',400);
      const [paper]=await db.get<Record<string,any>>(tenantTable('examination_papers',a.tenantId),[id],{consistent:true});
      if(!paper||paper.id!==id||paper.tenantId!==a.tenantId)return error('Examination paper not found.',404);
      if(!(await authorizeRecord(a.tenantId,a.membership,'examination','read',paper)))return error('Permission denied for this paper.',403);
      const students=await completeBoundedList('students',a.tenantId);
      const items=students.filter(s=>s.schoolId===paper.schoolId&&s.classId===paper.classId&&s.status==='active')
        .map(s=>({studentId:s.id,studentNumber:s.studentNumber??null,firstName:s.firstName??null,lastName:s.lastName??null,sectionId:s.sectionId??null}));
      return json({items,count:items.length,source:'active school/class enrolment'});
    }catch(e){return apiFailure(e,'Unable to retrieve examination candidates.');}
  }],
  'POST /api/assessments/definitions/:assessmentId/scores': [requireAuth(),async(ctx:any)=>{
    try{
      const a=await access(ctx);if(a.response)return a.response;const id=String(ctx.params.assessmentId||''),b=ctx.body;
      if(!validId(id)||!isRecord(b)||!Array.isArray(b.scores)||b.scores.length<1||b.scores.length>100)return error('Submit 1–100 score entries for a valid assessment.',400);
      const [definition]=await db.get<Record<string,any>>(tenantTable('assessment_definitions',a.tenantId),[id],{consistent:true});
      if(!definition||definition.id!==id||definition.tenantId!==a.tenantId||definition.status!=='open')return error('Assessment is not open for score entry.',409);
      if(!(await authorizeRecord(a.tenantId,a.membership,'assessment','update',definition)))return error('Permission denied for score entry.',403);
      const seen=new Set<string>(),rows=[];
      const existing=await completeBoundedList('assessment_scores',a.tenantId);
      for(const raw of b.scores){
        if(!isRecord(raw)||!validId(raw.studentId)||seen.has(raw.studentId)||typeof raw.absent!=='boolean'||
          (!raw.absent&&(!validScore(raw.score)||raw.score>definition.maximumScore))||
          (raw.absent&&raw.score!==undefined&&raw.score!==null&&raw.score!==0)||
          (raw.comment!=null&&(typeof raw.comment!=='string'||raw.comment.length>500)))return error('Each score must have a unique student, valid score/absence state and comment.',400);
        seen.add(raw.studentId);
        const [student]=await db.get<Record<string,any>>(tenantTable('students',a.tenantId),[raw.studentId],{consistent:true});
        if(!student||student.id!==raw.studentId||student.tenantId!==a.tenantId||student.schoolId!==definition.schoolId||student.classId!==definition.classId||student.status!=='active'||(definition.sectionId&&student.sectionId!==definition.sectionId))return error('Every student must be actively enrolled in this assessment class and section.',400);
        if(existing.some(x=>x.assessmentId===id&&x.studentId===raw.studentId))return error('A score already exists for one or more students. Use the controlled correction workflow after moderation.',409);
        rows.push({id:crypto.randomUUID(),tenantId:a.tenantId,schoolId:definition.schoolId,assessmentId:id,studentId:student.id,score:raw.absent?0:raw.score,absent:raw.absent,comment:raw.comment??null,enteredBy:ctx.user.userId,enteredAt:now(),moderationStatus:'pending',moderatedBy:null,moderatedAt:null,version:1});
      }
      const timestamp=now();
      await db.transact([
        db.tx.add(tenantTable('assessment_scores',a.tenantId),rows),
        db.tx.add(tenantTable('audit_events',a.tenantId),[auditRecord(a.tenantId,ctx.user.userId,'assessment-scores.entered','assessment',{assessmentId:id,count:rows.length})]),
        db.tx.add(tenantTable('domain_events',a.tenantId),[domainEvent(a.tenantId,ctx.user.userId,'assessment-scores.entered','assessment',id,{count:rows.length},crypto.randomUUID(),timestamp)]),
      ]);return json({items:rows,count:rows.length},201);
    }catch(e){return apiFailure(e,'Unable to enter assessment scores.');}
  }],
  'POST /api/examinations/papers/:paperId/lifecycle': [requireAuth(),async(ctx:any)=>{
    try{
      const a=await access(ctx);if(a.response)return a.response;const id=String(ctx.params.paperId||''),b=ctx.body;
      if(!validId(id)||!isRecord(b)||!Number.isInteger(b.expectedVersion)||!['open','completed','cancelled'].includes(String(b.action)))return error('A valid paper lifecycle request is required.',400);
      const [old]=await db.get<Record<string,any>>(tenantTable('examination_papers',a.tenantId),[id],{consistent:true});
      if(!old||old.id!==id||old.tenantId!==a.tenantId||['completed','cancelled'].includes(old.status))return error('Paper not found or terminal.',404);
      if(!(await authorizeRecord(a.tenantId,a.membership,'examination','update',old)))return error('Permission denied for paper lifecycle.',403);
      const transitions:Record<string,string[]>={scheduled:['open','cancelled'],open:['completed','cancelled']};
      if(!transitions[old.status]?.includes(b.action)||old.version!==b.expectedVersion)return error('Invalid paper transition or stale version.',409);
      const timestamp=now(),next={...old,status:b.action,version:Number(old.version)+1,updatedAt:timestamp,updatedBy:ctx.user.userId};
      await db.transact([
        db.tx.update(tenantTable('examination_papers',a.tenantId),[{id,if:{version:old.version,status:old.status},record:next}]),
        db.tx.add(tenantTable('audit_events',a.tenantId),[auditRecord(a.tenantId,ctx.user.userId,'examination-paper.'+b.action,id,{version:next.version})]),
        db.tx.add(tenantTable('domain_events',a.tenantId),[domainEvent(a.tenantId,ctx.user.userId,'examination-paper.'+b.action,'examination-paper',id,{version:next.version},crypto.randomUUID(),timestamp)]),
      ]);return json({item:next});
    }catch(e){return apiFailure(e,'Unable to change paper lifecycle.');}
  }],
  'POST /api/examinations/papers/:paperId/scores': [requireAuth(),async(ctx:any)=>{
    try{
      const a=await access(ctx);if(a.response)return a.response;const id=String(ctx.params.paperId||''),b=ctx.body;
      if(!validId(id)||!isRecord(b)||!Array.isArray(b.scores)||b.scores.length<1||b.scores.length>100)return error('Submit 1–100 examination scores for a valid paper.',400);
      const [paper]=await db.get<Record<string,any>>(tenantTable('examination_papers',a.tenantId),[id],{consistent:true});
      if(!paper||paper.id!==id||paper.tenantId!==a.tenantId||!['open','completed'].includes(paper.status))return error('Paper is not open for score entry.',409);
      const [session]=await db.get<Record<string,any>>(tenantTable('examination_sessions',a.tenantId),[paper.examinationId],{consistent:true});
      if(!session||session.tenantId!==a.tenantId||!['in_progress','completed'].includes(session.status))return error('Examination session is not accepting scores.',409);
      if(!(await authorizeRecord(a.tenantId,a.membership,'examination','update',paper)))return error('Permission denied for examination scores.',403);
      const existing=await completeBoundedList('examination_results',a.tenantId),seen=new Set<string>(),rows=[];
      for(const raw of b.scores){
        if(!isRecord(raw)||!validId(raw.studentId)||seen.has(raw.studentId)||typeof raw.absent!=='boolean'||
          (!raw.absent&&(!validScore(raw.score)||raw.score>paper.maximumScore))||(raw.absent&&raw.score!==undefined&&raw.score!==null&&raw.score!==0))return error('Examination score entries are invalid.',400);
        seen.add(raw.studentId);
        const [student]=await db.get<Record<string,any>>(tenantTable('students',a.tenantId),[raw.studentId],{consistent:true});
        if(!student||student.tenantId!==a.tenantId||student.schoolId!==paper.schoolId||student.classId!==paper.classId||student.status!=='active')return error('Candidate is not actively enrolled in this paper class.',400);
        if(existing.some(x=>x.examinationPaperId===id&&x.studentId===raw.studentId))return error('A result already exists for one or more candidates.',409);
        rows.push({id:crypto.randomUUID(),tenantId:a.tenantId,schoolId:paper.schoolId,examinationPaperId:id,studentId:student.id,score:raw.absent?0:raw.score,absent:raw.absent,remark:raw.remark??null,enteredBy:ctx.user.userId,enteredAt:now(),moderationStatus:'pending',moderatedBy:null,moderatedAt:null,lockedAt:null,version:1});
      }
      const timestamp=now();
      await db.transact([
        db.tx.add(tenantTable('examination_results',a.tenantId),rows),
        db.tx.add(tenantTable('audit_events',a.tenantId),[auditRecord(a.tenantId,ctx.user.userId,'examination-scores.entered','examination-paper',{paperId:id,count:rows.length})]),
        db.tx.add(tenantTable('domain_events',a.tenantId),[domainEvent(a.tenantId,ctx.user.userId,'examination-scores.entered','examination-paper',id,{count:rows.length},crypto.randomUUID(),timestamp)]),
      ]);return json({items:rows,count:rows.length},201);
    }catch(e){return apiFailure(e,'Unable to enter examination scores.');}
  }],
  'GET /api/examinations/papers/:paperId/scores': [requireAuth(), async(ctx:any)=>{
    try {
      const a=await access(ctx); if(a.response)return a.response;
      const id=String(ctx.params.paperId||''), limit=pageSize(ctx.query.limit);
      if(!validId(id)||!limit)return error('A valid examination paper and page size are required.',400);
      const [paper]=await db.get<Record<string,any>>(tenantTable('examination_papers',a.tenantId),[id],{consistent:true});
      if(!paper||paper.tenantId!==a.tenantId)return error('Examination paper not found.',404);
      if(!(await authorizeRecord(a.tenantId,a.membership,'examination','read',paper)))return error('Permission denied for this paper.',403);
      const page=await db.list<Record<string,any>>(tenantTable('examination_results',a.tenantId),{limit,...(ctx.query.nextToken?{nextToken:ctx.query.nextToken}:{})});
      const items=[];
      for(const score of page.items){
        if(score.tenantId!==a.tenantId||score.examinationPaperId!==id)continue;
        if(!(await authorizeRecord(a.tenantId,a.membership,'examination','read',{...paper,...score})))continue;
        const [student]=await db.get<Record<string,any>>(tenantTable('students',a.tenantId),[score.studentId],{consistent:true});
        items.push({...score,student:student&&student.tenantId===a.tenantId?{studentNumber:student.studentNumber??null,firstName:student.firstName??null,lastName:student.lastName??null}:null});
      }
      return json({items,nextToken:page.nextToken||null,pageSize:limit});
    } catch(e){return apiFailure(e,'Unable to retrieve examination scores.');}
  }],
  'POST /api/examinations/results/:resultId/corrections': [requireAuth(), async(ctx:any)=>{
    try {
      const a=await access(ctx); if(a.response)return a.response;
      const id=String(ctx.params.resultId||''),b=ctx.body;
      if(!validId(id)||!isRecord(b)||!Number.isInteger(b.expectedVersion)||!validScore(b.proposedScore)||!cleanText(b.reason,500))return error('Provide a valid proposed examination score, reason and expectedVersion.',400);
      const [score]=await db.get<Record<string,any>>(tenantTable('examination_results',a.tenantId),[id],{consistent:true});
      if(!score||score.tenantId!==a.tenantId||!['approved','rejected'].includes(score.moderationStatus))return error('Only moderated examination scores can enter correction.',409);
      const [paper]=await db.get<Record<string,any>>(tenantTable('examination_papers',a.tenantId),[score.examinationPaperId],{consistent:true});
      if(!paper||paper.tenantId!==a.tenantId||paper.status!=='completed'||b.proposedScore>paper.maximumScore)return error('The completed parent paper and proposed score are invalid.',409);
      if(!(await authorizeRecord(a.tenantId,a.membership,'examination','update',paper)))return error('Permission denied for examination score correction.',403);
      if(score.version!==b.expectedVersion||score.enteredBy===ctx.user.userId&&score.moderatedBy===ctx.user.userId)return error('Stale score or maker-checker separation violated.',409);
      const prior=await db.list<Record<string,any>>(tenantTable('examination_score_corrections',a.tenantId),{limit:1000});
      if(prior.nextToken) return error('Correction queue exceeds the safe integrity-check page; narrow the review queue before retrying.',409);
      if(prior.items.some(x=>x.tenantId===a.tenantId&&x.scoreId===id&&x.status==='pending'))return error('A correction request is already pending for this examination score.',409);
      const timestamp=now(),record={id:crypto.randomUUID(),tenantId:a.tenantId,schoolId:score.schoolId,scoreId:id,examinationPaperId:score.examinationPaperId,studentId:score.studentId,originalScore:score.score,proposedScore:b.proposedScore,reason:String(b.reason).trim(),status:'pending',requestedBy:ctx.user.userId,requestedAt:timestamp,reviewedBy:null,reviewedAt:null,expectedScoreVersion:score.version,version:1};
      await db.transact([
        db.tx.add(tenantTable('examination_score_corrections',a.tenantId),[record]),
        db.tx.add(tenantTable('audit_events',a.tenantId),[auditRecord(a.tenantId,ctx.user.userId,'examination-score-correction.requested','examination-result',{scoreId:id,paperId:score.examinationPaperId})]),
        db.tx.add(tenantTable('domain_events',a.tenantId),[domainEvent(a.tenantId,ctx.user.userId,'examination-score-correction.requested','examination-score-correction',record.id,{scoreId:id,paperId:score.examinationPaperId},crypto.randomUUID(),timestamp)]),
      ]);
      return json({item:record},201);
    } catch(e){return apiFailure(e,'Unable to submit examination score correction.');}
  }],
  'GET /api/examinations/score-corrections': [requireAuth(),async(ctx:any)=>{try{return await listScoped(ctx,'examination_score_corrections','examination');}catch(e){return apiFailure(e,'Unable to retrieve examination score corrections.');}}],
  'POST /api/examinations/score-corrections/:correctionId/review': [requireAuth(),async(ctx:any)=>{
    try {
      const a=await access(ctx);if(a.response)return a.response;
      const id=String(ctx.params.correctionId||''),b=ctx.body;
      if(!validId(id)||!isRecord(b)||!Number.isInteger(b.expectedVersion)||!['approve','reject'].includes(String(b.decision)))return error('A valid examination correction review decision is required.',400);
      const [request]=await db.get<Record<string,any>>(tenantTable('examination_score_corrections',a.tenantId),[id],{consistent:true});
      if(!request||request.tenantId!==a.tenantId||request.status!=='pending')return error('Examination correction request is not pending.',404);
      const [score]=await db.get<Record<string,any>>(tenantTable('examination_results',a.tenantId),[request.scoreId],{consistent:true});
      const [paper]=await db.get<Record<string,any>>(tenantTable('examination_papers',a.tenantId),[request.examinationPaperId],{consistent:true});
      if(!score||!paper||score.tenantId!==a.tenantId||paper.tenantId!==a.tenantId||!(await authorizeRecord(a.tenantId,a.membership,'examination','moderate',paper)))return error('Permission denied for examination correction review.',403);
      if(request.version!==b.expectedVersion||score.version!==request.expectedScoreVersion||request.requestedBy===ctx.user.userId||score.enteredBy===ctx.user.userId)return error('Stale correction or maker-checker separation violated.',409);
      const timestamp=now(),nextRequest={...request,status:b.decision==='approve'?'approved':'rejected',reviewedBy:ctx.user.userId,reviewedAt:timestamp,version:Number(request.version)+1};
      const operations=[db.tx.update(tenantTable('examination_score_corrections',a.tenantId),[{id,if:{version:request.version,status:'pending'},record:nextRequest}])];
      if(b.decision==='approve')operations.push(db.tx.update(tenantTable('examination_results',a.tenantId),[{id:score.id,if:{version:score.version},record:{...score,score:request.proposedScore,moderationStatus:'approved',correctionCount:(score.correctionCount||0)+1,correctedBy:ctx.user.userId,correctedAt:timestamp,version:Number(score.version)+1}}]));
      operations.push(db.tx.add(tenantTable('audit_events',a.tenantId),[auditRecord(a.tenantId,ctx.user.userId,'examination-score-correction.'+b.decision,'examination-score-correction',{scoreId:score.id,correctionId:id})]));
      operations.push(db.tx.add(tenantTable('domain_events',a.tenantId),[domainEvent(a.tenantId,ctx.user.userId,'examination-score-correction.'+b.decision,'examination-score-correction',id,{scoreId:score.id},crypto.randomUUID(),timestamp)]));
      await db.transact(operations);return json({item:nextRequest});
    } catch(e){return apiFailure(e,'Unable to review examination score correction.');}
  }],
  'GET /api/assessments/definitions/:assessmentId/scores': [requireAuth(), async(ctx:any)=>{
    try{
      const a=await access(ctx);if(a.response)return a.response;const id=String(ctx.params.assessmentId||'');
      if(!validId(id))return error('A valid assessment ID is required.',400);
      const [definition]=await db.get<Record<string,any>>(tenantTable('assessment_definitions',a.tenantId),[id],{consistent:true});
      if(!definition||definition.tenantId!==a.tenantId)return error('Assessment not found.',404);
      if(!(await authorizeRecord(a.tenantId,a.membership,'assessment','read',definition)))return error('Permission denied.',403);
      const page=await db.list<Record<string,any>>(tenantTable('assessment_scores',a.tenantId),{limit:100,...(ctx.query.nextToken?{nextToken:ctx.query.nextToken}:{})});
      const students=await db.list<Record<string,any>>(tenantTable('students',a.tenantId),{limit:100});
      const names=new Map(students.items.filter(x=>x.tenantId===a.tenantId).map(x=>[x.id,x]));
      const items=page.items.filter(x=>x.tenantId===a.tenantId&&x.assessmentId===id).map(x=>({...x,student:names.get(x.studentId)?{studentNumber:names.get(x.studentId).studentNumber,firstName:names.get(x.studentId).firstName,lastName:names.get(x.studentId).lastName}:null}));
      return json({items,nextToken:page.nextToken||null});
    }catch(e){return apiFailure(e,'Unable to retrieve assessment scores.');}
  }],
  'GET /api/assessments/definitions/:assessmentId/candidates': [requireAuth(),async(ctx:any)=>{
    try{
      const a=await access(ctx);if(a.response)return a.response;const id=String(ctx.params.assessmentId||'');
      if(!validId(id))return error('A valid assessment ID is required.',400);
      const [definition]=await db.get<Record<string,any>>(tenantTable('assessment_definitions',a.tenantId),[id],{consistent:true});
      if(!definition||definition.tenantId!==a.tenantId)return error('Assessment not found.',404);
      if(!(await authorizeRecord(a.tenantId,a.membership,'assessment','read',definition)))return error('Permission denied.',403);
      const students=await completeBoundedList('students',a.tenantId);
      return json({items:students.filter(s=>s.schoolId===definition.schoolId&&s.classId===definition.classId&&s.status==='active'&&(!definition.sectionId||s.sectionId===definition.sectionId)).map(s=>({id:s.id,studentNumber:s.studentNumber,firstName:s.firstName,lastName:s.lastName}))});
    }catch(e){return apiFailure(e,'Unable to retrieve assessment candidates.');}
  }],
  'POST /api/assessments/scores/:scoreId/corrections': [requireAuth(),async(ctx:any)=>{
    try{
      const a=await access(ctx);if(a.response)return a.response;const id=String(ctx.params.scoreId||''),b=ctx.body;
      if(!validId(id)||!isRecord(b)||!Number.isInteger(b.expectedVersion)||!validScore(b.proposedScore)||!cleanText(b.reason,500))return error('Provide a valid proposed score, reason and expectedVersion.',400);
      const [score]=await db.get<Record<string,any>>(tenantTable('assessment_scores',a.tenantId),[id],{consistent:true});
      if(!score||score.tenantId!==a.tenantId||!['approved','rejected'].includes(score.moderationStatus))return error('Only moderated scores can enter correction.',409);
      const [parent]=await db.get<Record<string,any>>(tenantTable('assessment_definitions',a.tenantId),[score.assessmentId],{consistent:true});
      if(!parent||parent.tenantId!==a.tenantId||parent.status!=='locked'||b.proposedScore>parent.maximumScore)return error('The parent assessment must be locked and the proposed score within its maximum.',409);
      if(!(await authorizeRecord(a.tenantId,a.membership,'assessment','update',parent)))return error('Permission denied for score correction.',403);
      if(score.version!==b.expectedVersion||score.enteredBy===ctx.user.userId&&score.moderatedBy===ctx.user.userId)return error('Stale score or maker-checker separation violated.',409);
      const existing=await completeBoundedList('assessment_score_corrections',a.tenantId);
      if(existing.some(x=>x.scoreId===id&&x.status==='pending'))return error('A correction request is already pending for this score.',409);
      const timestamp=now(),record={id:crypto.randomUUID(),tenantId:a.tenantId,schoolId:score.schoolId,scoreId:id,assessmentId:score.assessmentId,originalScore:score.score,proposedScore:b.proposedScore,reason:String(b.reason).trim(),status:'pending',requestedBy:ctx.user.userId,requestedAt:timestamp,reviewedBy:null,reviewedAt:null,expectedScoreVersion:score.version,version:1};
      await db.transact([
        db.tx.add(tenantTable('assessment_score_corrections',a.tenantId),[record]),
        db.tx.add(tenantTable('audit_events',a.tenantId),[auditRecord(a.tenantId,ctx.user.userId,'assessment-score-correction.requested','assessment-score',{assessmentId:score.assessmentId,scoreId:id})]),
        db.tx.add(tenantTable('domain_events',a.tenantId),[domainEvent(a.tenantId,ctx.user.userId,'assessment-score-correction.requested','assessment-score-correction',record.id,{scoreId:id},crypto.randomUUID(),timestamp)]),
      ]);return json({item:record},201);
    }catch(e){return apiFailure(e,'Unable to submit score correction.');}
  }],
  'GET /api/assessments/score-corrections': [requireAuth(),async(ctx:any)=>{try{return await listScoped(ctx,'assessment_score_corrections','assessment');}catch(e){return apiFailure(e,'Unable to retrieve score correction requests.');}}],
  'POST /api/assessments/score-corrections/:correctionId/review': [requireAuth(),async(ctx:any)=>{
    try{
      const a=await access(ctx);if(a.response)return a.response;const id=String(ctx.params.correctionId||''),b=ctx.body;
      if(!validId(id)||!isRecord(b)||!Number.isInteger(b.expectedVersion)||!['approve','reject'].includes(String(b.decision)))return error('A valid correction review decision is required.',400);
      const [request]=await db.get<Record<string,any>>(tenantTable('assessment_score_corrections',a.tenantId),[id],{consistent:true});
      if(!request||request.tenantId!==a.tenantId||request.status!=='pending')return error('Correction request is not pending.',404);
      const [score]=await db.get<Record<string,any>>(tenantTable('assessment_scores',a.tenantId),[request.scoreId],{consistent:true});
      const [parent]=await db.get<Record<string,any>>(tenantTable('assessment_definitions',a.tenantId),[request.assessmentId],{consistent:true});
      if(!score||!parent||score.tenantId!==a.tenantId||parent.tenantId!==a.tenantId||!(await authorizeRecord(a.tenantId,a.membership,'assessment','moderate',parent)))return error('Permission denied for correction review.',403);
      if(request.version!==b.expectedVersion||score.version!==request.expectedScoreVersion||request.requestedBy===ctx.user.userId||score.enteredBy===ctx.user.userId)return error('Stale correction or maker-checker separation violated.',409);
      const timestamp=now(),nextRequest={...request,status:b.decision==='approve'?'approved':'rejected',reviewedBy:ctx.user.userId,reviewedAt:timestamp,version:Number(request.version)+1};
      const ops=[db.tx.update(tenantTable('assessment_score_corrections',a.tenantId),[{id,if:{version:request.version,status:'pending'},record:nextRequest}])];
      if(b.decision==='approve')ops.push(db.tx.update(tenantTable('assessment_scores',a.tenantId),[{id:score.id,if:{version:score.version},record:{...score,score:request.proposedScore,moderationStatus:'approved',correctionCount:(score.correctionCount||0)+1,correctedBy:ctx.user.userId,correctedAt:timestamp,version:Number(score.version)+1}}]));
      ops.push(db.tx.add(tenantTable('audit_events',a.tenantId),[auditRecord(a.tenantId,ctx.user.userId,'assessment-score-correction.'+b.decision,'assessment-score-correction',{scoreId:score.id,correctionId:id})]));
      ops.push(db.tx.add(tenantTable('domain_events',a.tenantId),[domainEvent(a.tenantId,ctx.user.userId,'assessment-score-correction.'+b.decision,'assessment-score-correction',id,{scoreId:score.id},crypto.randomUUID(),timestamp)]));
      await db.transact(ops);return json({item:nextRequest});
    }catch(e){return apiFailure(e,'Unable to review score correction.');}
  }],
  'GET /api/results/report-cards': [requireAuth(),async(ctx:any)=>{
    try{
      const a=await access(ctx);if(a.response)return a.response;const schoolId=String(ctx.query.schoolId||'');
      if(!validId(schoolId)||!hasSchoolScope(a.membership,schoolId)||!(await activeSchool(a.tenantId,schoolId)))return error('Choose an authorised active school.',403);
      const limit=pageSize(ctx.query.limit);if(!limit)return error('Invalid page size.',400);
      const page=await db.list<Record<string,any>>(tenantTable('student_report_cards',a.tenantId),{limit,...(ctx.query.nextToken?{nextToken:ctx.query.nextToken}:{})});
      const items=[];
      for(const item of page.items){
        if(item.tenantId!==a.tenantId||item.schoolId!==schoolId|| (ctx.query.classId&&item.classId!==ctx.query.classId) || (ctx.query.termId&&item.termId!==ctx.query.termId))continue;
        if(await authorizeRecord(a.tenantId,a.membership,'report-card','read',item))items.push(item);
      }
      return json({items,nextToken:page.nextToken||null,pageSize:limit});
    }catch(e){return apiFailure(e,'Unable to retrieve report cards.');}
  }],
  'POST /api/results/report-cards/generate': [requireAuth(),async(ctx:any)=>{
    try{
      const a=await access(ctx);if(a.response)return a.response;const b=ctx.body;
      if(!isRecord(b)||![b.schoolId,b.classId,b.academicYearId,b.termId].every(validId))return error('School, class, academic year and term are required.',400);
      const [schoolOk,klass,yearRecord,termRecord]=await Promise.all([activeSchool(a.tenantId,b.schoolId),academicRecord(a.tenantId,b.schoolId,'class_groups',b.classId),academicRecord(a.tenantId,b.schoolId,'academic_years',b.academicYearId),academicRecord(a.tenantId,b.schoolId,'academic_terms',b.termId)]);
      if(!hasSchoolScope(a.membership,b.schoolId)||!schoolOk||!klass||!yearRecord||!termRecord||termRecord.academicYearId!==b.academicYearId)return error('Academic scope is invalid or unauthorised.',403);
      if(!(await authorize(a.tenantId,a.membership,'report-card','create',{schoolId:b.schoolId,classId:b.classId})))return error('Permission denied for report generation.',403);
      const config=await completeBoundedList('platform_configurations',a.tenantId);
      const scaleMapping=config.find(x=>x.key==='assessment.gradingScaleBySchool')?.value || {};
      const configuredScale=scaleMapping[b.schoolId] || config.find(x=>x.key==='assessment.gradingScaleId')?.value;
      const scales=await completeBoundedList('grading_scales',a.tenantId);
      const scale=scales.find(x=>x.id===configuredScale&&x.schoolId===b.schoolId&&x.status==='active');
      if(!scale|| (scale.effectiveFrom&&scale.effectiveFrom>now().slice(0,10)) || (scale.effectiveUntil&&scale.effectiveUntil<now().slice(0,10)))return error('Select a currently effective active grading scale in central Assessment configuration before generating results.',409);
      const [year,term]=await Promise.all([academicRecord(a.tenantId,b.schoolId,'academic_years',b.academicYearId),academicRecord(a.tenantId,b.schoolId,'academic_terms',b.termId)]);
      if(!year||!term||term.academicYearId!==b.academicYearId)return error('Term and academic year do not match.',400);
      const [students,definitions,scores,papers,exams,examResults,existing]=await Promise.all([
        completeBoundedList('students',a.tenantId),completeBoundedList('assessment_definitions',a.tenantId),completeBoundedList('assessment_scores',a.tenantId),
        completeBoundedList('examination_papers',a.tenantId),completeBoundedList('examination_sessions',a.tenantId),completeBoundedList('examination_results',a.tenantId),completeBoundedList('student_report_cards',a.tenantId)
      ]);
      const classStudents=students.filter(x=>x.tenantId===a.tenantId&&x.schoolId===b.schoolId&&x.classId===b.classId&&x.status==='active'&&x.academicYearId===b.academicYearId);
      if(!classStudents.length||classStudents.length>100)return error('No active students found or class exceeds the 100-student generation batch. Use a queued batch job for larger cohorts.',409);
      const classDefs=definitions.filter(x=>x.schoolId===b.schoolId&&x.classId===b.classId&&x.academicYearId===b.academicYearId&&x.termId===b.termId&&x.status==='locked');
      const classExams=exams.filter(x=>x.schoolId===b.schoolId&&x.academicYearId===b.academicYearId&&x.termId===b.termId&&x.status==='locked');
      const usablePapers=papers.filter(x=>classExams.some(e=>e.id===x.examinationId)&&x.classId===b.classId&&x.status==='completed');
      if(!classDefs.length&&!usablePapers.length)return error('No locked assessments or completed examination papers exist for this class and term.',409);
      const scoreRows=scores.filter(x=>classDefs.some(d=>d.id===x.assessmentId));
      const examRows=examResults.filter(x=>usablePapers.some(p=>p.id===x.examinationPaperId));
      if(scoreRows.some(x=>x.moderationStatus==='pending')||examRows.some(x=>x.moderationStatus==='pending'))return error('Moderation is incomplete. Resolve all pending marks before result generation.',409);
      const bands=[...scale.bands].sort((x:any,y:any)=>Number(y.minimumScore)-Number(x.minimumScore));
      const weightingPolicy=config.find(x=>x.key==='assessment.weightingPolicy')?.value || {mode:'recorded_weights',assessmentWeight:70,examinationWeight:30};
      const assessmentFactor=weightingPolicy.mode==='category_weighted'?Number(weightingPolicy.assessmentWeight)/100:1;
      const examinationFactor=weightingPolicy.mode==='category_weighted'?Number(weightingPolicy.examinationWeight)/100:1;
      const records=classStudents.map(student=>{
        const bySubject=new Map<string,any>();
        for(const definition of classDefs){
          const score=scoreRows.find(x=>x.assessmentId===definition.id&&x.studentId===student.id&&x.moderationStatus==='approved');
          if(!score)continue;
          const item=bySubject.get(definition.subjectId)||{subjectId:definition.subjectId,weightedTotal:0,totalWeight:0,components:[]};
          const percentage=score.absent?0:Number(score.score)/Number(definition.maximumScore)*100,weight=Number(definition.weighting||1)*assessmentFactor;
          item.weightedTotal+=percentage*weight;item.totalWeight+=weight;item.components.push({type:'assessment',referenceId:definition.id,score:score.score,maximumScore:definition.maximumScore,weight,percentage});
          bySubject.set(definition.subjectId,item);
        }
        for(const paper of usablePapers){
          const score=examRows.find(x=>x.examinationPaperId===paper.id&&x.studentId===student.id&&x.moderationStatus==='approved');
          if(!score)continue;
          const item=bySubject.get(paper.subjectId)||{subjectId:paper.subjectId,weightedTotal:0,totalWeight:0,components:[]};
          const percentage=score.absent?0:Number(score.score)/Number(paper.maximumScore)*100,weight=Number(paper.weighting||1)*examinationFactor;
          item.weightedTotal+=percentage*weight;item.totalWeight+=weight;item.components.push({type:'examination',referenceId:paper.id,score:score.score,maximumScore:paper.maximumScore,weight,percentage});
          bySubject.set(paper.subjectId,item);
        }
        const subjectResults=Array.from(bySubject.values()).filter(x=>x.totalWeight>0).map(item=>{
          const percentage=Number((item.weightedTotal/item.totalWeight).toFixed(2)),grade=bands.find((x:any)=>percentage>=x.minimumScore&&percentage<=x.maximumScore);
          return {subjectId:item.subjectId,percentage,gradeCode:grade?.gradeCode||null,gradePoint:grade?.gradePoint??null,remark:grade?.remark??null,components:item.components};
        });
        const aggregate=subjectResults.length?Number((subjectResults.reduce((sum,x)=>sum+x.percentage,0)/subjectResults.length).toFixed(2)):null;
        const overallGrade=bands.find((x:any)=>aggregate!==null&&aggregate>=x.minimumScore&&aggregate<=x.maximumScore);
        const previous=existing.filter(x=>x.tenantId===a.tenantId&&x.schoolId===b.schoolId&&x.studentId===student.id&&x.academicYearId===b.academicYearId&&x.termId===b.termId).sort((x,y)=>Number(y.revision||1)-Number(x.revision||1))[0];
        return {id:crypto.randomUUID(),tenantId:a.tenantId,schoolId:b.schoolId,studentId:student.id,classId:b.classId,academicYearId:b.academicYearId,termId:b.termId,gradingScaleId:scale.id,subjectResults,aggregate,gradeCode:overallGrade?.gradeCode||null,gradePoint:overallGrade?.gradePoint??null,status:'draft',revision:previous?Number(previous.revision||1)+1:1,reissueOf:previous?.id||null,generatedBy:ctx.user.userId,generatedAt:now(),version:1};
      });
      if(records.some(x=>x.aggregate===null))return error('Some students have no moderated scores; complete all required marks before generating class results.',409);
      const priorCards=existing.filter(x=>x.tenantId===a.tenantId&&x.schoolId===b.schoolId&&x.classId===b.classId&&x.academicYearId===b.academicYearId&&x.termId===b.termId&&classStudents.some(s=>s.id===x.studentId));
      if(priorCards.some(x=>x.status!=='withdrawn'))return error('Existing report cards must be withdrawn before a new immutable revision can be generated.',409);
      for (const prior of priorCards) {
        if (!(await authorizeRecord(a.tenantId,a.membership,'report-card','update',prior))) return error('Permission denied for report-card regeneration.',403);
      }
      const timestamp=now();
      await db.transact([
        db.tx.add(tenantTable('student_report_cards',a.tenantId),records),
        db.tx.add(tenantTable('audit_events',a.tenantId),[auditRecord(a.tenantId,ctx.user.userId,'report-cards.generated','student-report-card',{schoolId:b.schoolId,classId:b.classId,termId:b.termId,count:records.length})]),
        db.tx.add(tenantTable('domain_events',a.tenantId),[domainEvent(a.tenantId,ctx.user.userId,'report-cards.generated','student-report-card',records[0].id,{schoolId:b.schoolId,classId:b.classId,termId:b.termId,count:records.length},crypto.randomUUID(),timestamp)]),
      ]);return json({items:records,count:records.length},201);
    }catch(e){return apiFailure(e,'Unable to generate results.',{logLabel:'results.generate failed'});}
  }],
  'POST /api/results/report-cards/:reportCardId/lifecycle': [requireAuth(),async(ctx:any)=>{
    try{
      const a=await access(ctx);if(a.response)return a.response;const id=String(ctx.params.reportCardId||''),b=ctx.body;
      if(!validId(id)||!isRecord(b)||!Number.isInteger(b.expectedVersion)||!['review','approve','publish','withdraw','withhold','release'].includes(String(b.action)))return error('A valid report lifecycle action is required.',400);
      if(b.action==='withhold'&&!cleanText(b.reason,500))return error('A reason is required to withhold a published report card.',400);
      const [old]=await db.get<Record<string,any>>(tenantTable('student_report_cards',a.tenantId),[id],{consistent:true});
      if(!old||old.tenantId!==a.tenantId)return error('Report card not found.',404);
      if(!(await authorizeRecord(a.tenantId,a.membership,'report-card','update',old)))return error('Permission denied.',403);
      const transitions:Record<string,string[]>={draft:['review','withdraw'],review:['approve','withdraw'],approved:['publish','withdraw'],published:['withhold'],withheld:['release']};
      if(old.version!==b.expectedVersion||!transitions[old.status]?.includes(b.action))return error('Invalid report lifecycle transition or stale version.',409);
      if(['approve','publish','withhold','release'].includes(b.action)&&old.generatedBy===ctx.user.userId)return error('Maker-checker separation requires another authorised reviewer.',409);
      if(b.action==='release'&&old.withheldBy===ctx.user.userId)return error('A different authorised officer must release a withheld report card.',409);
      if(b.action==='publish'){
        const config=await completeBoundedList('platform_configurations',a.tenantId);
        const setting=config.find(x=>x.key==='assessment.resultPublicationRequiresApproval');
        if(setting?.value!==false&&old.status!=='approved')return error('Result publication requires prior approval under central policy.',409);
      }
      const timestamp=now(),statusMap:Record<string,string>={review:'review',approve:'approved',publish:'published',withdraw:'withdrawn',withhold:'withheld',release:'published'};
      const next={...old,status:statusMap[b.action],version:Number(old.version)+1,updatedAt:timestamp,updatedBy:ctx.user.userId,
        ...(b.action==='approve'?{approvedBy:ctx.user.userId,approvedAt:timestamp}:{}),
        ...(b.action==='publish'?{publishedBy:ctx.user.userId,publishedAt:timestamp}:{}),
        ...(b.action==='withhold'?{withheldBy:ctx.user.userId,withheldAt:timestamp,withholdReason:String(b.reason).trim()}:{ }),
        ...(b.action==='release'?{releasedBy:ctx.user.userId,releasedAt:timestamp,releaseReason:cleanText(b.reason,500)||null}:{} )};
      await db.transact([
        db.tx.update(tenantTable('student_report_cards',a.tenantId),[{id,if:{version:old.version,status:old.status},record:next}]),
        db.tx.add(tenantTable('audit_events',a.tenantId),[auditRecord(a.tenantId,ctx.user.userId,'report-card.'+b.action,id,{version:next.version,studentId:old.studentId})]),
        db.tx.add(tenantTable('domain_events',a.tenantId),[domainEvent(a.tenantId,ctx.user.userId,'report-card.'+b.action,'student-report-card',id,{version:next.version,studentId:old.studentId},crypto.randomUUID(),timestamp)]),
      ]);return json({item:next});
    }catch(e){return apiFailure(e,'Unable to change report lifecycle.');}
  }],
  'GET /api/results/transcripts/:studentId': [requireAuth(),async(ctx:any)=>{
    try {
      const a=await access(ctx);if(a.response)return a.response;
      const studentId=String(ctx.params.studentId||''),limit=pageSize(ctx.query.limit);
      if(!validId(studentId)||!limit)return error('A valid student and page size are required.',400);
      const [student]=await db.get<Record<string,any>>(tenantTable('students',a.tenantId),[studentId],{consistent:true});
      if(!student||student.tenantId!==a.tenantId||!(await authorizeRecord(a.tenantId,a.membership,'student','read',student)))return error('Student transcript not found or access denied.',404);
      const page=await db.list<Record<string,any>>(tenantTable('student_report_cards',a.tenantId),{limit,...(ctx.query.nextToken?{nextToken:ctx.query.nextToken}:{})});
      const items=[];
      for(const item of page.items){
        if(item.tenantId!==a.tenantId||item.studentId!==studentId||item.status!=='published')continue;
        if(await authorizeRecord(a.tenantId,a.membership,'report-card','read',item))items.push(item);
      }
      return json({student:{id:student.id,studentNumber:student.studentNumber,firstName:student.firstName,lastName:student.lastName},items,nextToken:page.nextToken||null,pageSize:limit});
    } catch(e){return apiFailure(e,'Unable to retrieve the student transcript.');}
  }],
  'POST /api/assessments/scores/:scoreId/moderate': [requireAuth(),async(ctx:any)=>moderateScore(ctx,'assessment_scores','assessment-score','assessment')],
  'POST /api/examinations/results/:resultId/moderate': [requireAuth(),async(ctx:any)=>moderateScore(ctx,'examination_results','examination-result','examination')],
};

async function moderateScore(ctx:any,table:string,resource:string,parentResource:string) {
  try {
    const a=await access(ctx);if(a.response)return a.response;
    const id=String(ctx.params.scoreId||ctx.params.resultId||''),b=ctx.body;
    if(!validId(id)||!isRecord(b)||!Number.isInteger(b.expectedVersion)||!['approve','reject'].includes(String(b.decision))||
      (b.comment!=null&&(typeof b.comment!=='string'||b.comment.length>500)))return error('A valid moderation decision and expectedVersion are required.',400);
    const [old]=await db.get<Record<string,any>>(tenantTable(table,a.tenantId),[id],{consistent:true});
    if(!old||old.id!==id||old.tenantId!==a.tenantId||old.moderationStatus!=='pending')return error('Score is not awaiting moderation.',404);
    const parentId = table === 'assessment_scores' ? old.assessmentId : old.examinationPaperId;
    const parentTable = table === 'assessment_scores' ? 'assessment_definitions' : 'examination_papers';
    const [parent] = await db.get<Record<string,any>>(tenantTable(parentTable,a.tenantId),[parentId],{consistent:true});
    if(!parent || parent.tenantId !== a.tenantId || !(await authorizeRecord(a.tenantId,a.membership,parentResource,'moderate',parent)))return error('Permission denied for moderation.',403);
    if(old.version!==b.expectedVersion||old.enteredBy===ctx.user.userId)return error('Stale score or maker-checker separation violated.',409);
    const timestamp=now(),next={...old,moderationStatus:b.decision==='approve'?'approved':'rejected',moderationComment:b.comment??null,moderatedBy:ctx.user.userId,moderatedAt:timestamp,version:Number(old.version)+1};
    await db.transact([
      db.tx.update(tenantTable(table,a.tenantId),[{id,if:{version:old.version,moderationStatus:'pending'},record:next}]),
      db.tx.add(tenantTable('audit_events',a.tenantId),[auditRecord(a.tenantId,ctx.user.userId,resource+'.'+b.decision,id,{version:next.version})]),
      db.tx.add(tenantTable('domain_events',a.tenantId),[domainEvent(a.tenantId,ctx.user.userId,resource+'.'+b.decision,resource,id,{version:next.version},crypto.randomUUID(),timestamp)]),
    ]);return json({item:next});
  }catch(e){return apiFailure(e,'Unable to moderate score.',{logLabel:'academic-score.moderate failed'});}
}
