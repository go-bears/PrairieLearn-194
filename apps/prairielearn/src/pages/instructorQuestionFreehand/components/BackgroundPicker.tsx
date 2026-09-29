import clsx from 'clsx';
import { useState } from 'react';

import {
  BACKGROUND_IMAGE_TYPES,
  BUILT_IN_BACKGROUNDS,
  BUILT_IN_BACKGROUND_IDS,
  type BackgroundInput,
  type BuiltInBackgroundId,
  type FreehandQuestion,
  MAX_BACKGROUND_IMAGE_BYTES,
  MAX_CANVAS_DIMENSION,
  canvasForImage,
  isBackgroundImageType,
} from '../../../lib/freehand-question.shared.js';

type Canvas = FreehandQuestion['canvas'];
type UploadBackground = Extract<BackgroundInput, { kind: 'upload' }>;

export interface BackgroundChoice {
  background: BackgroundInput;
  url: string | null;
  /** The canvas size this background needs, or null to keep the current size. */
  canvas: Canvas | null;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result).split(',')[1]));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

async function imageSize(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
  return { width: image.naturalWidth, height: image.naturalHeight };
}

/** Explains how an oversized image is scaled to fit the canvas, if it is. */
function scaleNotice(size: Canvas, canvas: Canvas): string | null {
  return canvas.width === size.width
    ? null
    : `This image is ${size.width} × ${size.height} px, so the canvas will use ${canvas.width} × ${canvas.height} px.`;
}

/**
 * Chooses among the built-in grids, images already in the question's
 * `clientFilesQuestion/` folder, a newly uploaded image, or no background.
 * Remembers the upload so instructors can switch away and back without
 * uploading it again.
 */
export function BackgroundPicker({
  initial,
  builtInUrls,
  questionImages,
  questionFileUrl,
  onChange,
}: {
  initial: BackgroundChoice;
  builtInUrls: Record<BuiltInBackgroundId, string>;
  /** Image files in the question's `clientFilesQuestion/` folder. */
  questionImages: string[];
  questionFileUrl: (fileName: string) => string;
  onChange: (choice: BackgroundChoice) => void;
}) {
  const [selected, setSelected] = useState(initial.background);
  const [notice, setNotice] = useState<string | null>(null);
  const [upload, setUpload] = useState<{
    background: UploadBackground;
    choice: BackgroundChoice;
    notice: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const images = [
    ...new Set([
      ...questionImages,
      ...(initial.background.kind === 'existing' ? [initial.background.fileName] : []),
    ]),
  ];

  function choose(choice: BackgroundChoice, choiceNotice: string | null = null) {
    setSelected(choice.background);
    setNotice(choiceNotice);
    onChange(choice);
  }

  async function chooseQuestionImage(fileName: string) {
    // Show the choice right away; the canvas updates once the image is measured.
    setSelected({ kind: 'existing', fileName });
    const url = questionFileUrl(fileName);
    const size = await imageSize(url).catch(() => null);
    const canvas = size && canvasForImage(size.width, size.height);
    choose(
      { background: { kind: 'existing', fileName }, url, canvas },
      size && canvas && scaleNotice(size, canvas),
    );
  }

  async function uploadImage(file: File | undefined) {
    if (!file) return;
    if (!isBackgroundImageType(file.type)) {
      setError('Choose a PNG, JPEG, GIF, or WebP image.');
      return;
    }
    if (file.size > MAX_BACKGROUND_IMAGE_BYTES) {
      setError(`Choose an image smaller than ${MAX_BACKGROUND_IMAGE_BYTES / 1024 / 1024} MB.`);
      return;
    }
    setError(null);
    const url = URL.createObjectURL(file);
    const [size, contentBase64] = await Promise.all([imageSize(url), readAsBase64(file)]);
    const canvas = canvasForImage(size.width, size.height);
    const background: UploadBackground = {
      kind: 'upload',
      name: file.name,
      type: file.type,
      contentBase64,
    };
    const next = {
      background,
      choice: { background, url, canvas },
      notice: scaleNotice(size, canvas),
    };
    setUpload(next);
    choose(next.choice, next.notice);
  }

  const radio = (id: string, label: string, checked: boolean, onSelect: () => void) => (
    <div key={id} className="form-check">
      <input
        id={`background-${id}`}
        type="radio"
        name="background"
        className="form-check-input"
        checked={checked}
        onChange={onSelect}
      />
      <label className="form-check-label" htmlFor={`background-${id}`}>
        {label}
      </label>
    </div>
  );

  return (
    <fieldset>
      <legend className="form-label fs-6">Background</legend>
      {BUILT_IN_BACKGROUND_IDS.map((id) =>
        radio(
          id,
          BUILT_IN_BACKGROUNDS[id].label,
          selected.kind === 'builtIn' && selected.id === id,
          () =>
            choose({
              background: { kind: 'builtIn', id },
              url: builtInUrls[id],
              canvas: BUILT_IN_BACKGROUNDS[id].canvas,
            }),
        ),
      )}
      {images.map((fileName) =>
        radio(
          `file-${fileName}`,
          `Question file: ${fileName}`,
          selected.kind === 'existing' && selected.fileName === fileName,
          () => void chooseQuestionImage(fileName),
        ),
      )}
      {upload &&
        radio('upload', `Uploaded: ${upload.background.name}`, selected.kind === 'upload', () =>
          choose(upload.choice, upload.notice),
        )}
      {radio('none', 'None (blank canvas)', selected.kind === 'none', () =>
        choose({ background: { kind: 'none' }, url: null, canvas: null }),
      )}

      <label className="form-label mt-2" htmlFor="background-upload">
        Upload your own image
      </label>
      <input
        id="background-upload"
        type="file"
        className={clsx('form-control', error && 'is-invalid')}
        accept={BACKGROUND_IMAGE_TYPES.join(',')}
        aria-describedby="background-upload-help"
        aria-invalid={error ? true : undefined}
        aria-errormessage={error ? 'background-upload-error' : undefined}
        onChange={(event) => uploadImage(event.target.files?.[0])}
      />
      {error && (
        <div id="background-upload-error" className="invalid-feedback d-block">
          {error}
        </div>
      )}
      {notice && <div className="form-text text-warning-emphasis">{notice}</div>}
      <small id="background-upload-help" className="form-text text-muted d-block">
        Images added to this question's <code>clientFilesQuestion/</code> folder on the{' '}
        <strong>Files</strong> tab are listed as question files. The canvas takes the background's
        proportions, up to {MAX_CANVAS_DIMENSION} px on the longer side.
      </small>
    </fieldset>
  );
}
