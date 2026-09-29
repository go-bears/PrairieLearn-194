import * as path from 'path';

import { TRPCClientError } from '@trpc/client';
import fs from 'fs-extra';
import { afterAll, assert, beforeAll, describe, test } from 'vitest';

import { generatePrefixCsrfToken } from '@prairielearn/signed-token';

import { config } from '../lib/config.js';
import { builtInBackgroundPath } from '../lib/freehand-question.js';
import { DEFAULT_FREEHAND_QUESTION } from '../lib/freehand-question.shared.js';
import { TEST_COURSE_PATH } from '../lib/paths.js';
import { selectAssessmentByTid } from '../models/assessment.js';
import { selectQuestionByQid } from '../models/question.js';
import { createCourseTrpcClient } from '../trpc/course/client.js';

import {
  type CourseRepoFixture,
  createCourseRepoFixture,
  updateCourseRepository,
} from './helperCourse.js';
import * as helperServer from './helperServer.js';

const siteUrl = `http://localhost:${config.serverPort}`;
const QID = 'addVectors';
const REFERENCE = {
  version: 1 as const,
  strokes: [
    {
      points: [
        { x: 0.1, y: 0.9 },
        { x: 0.9, y: 0.1 },
      ],
    },
  ],
};
const QUESTION = {
  prompt: 'Draw the line $y = x$.',
  canvas: DEFAULT_FREEHAND_QUESTION.canvas,
  telemetry: true,
  grading: { ...DEFAULT_FREEHAND_QUESTION.grading, mode: 'function' as const },
};

function createTrpcClient() {
  const csrfToken = generatePrefixCsrfToken(
    { url: '/pl/course/1/trpc', authn_user_id: '1' },
    config.secretKey,
  );
  return createCourseTrpcClient({ csrfToken, courseId: '1', urlBase: siteUrl });
}

describe('Freehand question builder', { concurrent: false }, () => {
  let courseRepo: CourseRepoFixture;
  let questionId: string;
  const questionPath = () => path.join(courseRepo.courseLiveDir, 'questions', QID);

  beforeAll(async () => {
    courseRepo = await createCourseRepoFixture(TEST_COURSE_PATH);
    await helperServer.before(courseRepo.courseLiveDir)();
    await updateCourseRepository({ courseId: '1', repository: courseRepo.courseOriginDir });
    questionId = (await selectQuestionByQid({ qid: QID, course_id: '1' })).id;
  });

  afterAll(helperServer.after);

  test('renders the builder for course editors', async () => {
    const response = await fetch(`${siteUrl}/pl/course/1/question/${questionId}/freehand`);
    assert.equal(response.status, 200);
    assert.include(await response.text(), 'Reference drawing canvas');
  });

  test('saves the question files and assessment points in one sync', async () => {
    const assessment = await selectAssessmentByTid({
      course_instance_id: '1',
      tid: 'hw16-editorTest',
    });

    await createTrpcClient().freehandQuestions.save.mutate({
      questionId,
      question: QUESTION,
      reference: REFERENCE,
      background: {
        kind: 'upload',
        name: 'my grid.png',
        type: 'image/png',
        contentBase64: Buffer.from('not really a png').toString('base64'),
      },
      assessment: { assessmentId: assessment.id, points: 4 },
    });

    const html = await fs.readFile(path.join(questionPath(), 'question.html'), 'utf8');
    assert.include(html, 'Draw the line $y = x$.');
    assert.include(html, 'background-image="my_grid.png"');
    assert.include(html, 'grading="function"');
    assert.deepEqual(await fs.readJson(path.join(questionPath(), 'reference.json')), REFERENCE);
    assert.equal(
      await fs.readFile(path.join(questionPath(), 'clientFilesQuestion', 'my_grid.png'), 'utf8'),
      'not really a png',
    );
    assert.equal(
      (await fs.readJson(path.join(questionPath(), 'info.json'))).gradingMethod,
      'Internal',
    );

    const assessmentInfo = await fs.readJson(
      path.join(
        courseRepo.courseLiveDir,
        'courseInstances',
        'Sp15',
        'assessments',
        'hw16-editorTest',
        'infoAssessment.json',
      ),
    );
    // The question was already in this assessment with `autoPoints: 2, maxAutoPoints: 11`.
    assert.deepInclude(
      assessmentInfo.zones.flatMap((zone: { questions: object[] }) => zone.questions),
      { id: QID, autoPoints: 4 },
    );

    const synced = await selectQuestionByQid({ qid: QID, course_id: '1' });
    assert.equal(synced.grading_method, 'Internal');
  });

  test('keeps an existing custom background image', async () => {
    await createTrpcClient().freehandQuestions.save.mutate({
      questionId,
      question: { ...QUESTION, grading: { ...QUESTION.grading, autograde: false } },
      background: { kind: 'existing', fileName: 'my_grid.png' },
      reference: REFERENCE,
      assessment: null,
    });
    const html = await fs.readFile(path.join(questionPath(), 'question.html'), 'utf8');
    assert.include(html, 'background-image="my_grid.png"');
    assert.notInclude(html, 'grading=');
    assert.equal(
      (await fs.readJson(path.join(questionPath(), 'info.json'))).gradingMethod,
      'Manual',
    );
  });

  test('copies a built-in grid into the question', async () => {
    await createTrpcClient().freehandQuestions.save.mutate({
      questionId,
      question: QUESTION,
      background: { kind: 'builtIn', id: 'grid-axes' },
      reference: REFERENCE,
      assessment: null,
    });
    const html = await fs.readFile(path.join(questionPath(), 'question.html'), 'utf8');
    assert.include(html, 'background-image="grid-axes.png"');
    assert.deepEqual(
      await fs.readFile(path.join(questionPath(), 'clientFilesQuestion', 'grid-axes.png')),
      await fs.readFile(builtInBackgroundPath('grid-axes')),
    );
  });

  test('rejects autograding without a reference drawing', async () => {
    const error = await createTrpcClient()
      .freehandQuestions.save.mutate({
        questionId,
        question: QUESTION,
        background: { kind: 'none' },
        reference: null,
        assessment: null,
      })
      .catch((err: unknown) => err);
    assert.instanceOf(error, TRPCClientError);
    assert.equal(error.data?.code, 'BAD_REQUEST');
  });

  test.each(['missing.png', '../info.json'])(
    'rejects an existing background image that is not in clientFilesQuestion: %s',
    async (fileName) => {
      const error = await createTrpcClient()
        .freehandQuestions.save.mutate({
          questionId,
          question: QUESTION,
          background: { kind: 'existing', fileName },
          reference: REFERENCE,
          assessment: null,
        })
        .catch((err: unknown) => err);
      assert.instanceOf(error, TRPCClientError);
      assert.include(error.message, fileName);
    },
  );
});
