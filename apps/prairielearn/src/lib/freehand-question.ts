import path from 'node:path';

import * as cheerio from 'cheerio';
import fs from 'fs-extra';
import { z } from 'zod';

import {
  BUILT_IN_BACKGROUNDS,
  type BuiltInBackgroundId,
  DEFAULT_FREEHAND_QUESTION,
  ELEMENT_DEFAULT_CANVAS,
  type FreehandQuestion,
  REFERENCE_FILE_NAME,
  type ReferenceDrawing,
  ReferenceDrawingSchema,
} from './freehand-question.shared.js';
import { APP_ROOT_PATH } from './paths.js';
import { formatJsonWithPrettier } from './prettier.js';

const DEFAULT_ANSWERS_NAME = 'drawing';
const TRUE_VALUES = new Set(['true', 't', '1', 'yes', 'y', 'on']);
const MARKDOWN_PROMPT =
  /<pl-question-panel>\s*<markdown>([\s\S]*?)<\/markdown>\s*<\/pl-question-panel>/;

interface FreehandQuestionState {
  question: FreehandQuestion;
  answersName: string;
  reference: ReferenceDrawing | null;
  /** Whether `question.html` has content the builder would overwrite on save. */
  hasUnmanagedContent: boolean;
}

const escapeAttribute = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

export function renderFreehandQuestionHtml({
  question,
  answersName,
  hasReference,
}: {
  question: FreehandQuestion;
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
    '<pl-freehand',
    ...Object.entries(attributes)
      .filter(([, value]) => value !== null)
      .map(([name, value]) => `  ${name}="${escapeAttribute(String(value))}"`),
    '></pl-freehand>',
    '',
  ].join('\n');
}

/** Reads builder settings back out of `question.html`; null if it has no single `pl-freehand`. */
export function parseFreehandQuestionHtml(html: string, { autograde }: { autograde: boolean }) {
  const $ = cheerio.load(html, null, false);
  const element = $('pl-freehand');
  if (element.length !== 1) return null;

  const number = (name: string, fallback: number) => {
    const value = Number(element.attr(name));
    return element.attr(name) !== undefined && Number.isFinite(value) ? value : fallback;
  };
  const flag = (name: string, fallback: boolean) => {
    const value = element.attr(name);
    return value === undefined ? fallback : TRUE_VALUES.has(value.trim().toLowerCase());
  };
  const defaults = DEFAULT_FREEHAND_QUESTION;
  const panel = $('pl-question-panel');

  return {
    answersName: element.attr('answers-name') ?? DEFAULT_ANSWERS_NAME,
    referenceFile: element.attr('reference-file') ?? null,
    hasOtherContent:
      panel.length > 1 || $.root().children().not('pl-question-panel, pl-freehand').length > 0,
    question: {
      prompt: (MARKDOWN_PROMPT.exec(html)?.[1] ?? panel.html() ?? '').trim(),
      canvas: {
        width: number('width', ELEMENT_DEFAULT_CANVAS.width),
        height: number('height', ELEMENT_DEFAULT_CANVAS.height),
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
    } satisfies FreehandQuestion,
  };
}

/** A reference file may be a raw `pl-freehand` answer that still holds undone strokes. */
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

export async function readFreehandQuestion(questionPath: string): Promise<FreehandQuestionState> {
  const [html, info] = await Promise.all([
    fs.readFile(path.join(questionPath, 'question.html'), 'utf8').catch(() => ''),
    fs.readJson(path.join(questionPath, 'info.json')),
  ]);
  const autograde = info.gradingMethod !== 'Manual';
  const parsed = parseFreehandQuestionHtml(html, { autograde });

  return {
    question: parsed?.question ?? {
      ...DEFAULT_FREEHAND_QUESTION,
      grading: { ...DEFAULT_FREEHAND_QUESTION.grading, autograde },
    },
    answersName: parsed?.answersName ?? DEFAULT_ANSWERS_NAME,
    reference: parsed?.referenceFile
      ? await readReference(path.join(questionPath, parsed.referenceFile))
      : null,
    hasUnmanagedContent: html.trim() !== '' && (parsed === null || parsed.hasOtherContent),
  };
}

export function builtInBackgroundPath(id: BuiltInBackgroundId): string {
  const { fileName } = BUILT_IN_BACKGROUNDS[id];
  return path.join(APP_ROOT_PATH, 'elements', 'pl-freehand', 'clientFilesElement', fileName);
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

/** Image files directly in the question's `clientFilesQuestion/` folder, except the built-in grids. */
export async function listQuestionImages(questionPath: string): Promise<string[]> {
  const builtIn = new Set(Object.values(BUILT_IN_BACKGROUNDS).map(({ fileName }) => fileName));
  const entries = await fs
    .readdir(path.join(questionPath, 'clientFilesQuestion'), { withFileTypes: true })
    .catch(() => []);
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) &&
        !builtIn.has(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
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
 * The files that make up a freehand question, keyed by absolute path, ready for
 * a `FileUploadEditor` (which skips files whose contents are unchanged).
 */
export async function freehandQuestionFiles({
  questionPath,
  question,
  answersName,
  reference,
  image,
}: {
  questionPath: string;
  question: FreehandQuestion;
  answersName: string;
  reference: ReferenceDrawing | null;
  image: { fileName: string; contents: Buffer } | null;
}): Promise<Record<string, Buffer>> {
  const infoPath = path.join(questionPath, 'info.json');
  const info = await fs.readJson(infoPath);
  info.gradingMethod = question.grading.autograde ? 'Internal' : 'Manual';

  const textFiles: Record<string, string> = {
    [infoPath]: await formatJsonWithPrettier(JSON.stringify(info)),
    [path.join(questionPath, 'question.html')]: renderFreehandQuestionHtml({
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
