// @ts-nocheck -- imported School Hub source, kept as-is
import { db, error, json, requireAuth } from '@/server/appdeploy-sdk';
import {
  apiFailure, auditRecord, authorize, authorizeRecord, domainEvent, hasSchoolScope,
  isRecord, isValidRecordId, tenantAccessFromRequest, tenantTable,
} from './platform';
import { activeSchool, academicRecord } from './academic-operations';

const validId = isValidRecordId;
const now = () => new Date().toISOString();
const pageSize = (value: unknown) => {
  const n = value === undefined ? 50 : Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : null;
};
const cleanText = (value: unknown, max: number) => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 && text.length <= max ? text : null;
};
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
async function completeList(table: string, tenantId: string) {
  const page = await db.list<Record<string, any>>(tenantTable(table, tenantId), { limit: 1000 });
  if (page.nextToken) throw new Error('This integrity check exceeds the supported bounded page. Narrow the query before retrying.');
  return page.items.filter(item => item.tenantId === tenantId);
}
async function validateTeachingContext(tenantId: string, input: any, teacherUserId: string) {
  if (!(await activeSchool(tenantId, input.schoolId))) return false;
  const [klass, subject, year] = await Promise.all([
    academicRecord(tenantId, input.schoolId, 'class_groups', input.classId),
    academicRecord(tenantId, input.schoolId, 'subjects', input.subjectId),
    academicRecord(tenantId, input.schoolId, 'academic_years', input.academicYearId),
  ]);
  if (!klass || !subject || !year) return false;
  if (input.sectionId) {
    const section = await academicRecord(tenantId, input.schoolId, 'sections', input.sectionId);
    if (!section || section.classId !== input.classId) return false;
  }
  if (input.termId) {
    const term = await academicRecord(tenantId, input.schoolId, 'academic_terms', input.termId);
    if (!term || term.academicYearId !== input.academicYearId) return false;
  }
  const assignments = await completeList('teaching_assignments', tenantId);
  return assignments.some(item => item.status === 'active' && item.schoolId === input.schoolId &&
    item.teacherUserId === teacherUserId && item.classId === input.classId &&
    item.subjectId === input.subjectId && item.academicYearId === input.academicYearId &&
    (!input.termId || !item.termId || item.termId === input.termId));
}
async function listScoped(ctx: any, table: string, resource: string) {
  const a = await access(ctx);
  if (a.response) return a.response;
  const schoolId = String(ctx.query.schoolId || '');
  const limit = pageSize(ctx.query.limit);
  if (!validId(schoolId) || !limit || !(await activeSchool(a.tenantId, schoolId))) return error('Choose an active school and page size from 1 to 100.', 400);
  if (!hasSchoolScope(a.membership, schoolId)) return error('This school is outside your authorised scope.', 403);
  const page = await db.list<Record<string, any>>(tenantTable(table, a.tenantId), {
    limit, ...(ctx.query.nextToken ? { nextToken: ctx.query.nextToken } : {}),
  });
  const items = [];
  for (const item of page.items) {
    if (item.tenantId !== a.tenantId || item.schoolId !== schoolId) continue;
    if (ctx.query.classId && item.classId !== ctx.query.classId) continue;
    if (ctx.query.subjectId && item.subjectId !== ctx.query.subjectId) continue;
    if (ctx.query.status && item.status !== ctx.query.status) continue;
    if (await authorizeRecord(a.tenantId, a.membership, resource, 'read', item)) items.push(item);
  }
  return json({ items, nextToken: page.nextToken || null, pageSize: limit });
}
export const learningRoutes = {
  'GET /api/learning/lessons': [requireAuth(), async (ctx: any) => {
    try { return await listScoped(ctx, 'lesson_plans', 'lesson'); }
    catch (cause) { return apiFailure(cause, 'Unable to retrieve lesson plans.', { logLabel: 'learning.lessons.list failed' }); }
  }],
  'POST /api/learning/lessons': [requireAuth(), async (ctx: any) => {
    try {
      const a = await access(ctx); if (a.response) return a.response;
      const b = ctx.body;
      const allowed = ['schoolId','classId','sectionId','subjectId','academicYearId','termId','title','learningObjectives','content','plannedFor','status'];
      if (!isRecord(b) || Object.keys(b).some(key => !allowed.includes(key))) return error('Submit only the supported lesson-plan fields.', 400);
      const title = cleanText(b.title, 160);
      const objectives = cleanText(b.learningObjectives, 2000);
      const content = b.content == null ? '' : (typeof b.content === 'string' && b.content.length <= 12000 ? b.content.trim() : null);
      if (![b.schoolId,b.classId,b.subjectId,b.academicYearId].every(validId) ||
        (b.sectionId != null && !validId(b.sectionId)) || (b.termId != null && !validId(b.termId)) ||
        !title || !objectives || content === null || (b.plannedFor != null && (typeof b.plannedFor !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(b.plannedFor)))) return error('Lesson details or academic references are invalid.', 400);
      const input = { schoolId:b.schoolId, classId:b.classId, sectionId:b.sectionId || null, subjectId:b.subjectId, academicYearId:b.academicYearId, termId:b.termId || null };
      if (!hasSchoolScope(a.membership, input.schoolId) || !(await validateTeachingContext(a.tenantId, input, ctx.user.userId))) return error('An active teaching assignment and compatible academic references are required.', 409);
      if (!(await authorize(a.tenantId, a.membership, 'lesson', 'create', input))) return error('Permission denied for lesson planning.', 403);
      const record = { id:crypto.randomUUID(), tenantId:a.tenantId, ...input, teacherUserId:ctx.user.userId, title, learningObjectives:objectives, content, plannedFor:b.plannedFor || null, status:'planned', version:1, createdAt:now(), createdBy:ctx.user.userId, updatedAt:now(), updatedBy:ctx.user.userId };
      if (!(await authorizeRecord(a.tenantId, a.membership, 'lesson', 'create', record))) return error('Permission denied for this lesson scope.', 403);
      const timestamp = now();
      await db.transact([
        db.tx.add(tenantTable('lesson_plans',a.tenantId),[record]),
        db.tx.add(tenantTable('audit_events',a.tenantId),[auditRecord(a.tenantId,ctx.user.userId,'lesson-plan.created',record.id,{schoolId:record.schoolId,classId:record.classId,subjectId:record.subjectId})]),
        db.tx.add(tenantTable('domain_events',a.tenantId),[domainEvent(a.tenantId,ctx.user.userId,'lesson-plan.created','lesson-plan',record.id,{schoolId:record.schoolId,classId:record.classId,subjectId:record.subjectId},crypto.randomUUID(),timestamp)]),
      ]);
      return json({ item:record },201);
    } catch (cause) { return apiFailure(cause, 'Unable to create lesson plan.', { logLabel:'learning.lessons.create failed' }); }
  }],
  'GET /api/learning/assignments': [requireAuth(), async (ctx: any) => {
    try { return await listScoped(ctx, 'learning_assignments', 'learning-assignment'); }
    catch (cause) { return apiFailure(cause, 'Unable to retrieve learning assignments.', { logLabel:'learning.assignments.list failed' }); }
  }],
  'POST /api/learning/assignments': [requireAuth(), async (ctx: any) => {
    try {
      const a = await access(ctx); if (a.response) return a.response;
      const b = ctx.body;
      const allowed = ['schoolId','classId','sectionId','subjectId','academicYearId','termId','lessonId','assessmentId','title','instructions','dueAt','maximumScore'];
      if (!isRecord(b) || Object.keys(b).some(key => !allowed.includes(key))) return error('Submit only the supported assignment fields.',400);
      const title = cleanText(b.title,160), instructions = cleanText(b.instructions,8000);
      if (![b.schoolId,b.classId,b.subjectId,b.academicYearId].every(validId) ||
        (b.sectionId != null && !validId(b.sectionId)) || (b.termId != null && !validId(b.termId)) ||
        (b.lessonId != null && !validId(b.lessonId)) || (b.assessmentId != null && !validId(b.assessmentId)) ||
        !title || !instructions || (b.dueAt != null && (typeof b.dueAt !== 'string' || Number.isNaN(Date.parse(b.dueAt)))) ||
        (b.maximumScore != null && (!Number.isFinite(b.maximumScore) || b.maximumScore <= 0 || b.maximumScore > 10000))) return error('Assignment details or academic references are invalid.',400);
      const input = {schoolId:b.schoolId,classId:b.classId,sectionId:b.sectionId||null,subjectId:b.subjectId,academicYearId:b.academicYearId,termId:b.termId||null};
      if (!hasSchoolScope(a.membership,input.schoolId) || !(await validateTeachingContext(a.tenantId,input,ctx.user.userId))) return error('An active teaching assignment and compatible academic references are required.',409);
      if (!(await authorize(a.tenantId,a.membership,'learning-assignment','create',input))) return error('Permission denied for assignment creation.',403);
      if (b.lessonId) {
        const [lesson] = await db.get<Record<string,any>>(tenantTable('lesson_plans',a.tenantId),[b.lessonId],{consistent:true});
        if (!lesson || lesson.tenantId!==a.tenantId || lesson.schoolId!==input.schoolId || lesson.classId!==input.classId || lesson.subjectId!==input.subjectId || lesson.academicYearId!==input.academicYearId || (input.termId && lesson.termId && lesson.termId!==input.termId) || lesson.status==='archived') return error('The linked lesson is not available in this class and subject.',409);
      }
      if (b.assessmentId) {
        const [assessment] = await db.get<Record<string,any>>(tenantTable('assessment_definitions',a.tenantId),[b.assessmentId],{consistent:true});
        if (!assessment || assessment.tenantId!==a.tenantId || assessment.schoolId!==input.schoolId || assessment.classId!==input.classId || assessment.subjectId!==input.subjectId || assessment.academicYearId!==input.academicYearId || (input.termId && assessment.termId && assessment.termId!==input.termId) || assessment.status==='archived') return error('The linked assessment does not match this assignment context.',409);
      }
      const record = {id:crypto.randomUUID(),tenantId:a.tenantId,...input,teacherUserId:ctx.user.userId,lessonId:b.lessonId||null,assessmentId:b.assessmentId||null,title,instructions,dueAt:b.dueAt||null,maximumScore:b.maximumScore??null,status:'published',version:1,createdAt:now(),createdBy:ctx.user.userId,updatedAt:now(),updatedBy:ctx.user.userId};
      if (!(await authorizeRecord(a.tenantId,a.membership,'learning-assignment','create',record))) return error('Permission denied for this assignment scope.',403);
      const timestamp=now();
      await db.transact([
        db.tx.add(tenantTable('learning_assignments',a.tenantId),[record]),
        db.tx.add(tenantTable('audit_events',a.tenantId),[auditRecord(a.tenantId,ctx.user.userId,'learning-assignment.created',record.id,{schoolId:record.schoolId,classId:record.classId,subjectId:record.subjectId,lessonId:record.lessonId,assessmentId:record.assessmentId})]),
        db.tx.add(tenantTable('domain_events',a.tenantId),[domainEvent(a.tenantId,ctx.user.userId,'learning-assignment.created','learning-assignment',record.id,{schoolId:record.schoolId,classId:record.classId,subjectId:record.subjectId},crypto.randomUUID(),timestamp)]),
      ]);
      return json({item:record},201);
    } catch (cause) { return apiFailure(cause,'Unable to create learning assignment.',{logLabel:'learning.assignments.create failed'}); }
  }],
  'GET /api/learning/assignments/:assignmentId/submissions': [requireAuth(), async (ctx:any) => {
    try {
      const a=await access(ctx); if(a.response)return a.response;
      const id=String(ctx.params.assignmentId||''); if(!validId(id))return error('Invalid assignment identifier.',400);
      const [assignment]=await db.get<Record<string,any>>(tenantTable('learning_assignments',a.tenantId),[id],{consistent:true});
      if(!assignment||assignment.tenantId!==a.tenantId)return error('Assignment not found.',404);
      if(!hasSchoolScope(a.membership,assignment.schoolId)||!(await authorizeRecord(a.tenantId,a.membership,'learning-assignment','read',assignment)))return error('Permission denied for this assignment.',403);
      const page=await db.list<Record<string,any>>(tenantTable('assignment_submissions',a.tenantId),{limit:100,...(ctx.query.nextToken?{nextToken:ctx.query.nextToken}:{})});
      const items=[];
      for(const item of page.items) if(item.tenantId===a.tenantId&&item.assignmentId===id&&await authorizeRecord(a.tenantId,a.membership,'assignment-submission','read',{...item,schoolId:assignment.schoolId,classId:assignment.classId,subjectId:assignment.subjectId,academicYearId:assignment.academicYearId,termId:assignment.termId})) items.push(item);
      return json({items,nextToken:page.nextToken||null,pageSize:100});
    } catch(cause){return apiFailure(cause,'Unable to retrieve assignment submissions.',{logLabel:'learning.submissions.list failed'});}
  }],
  'POST /api/learning/assignments/:assignmentId/submissions': [requireAuth(), async (ctx:any) => {
    try {
      const a=await access(ctx); if(a.response)return a.response;
      const id=String(ctx.params.assignmentId||''),b=ctx.body;
      if(!validId(id)||!isRecord(b)||Object.keys(b).some(key=>!['studentId','responseText','attachmentRefs'].includes(key)))return error('Provide a valid assignment and submission.',400);
      if(!validId(b.studentId))return error('Select an enrolled student.',400);
      const [assignment]=await db.get<Record<string,any>>(tenantTable('learning_assignments',a.tenantId),[id],{consistent:true});
      if(!assignment||assignment.tenantId!==a.tenantId||assignment.status!=='published')return error('Published assignment not found.',404);
      if(!hasSchoolScope(a.membership,assignment.schoolId))return error('This school is outside your authorised scope.',403);
      const [student]=await db.get<Record<string,any>>(tenantTable('students',a.tenantId),[b.studentId],{consistent:true});
      if(!student||student.tenantId!==a.tenantId||student.schoolId!==assignment.schoolId||student.classId!==assignment.classId||student.status!=='active'||(assignment.sectionId&&student.sectionId!==assignment.sectionId))return error('The student is not actively enrolled in this assignment class and section.',409);
      const responseText=cleanText(b.responseText,12000);
      const refs=b.attachmentRefs===undefined?[]:b.attachmentRefs;
      if(responseText===null||!Array.isArray(refs)||refs.length>10||refs.some((ref:any)=>typeof ref!=='string'||ref.length>300))return error('Submission text or attachment references are invalid.',400);
      if(!(await authorize(a.tenantId,a.membership,'assignment-submission','create',{schoolId:assignment.schoolId,classId:assignment.classId,subjectId:assignment.subjectId,academicYearId:assignment.academicYearId,termId:assignment.termId})))return error('Permission denied for assignment submission.',403);
      if(!(await authorizeRecord(a.tenantId,a.membership,'assignment-submission','create',{...student,schoolId:assignment.schoolId,classId:assignment.classId,subjectId:assignment.subjectId,academicYearId:assignment.academicYearId,termId:assignment.termId})))return error('Permission denied for this student submission.',403);
      const submissionId=id+'_'+student.id;
      const record={id:submissionId,tenantId:a.tenantId,schoolId:assignment.schoolId,assignmentId:id,studentId:student.id,responseText,attachmentRefs:refs,status:'submitted',submittedAt:now(),submittedBy:ctx.user.userId,reviewedBy:null,reviewedAt:null,feedback:null,score:null,version:1};
      const timestamp=now();
      await db.transact([
        db.tx.add(tenantTable('assignment_submissions',a.tenantId),[record]),
        db.tx.add(tenantTable('audit_events',a.tenantId),[auditRecord(a.tenantId,ctx.user.userId,'assignment-submission.created',submissionId,{schoolId:assignment.schoolId,assignmentId:id,studentId:student.id})]),
        db.tx.add(tenantTable('domain_events',a.tenantId),[domainEvent(a.tenantId,ctx.user.userId,'assignment-submission.created','assignment-submission',submissionId,{schoolId:assignment.schoolId,assignmentId:id,studentId:student.id},crypto.randomUUID(),timestamp)]),
      ]);
      return json({item:record},201);
    }catch(cause){return apiFailure(cause,'Unable to record assignment submission.',{logLabel:'learning.submissions.create failed'});}
  }],
  'PUT /api/learning/assignments/:assignmentId/submissions/:submissionId/review': [requireAuth(), async (ctx:any) => {
    try {
      const a=await access(ctx); if(a.response)return a.response;
      const assignmentId=String(ctx.params.assignmentId||''),id=String(ctx.params.submissionId||''),b=ctx.body;
      if(!validId(assignmentId)||!validId(id)||!isRecord(b)||!Number.isInteger(b.expectedVersion)||!['reviewed','returned'].includes(String(b.status)))return error('Provide a valid review status and expected version.',400);
      const [assignment]=await db.get<Record<string,any>>(tenantTable('learning_assignments',a.tenantId),[assignmentId],{consistent:true});
      const [old]=await db.get<Record<string,any>>(tenantTable('assignment_submissions',a.tenantId),[id],{consistent:true});
      if(!assignment||assignment.tenantId!==a.tenantId||!old||old.tenantId!==a.tenantId||old.assignmentId!==assignmentId)return error('Assignment submission not found.',404);
      const scope={schoolId:assignment.schoolId,classId:assignment.classId,subjectId:assignment.subjectId,academicYearId:assignment.academicYearId,termId:assignment.termId};
      if(!hasSchoolScope(a.membership,assignment.schoolId)||!(await authorizeRecord(a.tenantId,a.membership,'assignment-submission','update',{...old,...scope})))return error('Permission denied to review this submission.',403);
      if(old.status!=='submitted'||old.version!==b.expectedVersion)return error('Submission changed or is no longer awaiting review.',409);
      const feedback=b.feedback==null?'':cleanText(b.feedback,2000);
      if(feedback===null||(b.score!=null&&(!Number.isFinite(b.score)||b.score<0||(assignment.maximumScore!=null&&b.score>assignment.maximumScore))))return error('Feedback or score is invalid.',400);
      const next={...old,status:b.status,feedback,score:b.score??null,reviewedBy:ctx.user.userId,reviewedAt:now(),version:old.version+1};
      const timestamp=now();
      await db.transact([
        db.tx.update(tenantTable('assignment_submissions',a.tenantId),[{id,if:{version:old.version,status:'submitted'},record:next}]),
        db.tx.add(tenantTable('audit_events',a.tenantId),[auditRecord(a.tenantId,ctx.user.userId,'assignment-submission.reviewed',id,{assignmentId,studentId:old.studentId,status:next.status,score:next.score})]),
        db.tx.add(tenantTable('domain_events',a.tenantId),[domainEvent(a.tenantId,ctx.user.userId,'assignment-submission.reviewed','assignment-submission',id,{assignmentId,status:next.status},crypto.randomUUID(),timestamp)]),
      ]);
      return json({item:next});
    }catch(cause){return apiFailure(cause,'Unable to review assignment submission.',{logLabel:'learning.submissions.review failed'});}
  }],
};
