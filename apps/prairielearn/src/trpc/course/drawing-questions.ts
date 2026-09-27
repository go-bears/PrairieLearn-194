import assert from 'node:assert';
import path from 'node:path';

import { TRPCError } from '@trpc/server';
import fs from 'fs-extra';
import { z } from 'zod';

import { throwAppError } from '@prairielearn/trpc/server';
import { IdSchema } from '@prairielearn/zod';

import {
  builtInBackgroundPath,
  drawingQuestionFiles,
  readDrawingQuestion,
  sanitizeImageFileName,
} from '../../lib/drawing-question.js';
import {
  BUILT_IN_BACKGROUNDS,
  type BackgroundInput,
  BackgroundInputSchema,
  DrawingQuestionSchema,
  MAX_BACKGROUND_IMAGE_BYTES,
  ReferenceDrawingSchema,
} from '../../lib/drawing-question.shared.js';
import { getAssessmentInfoJsonPath } from '../../lib/editorUtil.js';
import {
  type Editor,
  FileUploadEditor,
  MultiEditor,
  prepareJsonFileEditor,
} from '../../lib/editors.js';
import { type QuestionPoints, setQuestionPoints } from '../../lib/infoAssessment-edits.js';
import { selectOptionalAssessmentInCourse } from '../../models/assessment.js';
import { selectLiveQuestionsByIdsAndCourseId } from '../../models/question.js';
import type { AssessmentJsonInput } from '../../schemas/infoAssessment.js';

import {
  type TRPCContext,
  requireCoursePermissionEdit,
  requireNotExampleCourse,
  t,
} from './init.js';

export interface DrawingQuestionsError {
  Save: { code: 'SYNC_JOB_FAILED'; jobSequenceId: string };
}

const badRequest = (message: string) => new TRPCError({ code: 'BAD_REQUEST', message });

async function prepareAssessmentPointsEditor({
  ctx,
  qid,
  assessmentId,
  points,
}: {
  ctx: TRPCContext;
  qid: string;
  assessmentId: string;
  points: QuestionPoints;
}): Promise<Editor> {
  const found = await selectOptionalAssessmentInCourse({
    assessment_id: assessmentId,
    course_id: ctx.course.id,
  });
  if (!found) throw badRequest('Invalid assessment');

  const prepared = await prepareJsonFileEditor<AssessmentJsonInput>({
    applyChanges: (json) => setQuestionPoints(json, qid, points).assessment,
    jsonPath: getAssessmentInfoJsonPath({
      course: ctx.course,
      course_instance: found.course_instance,
      assessment: found.assessment,
    }),
    conflictCheck: { origHash: null, scope: (json) => json.zones ?? [] },
    locals: ctx.locals,
    container: { rootPath: ctx.course.path, invalidRootPaths: [] },
  });
  // Without an `origHash` there is no conflict check, so preparation always succeeds.
  assert(prepared.success);
  return prepared.editor;
}

/** The background's file name in `clientFilesQuestion/`, and its contents if it must be written. */
async function resolveBackground(
  background: BackgroundInput,
  questionPath: string,
): Promise<{
  backgroundImage: string | null;
  image: { fileName: string; contents: Buffer } | null;
}> {
  switch (background.kind) {
    case 'none':
      return { backgroundImage: null, image: null };
    case 'builtIn': {
      const { fileName } = BUILT_IN_BACKGROUNDS[background.id];
      const contents = await fs.readFile(builtInBackgroundPath(background.id));
      return { backgroundImage: fileName, image: { fileName, contents } };
    }
    case 'existing': {
      const { fileName } = background;
      const exists =
        path.basename(fileName) === fileName &&
        (await fs.pathExists(path.join(questionPath, 'clientFilesQuestion', fileName)));
      if (!exists) throw badRequest(`The background image "${fileName}" no longer exists.`);
      return { backgroundImage: fileName, image: null };
    }
    case 'upload': {
      const fileName = sanitizeImageFileName(background.name);
      const contents = Buffer.from(background.contentBase64, 'base64');
      if (contents.length > MAX_BACKGROUND_IMAGE_BYTES) {
        throw badRequest('The background image is too large.');
      }
      return { backgroundImage: fileName, image: { fileName, contents } };
    }
  }
}

const save = t.procedure
  .use(requireCoursePermissionEdit)
  .use(requireNotExampleCourse)
  .input(
    z.object({
      questionId: IdSchema,
      question: DrawingQuestionSchema.omit({ backgroundImage: true }),
      background: BackgroundInputSchema,
      reference: ReferenceDrawingSchema.nullable(),
      assessment: z
        .object({ assessmentId: IdSchema, points: z.number().positive().max(1000) })
        .nullable(),
    }),
  )
  .mutation(async ({ input, ctx }) => {
    const question = (
      await selectLiveQuestionsByIdsAndCourseId({
        question_ids: [input.questionId],
        course_id: ctx.course.id,
      })
    ).at(0);
    if (!question?.qid) throw new TRPCError({ code: 'NOT_FOUND', message: 'Question not found' });
    const questionPath = path.join(ctx.course.path, 'questions', question.qid);
    const { autograde } = input.question.grading;

    const { backgroundImage, image } = await resolveBackground(input.background, questionPath);
    if (autograde && !input.reference) {
      throw badRequest('Draw a reference answer to enable autograding.');
    }

    const { answersName } = await readDrawingQuestion(questionPath);
    const editors: Editor[] = [
      new FileUploadEditor({
        locals: ctx.locals,
        container: { rootPath: questionPath, invalidRootPaths: [] },
        files: await drawingQuestionFiles({
          questionPath,
          question: { ...input.question, backgroundImage },
          answersName,
          reference: input.reference,
          image,
        }),
      }),
    ];
    if (input.assessment) {
      const { assessmentId, points } = input.assessment;
      editors.push(
        await prepareAssessmentPointsEditor({
          ctx,
          qid: question.qid,
          assessmentId,
          points: autograde ? { autoPoints: points } : { manualPoints: points },
        }),
      );
    }

    const editor = new MultiEditor(
      { locals: ctx.locals, description: `Edit drawing question ${question.qid}` },
      editors,
    );
    const serverJob = await editor.prepareServerJob();
    try {
      await editor.executeWithServerJob(serverJob);
    } catch {
      throwAppError<DrawingQuestionsError['Save']>({
        code: 'SYNC_JOB_FAILED',
        message: 'Failed to save the drawing question',
        jobSequenceId: serverJob.jobSequenceId,
      });
    }
    return { jobSequenceId: serverJob.jobSequenceId };
  });

export const drawingQuestionsRouter = t.router({ save });
