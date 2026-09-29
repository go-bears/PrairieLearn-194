import assert from 'node:assert';
import path from 'node:path';

import { TRPCError } from '@trpc/server';
import fs from 'fs-extra';
import { z } from 'zod';

import { throwAppError } from '@prairielearn/trpc/server';
import { IdSchema } from '@prairielearn/zod';

import { getAssessmentInfoJsonPath } from '../../lib/editorUtil.js';
import {
  type Editor,
  FileDeleteEditor,
  FileUploadEditor,
  MultiEditor,
  prepareJsonFileEditor,
} from '../../lib/editors.js';
import {
  builtInBackgroundPath,
  freehandQuestionFiles,
  listQuestionImages,
  readFreehandQuestion,
  sanitizeImageFileName,
} from '../../lib/freehand-question.js';
import {
  BUILT_IN_BACKGROUNDS,
  type BackgroundInput,
  BackgroundInputSchema,
  FreehandQuestionSchema,
  MAX_BACKGROUND_IMAGE_BYTES,
  ReferenceDrawingSchema,
} from '../../lib/freehand-question.shared.js';
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

export interface FreehandQuestionsError {
  Save: { code: 'SYNC_JOB_FAILED'; jobSequenceId: string };
  DeleteImage: { code: 'SYNC_JOB_FAILED'; jobSequenceId: string };
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

/** A live question in this course, and its directory. */
async function selectQuestionPath(ctx: TRPCContext, questionId: string) {
  const question = (
    await selectLiveQuestionsByIdsAndCourseId({
      question_ids: [questionId],
      course_id: ctx.course.id,
    })
  ).at(0);
  if (!question?.qid) throw new TRPCError({ code: 'NOT_FOUND', message: 'Question not found' });
  return { qid: question.qid, questionPath: path.join(ctx.course.path, 'questions', question.qid) };
}

/** Commits and syncs an edit, reporting a failed sync with a link to its job logs. */
async function runEditor(editor: Editor, failureMessage: string) {
  const serverJob = await editor.prepareServerJob();
  try {
    await editor.executeWithServerJob(serverJob);
  } catch {
    throwAppError<FreehandQuestionsError['Save'] | FreehandQuestionsError['DeleteImage']>({
      code: 'SYNC_JOB_FAILED',
      message: failureMessage,
      jobSequenceId: serverJob.jobSequenceId,
    });
  }
  return { jobSequenceId: serverJob.jobSequenceId };
}

const save = t.procedure
  .use(requireCoursePermissionEdit)
  .use(requireNotExampleCourse)
  .input(
    z.object({
      questionId: IdSchema,
      question: FreehandQuestionSchema.omit({ backgroundImage: true }),
      background: BackgroundInputSchema,
      reference: ReferenceDrawingSchema.nullable(),
      assessment: z
        .object({ assessmentId: IdSchema, points: z.number().positive().max(1000) })
        .nullable(),
    }),
  )
  .mutation(async ({ input, ctx }) => {
    const { qid, questionPath } = await selectQuestionPath(ctx, input.questionId);
    const { autograde } = input.question.grading;

    const { backgroundImage, image } = await resolveBackground(input.background, questionPath);
    if (autograde && input.question.grading.mode !== 'any-drawing' && !input.reference) {
      throw badRequest('Draw a reference answer to enable autograding.');
    }

    const { answersName } = await readFreehandQuestion(questionPath);
    const editors: Editor[] = [
      new FileUploadEditor({
        locals: ctx.locals,
        container: { rootPath: questionPath, invalidRootPaths: [] },
        files: await freehandQuestionFiles({
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
          qid,
          assessmentId,
          points: autograde ? { autoPoints: points } : { manualPoints: points },
        }),
      );
    }

    return runEditor(
      new MultiEditor(
        { locals: ctx.locals, description: `Edit freehand question ${qid}` },
        editors,
      ),
      'Failed to save the freehand question',
    );
  });

/** Deletes an unused background image from the question's `clientFilesQuestion/` folder. */
const deleteImage = t.procedure
  .use(requireCoursePermissionEdit)
  .use(requireNotExampleCourse)
  .input(z.object({ questionId: IdSchema, fileName: z.string().min(1) }))
  .mutation(async ({ input, ctx }) => {
    const { questionPath } = await selectQuestionPath(ctx, input.questionId);
    const { fileName } = input;
    if (!(await listQuestionImages(questionPath)).includes(fileName)) {
      throw badRequest(`"${fileName}" is not an image in this question's files.`);
    }
    if ((await readFreehandQuestion(questionPath)).question.backgroundImage === fileName) {
      throw badRequest(
        `"${fileName}" is the question's saved background. Choose another background and save before removing it.`,
      );
    }
    return runEditor(
      new FileDeleteEditor({
        locals: ctx.locals,
        container: { rootPath: questionPath, invalidRootPaths: [] },
        deletePath: path.join(questionPath, 'clientFilesQuestion', fileName),
      }),
      `Failed to delete ${fileName}`,
    );
  });

export const freehandQuestionsRouter = t.router({ save, deleteImage });
