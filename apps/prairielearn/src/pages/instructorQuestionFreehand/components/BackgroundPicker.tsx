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
type CustomBackground = Extract<BackgroundInput, { kind: 'existing' | 'upload' }>;

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

const customName = (background: CustomBackground) =>
  background.kind === 'existing' ? background.fileName : background.name;

/**
 * Chooses among the built-in grids, a custom image (already saved or newly
 * uploaded), or no background. Remembers the custom image so instructors can
 * switch to a grid and back without uploading it again.
 */
export function BackgroundPicker({
  initial,
  builtInUrls,
  onChange,
}: {
  initial: BackgroundChoice;
  builtInUrls: Record<BuiltInBackgroundId, string>;
  onChange: (choice: BackgroundChoice) => void;
}) {
  const [selected, setSelected] = useState(initial.background);
  const [custom, setCustom] = useState<{
    background: CustomBackground;
    choice: BackgroundChoice;
    /** Explains how an oversized image was scaled to fit the canvas. */
    notice: string | null;
  } | null>(
    initial.background.kind === 'existing'
      ? { background: initial.background, choice: initial, notice: null }
      : null,
  );
  const [error, setError] = useState<string | null>(null);

  function choose(choice: BackgroundChoice) {
    setSelected(choice.background);
    onChange(choice);
  }

  async function upload(file: File | undefined) {
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
    const notice =
      canvas.width === size.width
        ? null
        : `This image is ${size.width} × ${size.height} px, so the canvas will use ${canvas.width} × ${canvas.height} px.`;
    const background: CustomBackground = {
      kind: 'upload',
      name: file.name,
      type: file.type,
      contentBase64,
    };
    const choice = { background, url, canvas };
    setCustom({ background, choice, notice });
    choose(choice);
  }

  const isCustomSelected = selected.kind === 'existing' || selected.kind === 'upload';

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
      {custom &&
        radio('custom', `Custom image: ${customName(custom.background)}`, isCustomSelected, () =>
          choose(custom.choice),
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
        onChange={(event) => upload(event.target.files?.[0])}
      />
      {error && (
        <div id="background-upload-error" className="invalid-feedback d-block">
          {error}
        </div>
      )}
      {custom?.notice && isCustomSelected && (
        <div className="form-text text-warning-emphasis">{custom.notice}</div>
      )}
      <small id="background-upload-help" className="form-text text-muted d-block">
        The canvas takes the background's proportions, up to {MAX_CANVAS_DIMENSION} px on the longer
        side.
      </small>
    </fieldset>
  );
}
