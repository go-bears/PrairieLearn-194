import path from 'node:path';

import * as cheerio from 'cheerio';
import fs from 'fs-extra';
import { z } from 'zod';

import {
  DEFAULT_DRAWING_QUESTION,
  type DrawingQuestion,
  REFERENCE_FILE_NAME,
  type ReferenceDrawing,
  ReferenceDrawingSchema,
} from './drawing-question.shared.js';
import { formatJsonWithPrettier } from './prettier.js';

const DEFAULT_ANSWERS_NAME = 'drawing';
const TRUE_VALUES = new Set(['true', 't', '1', 'yes', 'y', 'on']);
const MARKDOWN_PROMPT =
  /<pl-question-panel>\s*<markdown>([\s\S]*?)<\/markdown>\s*<\/pl-question-panel>/;

interface DrawingQuestionState {
  question: DrawingQuestion;
  answersName: string;
  reference: ReferenceDrawing | null;
  /** Whether `question.html` has content the builder would overwrite on save. */
  hasUnmanagedContent: boolean;
}

const escapeAttribute = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

export function renderDrawingQuestionHtml({
  question,
  answersName,
  hasReference,
}: {
  question: DrawingQuestion;
  answersName: string;
  hasReference: boolean;
}): string {
  const { canvas, backgroundImage, grading } = question;
  const attributes: Record<string, string | number | boolean | null> = {
    'answers-name': answersName,
    width: canvas.width,
    height: canvas.height,
    telemetry: question.telemetry,
    'background-image': backgroundImage,
    'background-fit': backgroundImage ? 'stretch' : null,
    'reference-file': hasReference ? REFERENCE_FILE_NAME : null,
    ...(grading.autograde && {
      grading: grading.mode,
      tolerance: grading.tolerance,
      'pass-threshold': grading.passThreshold,
      'partial-credit': grading.partialCredit,
    }),
  };

  return [
    '<pl-question-panel>',
    '  <markdown>',
    question.prompt.trim(),
    '  </markdown>',
    '</pl-question-panel>',
    '',
    '<pl-tablet-input',
    ...Object.entries(attributes)
      .filter(([, value]) => value !== null)
      .map(([name, value]) => `  ${name}="${escapeAttribute(String(value))}"`),
    '></pl-tablet-input>',
    '',
  ].join('\n');
}

/** Reads builder settings back out of `question.html`; null if it has no single `pl-tablet-input`. */
export function parseDrawingQuestionHtml(html: string, { autograde }: { autograde: boolean }) {
  const $ = cheerio.load(html, null, false);
  const element = $('pl-tablet-input');
  if (element.length !== 1) return null;

  const number = (name: string, fallback: number) => {
    const value = Number(element.attr(name));
    return element.attr(name) !== undefined && Number.isFinite(value) ? value : fallback;
  };
  const flag = (name: string, fallback: boolean) => {
    const value = element.attr(name);
    return value === undefined ? fallback : TRUE_VALUES.has(value.trim().toLowerCase());
  };
  const defaults = DEFAULT_DRAWING_QUESTION;
  const panel = $('pl-question-panel');

  return {
    answersName: element.attr('answers-name') ?? DEFAULT_ANSWERS_NAME,
    referenceFile: element.attr('reference-file') ?? null,
    hasOtherContent:
      panel.length > 1 || $.root().children().not('pl-question-panel, pl-tablet-input').length > 0,
    question: {
      prompt: (MARKDOWN_PROMPT.exec(html)?.[1] ?? panel.html() ?? '').trim(),
      canvas: {
        width: number('width', defaults.canvas.width),
        height: number('height', defaults.canvas.height),
      },
      backgroundImage: element.attr('background-image') ?? null,
      telemetry: flag('telemetry', false),
      grading: {
        autograde,
        mode: element.attr('grading') === 'function' ? 'function' : 'overlap',
        tolerance: number('tolerance', defaults.grading.tolerance),
        passThreshold: number('pass-threshold', defaults.grading.passThreshold),
        partialCredit: flag('partial-credit', defaults.grading.partialCredit),
      },
    } satisfies DrawingQuestion,
  };
}

/** A reference file may be a raw `pl-tablet-input` answer that still holds undone strokes. */
const StoredReferenceSchema = z.object({
  strokes: z.array(
    ReferenceDrawingSchema.shape.strokes.element.extend({ undone: z.boolean().optional() }),
  ),
});

async function readReference(filePath: string): Promise<ReferenceDrawing | null> {
  const stored = StoredReferenceSchema.safeParse(await fs.readJson(filePath).catch(() => null));
  const strokes = (stored.data?.strokes ?? [])
    .filter((stroke) => !stroke.undone)
    .map(({ points }) => ({ points }));
  return strokes.length > 0 ? { version: 1, strokes } : null;
}

export async function readDrawingQuestion(questionPath: string): Promise<DrawingQuestionState> {
  const [html, info] = await Promise.all([
    fs.readFile(path.join(questionPath, 'question.html'), 'utf8').catch(() => ''),
    fs.readJson(path.join(questionPath, 'info.json')),
  ]);
  const autograde = info.gradingMethod !== 'Manual';
  const parsed = parseDrawingQuestionHtml(html, { autograde });

  return {
    question: parsed?.question ?? {
      ...DEFAULT_DRAWING_QUESTION,
      grading: { ...DEFAULT_DRAWING_QUESTION.grading, autograde },
    },
    answersName: parsed?.answersName ?? DEFAULT_ANSWERS_NAME,
    reference: parsed?.referenceFile
      ? await readReference(path.join(questionPath, parsed.referenceFile))
      : null,
    hasUnmanagedContent: html.trim() !== '' && (parsed === null || parsed.hasOtherContent),
  };
}

export function sanitizeImageFileName(name: string): string {
  return (
    path
      .basename(name)
      .replaceAll(/[^\w.-]+/g, '_')
      .replace(/^\.+/, '') || 'background'
  );
}

/**
 * The files that make up a drawing question, keyed by absolute path, ready for
 * a `FileUploadEditor` (which skips files whose contents are unchanged).
 */
export async function drawingQuestionFiles({
  questionPath,
  question,
  answersName,
  reference,
  image,
}: {
  questionPath: string;
  question: DrawingQuestion;
  answersName: string;
  reference: ReferenceDrawing | null;
  image: { fileName: string; contents: Buffer } | null;
}): Promise<Record<string, Buffer>> {
  const infoPath = path.join(questionPath, 'info.json');
  const info = await fs.readJson(infoPath);
  info.gradingMethod = question.grading.autograde ? 'Internal' : 'Manual';

  const textFiles: Record<string, string> = {
    [infoPath]: await formatJsonWithPrettier(JSON.stringify(info)),
    [path.join(questionPath, 'question.html')]: renderDrawingQuestionHtml({
      question,
      answersName,
      hasReference: reference !== null,
    }),
  };
  if (reference) {
    textFiles[path.join(questionPath, REFERENCE_FILE_NAME)] = await formatJsonWithPrettier(
      JSON.stringify(reference),
    );
  }

  const files: Record<string, Buffer> = Object.fromEntries(
    Object.entries(textFiles).map(([filePath, contents]) => [filePath, Buffer.from(contents)]),
  );
  if (image) {
    files[path.join(questionPath, 'clientFilesQuestion', image.fileName)] = image.contents;
  }
  return files;
}
