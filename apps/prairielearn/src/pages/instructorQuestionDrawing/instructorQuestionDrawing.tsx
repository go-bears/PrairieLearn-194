import path from 'node:path';

import { Router } from 'express';

import * as error from '@prairielearn/error';
import { Hydrate } from '@prairielearn/react/server';
import { generatePrefixCsrfToken } from '@prairielearn/signed-token';

import { PageLayout } from '../../components/PageLayout.js';
import { coreElementAssetPath } from '../../lib/assets.js';
import { extractPageContext } from '../../lib/client/page-context.js';
import { getCourseTrpcUrl } from '../../lib/client/url.js';
import { config } from '../../lib/config.js';
import { readDrawingQuestion } from '../../lib/drawing-question.js';
import {
  BUILT_IN_BACKGROUNDS,
  BUILT_IN_BACKGROUND_IDS,
  type BuiltInBackgroundId,
} from '../../lib/drawing-question.shared.js';
import { typedAsyncHandler } from '../../lib/res-locals.js';
import { createAuthzMiddleware } from '../../middlewares/authzHelper.js';
import {
  selectAssessments,
  selectAssessmentsReferencingQuestions,
} from '../../models/assessment.js';
import { selectCourseInstancesWithStaffAccess } from '../../models/course-instances.js';

import {
  type AssessmentOption,
  DrawingQuestionEditor,
} from './components/DrawingQuestionEditor.js';

const router = Router();

router.get(
  '/',
  createAuthzMiddleware({
    oneOfPermissions: ['has_course_permission_edit'],
    unauthorizedUsers: 'block',
  }),
  typedAsyncHandler<'instructor-question'>(async (_req, res) => {
    const { course, authz_data: authzData } = extractPageContext(res.locals, {
      pageType: 'course',
      accessType: 'instructor',
    });
    const { question } = res.locals;
    if (question.course_id !== course.id || !question.qid) {
      throw new error.HttpStatusError(403, 'Access denied');
    }
    if (course.example_course) {
      throw new error.HttpStatusError(403, 'Cannot edit questions in the example course.');
    }

    const [state, courseInstances, referencing] = await Promise.all([
      readDrawingQuestion(path.join(course.path, 'questions', question.qid)),
      selectCourseInstancesWithStaffAccess({ course, authzData }),
      selectAssessmentsReferencingQuestions({ course_id: course.id, question_ids: [question.id] }),
    ]);
    const referencingIds = new Set(referencing.map((row) => row.assessment_id));
    const assessments: AssessmentOption[] = (
      await Promise.all(
        courseInstances.map(async (courseInstance) =>
          (await selectAssessments({ course_instance_id: courseInstance.id })).map(
            (assessment) => ({
              id: assessment.id,
              label: `${courseInstance.short_name}: ${assessment.label} ${assessment.title}`,
              containsQuestion: referencingIds.has(assessment.id),
            }),
          ),
        ),
      )
    ).flat();

    const builtInBackgroundUrls = Object.fromEntries(
      BUILT_IN_BACKGROUND_IDS.map((id) => [
        id,
        coreElementAssetPath(
          `pl-tablet-input/clientFilesElement/${BUILT_IN_BACKGROUNDS[id].fileName}`,
        ),
      ]),
    ) as Record<BuiltInBackgroundId, string>;

    const trpcCsrfToken = generatePrefixCsrfToken(
      { url: getCourseTrpcUrl(course.id), authn_user_id: res.locals.authn_user.id },
      config.secretKey,
    );

    res.send(
      PageLayout({
        resLocals: res.locals,
        pageTitle: 'Drawing question',
        navContext: { type: 'instructor', page: 'question', subPage: 'drawing' },
        headContent: (
          <>
            <link
              rel="stylesheet"
              href={coreElementAssetPath('pl-tablet-input/pl-tablet-input.css')}
            />
            <script src={coreElementAssetPath('pl-tablet-input/pl-tablet-input.js')} />
          </>
        ),
        options: { pageNote: question.qid },
        content: (
          <Hydrate>
            <DrawingQuestionEditor
              trpcCsrfToken={trpcCsrfToken}
              courseId={course.id}
              questionId={question.id}
              urlPrefix={res.locals.urlPrefix}
              initialQuestion={state.question}
              initialReference={state.reference}
              hasUnmanagedContent={state.hasUnmanagedContent}
              assessments={assessments}
              builtInBackgroundUrls={builtInBackgroundUrls}
            />
          </Hydrate>
        ),
      }),
    );
  }),
);

export default router;
