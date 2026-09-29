import os from 'node:os';
import path from 'node:path';

import fs from 'fs-extra';
import { afterEach, assert, beforeEach, describe, it } from 'vitest';

import {
  builtInBackgroundPath,
  freehandQuestionFiles,
  parseFreehandQuestionHtml,
  readFreehandQuestion,
  renderFreehandQuestionHtml,
  sanitizeImageFileName,
} from './freehand-question.js';
import {
  BUILT_IN_BACKGROUND_IDS,
  DEFAULT_FREEHAND_QUESTION,
  ELEMENT_DEFAULT_CANVAS,
  type FreehandQuestion,
  builtInBackgroundForFile,
} from './freehand-question.shared.js';

const QUESTION: FreehandQuestion = {
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

describe('renderFreehandQuestionHtml', () => {
  it('round-trips through parseFreehandQuestionHtml', () => {
    const html = renderFreehandQuestionHtml({
      question: QUESTION,
      answersName: 'graph',
      hasReference: true,
    });
    const parsed = parseFreehandQuestionHtml(html, { autograde: true });
    assert.deepEqual(parsed, {
      answersName: 'graph',
      referenceFile: 'reference.json',
      hasOtherContent: false,
      question: QUESTION,
    });
  });

  it('omits grading attributes for manually graded questions', () => {
    const html = renderFreehandQuestionHtml({
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
    const html = renderFreehandQuestionHtml({
      question: QUESTION,
      answersName: 'a"b',
      hasReference: false,
    });
    assert.include(html, 'answers-name="a&quot;b"');
  });
});

describe('parseFreehandQuestionHtml', () => {
  it('uses element defaults and falls back to the panel HTML as the prompt', () => {
    const parsed = parseFreehandQuestionHtml(
      '<pl-question-panel><p>Draw a circle.</p></pl-question-panel>\n<pl-tablet-input answers-name="x"></pl-tablet-input>',
      { autograde: false },
    );
    assert.isNotNull(parsed);
    assert.equal(parsed.question.prompt, '<p>Draw a circle.</p>');
    assert.deepEqual(parsed.question.canvas, ELEMENT_DEFAULT_CANVAS);
    assert.isFalse(parsed.question.telemetry);
    assert.isFalse(parsed.hasOtherContent);
  });

  it('flags content the builder does not manage', () => {
    const parsed = parseFreehandQuestionHtml(
      '<pl-tablet-input answers-name="x"></pl-tablet-input><pl-number-input answers-name="y"></pl-number-input>',
      { autograde: true },
    );
    assert.isNotNull(parsed);
    assert.isTrue(parsed.hasOtherContent);
  });

  it('returns null without exactly one pl-tablet-input', () => {
    assert.isNull(parseFreehandQuestionHtml('<p>Hello</p>', { autograde: true }));
  });
});

describe('built-in backgrounds', () => {
  it('ship with pl-tablet-input and are recognized by file name', async () => {
    for (const id of BUILT_IN_BACKGROUND_IDS) {
      assert.isTrue(await fs.pathExists(builtInBackgroundPath(id)));
      assert.equal(builtInBackgroundForFile(path.basename(builtInBackgroundPath(id))), id);
    }
    assert.isNull(builtInBackgroundForFile('my-plane.png'));
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
    questionPath = await fs.mkdtemp(path.join(os.tmpdir(), 'freehand-question-'));
    await fs.writeJson(path.join(questionPath, 'info.json'), { uuid: 'u', title: 'T', topic: 'X' });
  });

  afterEach(async () => {
    await fs.remove(questionPath);
  });

  it('reads back what it writes', async () => {
    const files = await freehandQuestionFiles({
      questionPath,
      question: QUESTION,
      answersName: 'graph',
      reference: REFERENCE,
      image: { fileName: 'plane.png', contents: Buffer.from([1, 2, 3]) },
    });
    for (const [filePath, contents] of Object.entries(files)) {
      await fs.outputFile(filePath, contents);
    }

    assert.deepEqual(await readFreehandQuestion(questionPath), {
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
    assert.deepEqual((await readFreehandQuestion(questionPath)).reference, REFERENCE);
  });

  it('defaults a new question and flags existing unrelated content', async () => {
    await fs.writeFile(path.join(questionPath, 'question.html'), '<p>Old question</p>');
    const state = await readFreehandQuestion(questionPath);
    assert.deepEqual(state.question, DEFAULT_FREEHAND_QUESTION);
    assert.isTrue(state.hasUnmanagedContent);
  });
});
