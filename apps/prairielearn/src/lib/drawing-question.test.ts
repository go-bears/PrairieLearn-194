import os from 'node:os';
import path from 'node:path';

import fs from 'fs-extra';
import { afterEach, assert, beforeEach, describe, it } from 'vitest';

import {
  drawingQuestionFiles,
  parseDrawingQuestionHtml,
  readDrawingQuestion,
  renderDrawingQuestionHtml,
  sanitizeImageFileName,
} from './drawing-question.js';
import { DEFAULT_DRAWING_QUESTION, type DrawingQuestion } from './drawing-question.shared.js';

const QUESTION: DrawingQuestion = {
  prompt: 'Graph $y = 2x - 1$.\n\nUse the grid.',
  canvas: { width: 487, height: 442 },
  backgroundImage: 'plane.png',
  telemetry: true,
  grading: {
    autograde: true,
    mode: 'function',
    tolerance: 10,
    passThreshold: 0.9,
    partialCredit: false,
  },
};

const REFERENCE = { version: 1 as const, strokes: [{ points: [{ x: 0.1, y: 0.2 }] }] };

describe('renderDrawingQuestionHtml', () => {
  it('round-trips through parseDrawingQuestionHtml', () => {
    const html = renderDrawingQuestionHtml({
      question: QUESTION,
      answersName: 'graph',
      hasReference: true,
    });
    const parsed = parseDrawingQuestionHtml(html, { autograde: true });
    assert.deepEqual(parsed, {
      answersName: 'graph',
      referenceFile: 'reference.json',
      hasOtherContent: false,
      question: QUESTION,
    });
  });

  it('omits grading attributes for manually graded questions', () => {
    const html = renderDrawingQuestionHtml({
      question: {
        ...QUESTION,
        backgroundImage: null,
        grading: { ...QUESTION.grading, autograde: false },
      },
      answersName: 'drawing',
      hasReference: false,
    });
    assert.notInclude(html, 'tolerance');
    assert.notInclude(html, 'background');
    assert.notInclude(html, 'reference-file');
  });

  it('escapes attribute values', () => {
    const html = renderDrawingQuestionHtml({
      question: QUESTION,
      answersName: 'a"b',
      hasReference: false,
    });
    assert.include(html, 'answers-name="a&quot;b"');
  });
});

describe('parseDrawingQuestionHtml', () => {
  it('uses element defaults and falls back to the panel HTML as the prompt', () => {
    const parsed = parseDrawingQuestionHtml(
      '<pl-question-panel><p>Draw a circle.</p></pl-question-panel>\n<pl-tablet-input answers-name="x"></pl-tablet-input>',
      { autograde: false },
    );
    assert.isNotNull(parsed);
    assert.equal(parsed.question.prompt, '<p>Draw a circle.</p>');
    assert.deepEqual(parsed.question.canvas, DEFAULT_DRAWING_QUESTION.canvas);
    assert.isFalse(parsed.question.telemetry);
    assert.isFalse(parsed.hasOtherContent);
  });

  it('flags content the builder does not manage', () => {
    const parsed = parseDrawingQuestionHtml(
      '<pl-tablet-input answers-name="x"></pl-tablet-input><pl-number-input answers-name="y"></pl-number-input>',
      { autograde: true },
    );
    assert.isNotNull(parsed);
    assert.isTrue(parsed.hasOtherContent);
  });

  it('returns null without exactly one pl-tablet-input', () => {
    assert.isNull(parseDrawingQuestionHtml('<p>Hello</p>', { autograde: true }));
  });
});

describe('sanitizeImageFileName', () => {
  it('keeps a safe base name', () => {
    assert.equal(sanitizeImageFileName('../My Graph (1).png'), 'My_Graph_1_.png');
    assert.equal(sanitizeImageFileName('...'), 'background');
  });
});

describe('question files', () => {
  let questionPath: string;

  beforeEach(async () => {
    questionPath = await fs.mkdtemp(path.join(os.tmpdir(), 'drawing-question-'));
    await fs.writeJson(path.join(questionPath, 'info.json'), { uuid: 'u', title: 'T', topic: 'X' });
  });

  afterEach(async () => {
    await fs.remove(questionPath);
  });

  it('reads back what it writes', async () => {
    const files = await drawingQuestionFiles({
      questionPath,
      question: QUESTION,
      answersName: 'graph',
      reference: REFERENCE,
      image: { fileName: 'plane.png', contents: Buffer.from([1, 2, 3]) },
    });
    for (const [filePath, contents] of Object.entries(files)) {
      await fs.outputFile(filePath, contents);
    }

    assert.deepEqual(await readDrawingQuestion(questionPath), {
      question: QUESTION,
      answersName: 'graph',
      reference: REFERENCE,
      hasUnmanagedContent: false,
    });
    assert.equal(
      (await fs.readJson(path.join(questionPath, 'info.json'))).gradingMethod,
      'Internal',
    );
    assert.deepEqual(
      [...(await fs.readFile(path.join(questionPath, 'clientFilesQuestion', 'plane.png')))],
      [1, 2, 3],
    );
  });

  it('drops undone strokes from a raw pl-tablet-input answer used as the reference', async () => {
    await fs.writeFile(
      path.join(questionPath, 'question.html'),
      '<pl-tablet-input answers-name="x" reference-file="ref.json"></pl-tablet-input>',
    );
    await fs.writeJson(path.join(questionPath, 'ref.json'), {
      version: 1,
      strokes: [
        { undone: true, points: [{ x: 0.5, y: 0.5, dt: 1 }] },
        { points: [{ x: 0.1, y: 0.2, p: 0.3 }] },
      ],
    });
    assert.deepEqual((await readDrawingQuestion(questionPath)).reference, REFERENCE);
  });

  it('defaults a new question and flags existing unrelated content', async () => {
    await fs.writeFile(path.join(questionPath, 'question.html'), '<p>Old question</p>');
    const state = await readDrawingQuestion(questionPath);
    assert.deepEqual(state.question, DEFAULT_DRAWING_QUESTION);
    assert.isTrue(state.hasUnmanagedContent);
  });
});
