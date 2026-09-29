# `pl-freehand` element

`pl-freehand` provides a canvas for handwritten or hand-drawn responses, optionally drawn over a background image such as a coordinate plane. It uses browser Pointer Events, so it supports a mouse, touch, Apple Pencil, Wacom tablets, and Surface Pen when the browser exposes those inputs.

The answer is a versioned JSON object containing normalized stroke points. With `telemetry="true"`, points include elapsed time, pressure, tilt, and a coarse pointer type. No device identifier, browser fingerprint, IP address, or wall-clock timestamp is collected.

When a reference drawing is provided, the element autogrades the response by comparing the student's ink with the reference.

## Sample element

```html title="question.html"
<pl-question-panel>
  <p>Graph the line $y = 2x - 1$.</p>
</pl-question-panel>

<pl-freehand
  answers-name="graph"
  width="487"
  height="442"
  background-image="coord_plane.jpg"
  reference-file="reference.json"
  grading="function"
></pl-freehand>
```

Place the background image in `clientFilesQuestion/` and the reference drawing next to `question.html`. Set `"gradingMethod": "Internal"` in `info.json` to autograde, or `"Manual"` to grade by hand.

## Freehand question builder

Instead of writing these files by hand, create a question from the **Freehand** template on the **Create question** page, or click **Edit freehand question** on the preview of any question that uses `pl-freehand`. The builder lets you:

- write the prompt in Markdown with LaTeX math,
- choose a background: grid paper (the default, 800 × 600 px with 20 px squares), a grid with axes (one square per unit, x from −20 to 20 and y from −15 to 15), your own image, or none. The canvas takes the background's proportions, up to 1600 px on the longer side, and the chosen image is copied into `clientFilesQuestion/`,
- draw the answer key with a pen, mouse, or touchscreen,
- choose automatic or manual grading and the grading settings below, and
- add the question to an assessment with a number of points.

Saving writes `question.html`, `info.json`, `reference.json`, and the image in a single edit. The builder manages the whole `question.html`, so questions with additional elements or a `server.py` that sets answers should be edited as files instead.

## Customizations

| Attribute          | Type                        | Default     | Description                                                                                 |
| ------------------ | --------------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| `answers-name`     | string                      | —           | Name used to store the response.                                                            |
| `width`            | integer                     | `800`       | Logical canvas width in pixels. Match the background image's aspect ratio.                  |
| `height`           | integer                     | `400`       | Logical canvas height in pixels.                                                            |
| `background-image` | string                      | —           | File in `clientFilesQuestion/` shown beneath the ink. It is never part of the answer.       |
| `background-fit`   | `"contain"` or `"stretch"`  | `"contain"` | Whether the background keeps its aspect ratio or fills the canvas.                          |
| `reference-file`   | string                      | —           | Reference drawing, relative to the question directory. Enables autograding.                 |
| `grading`          | `"overlap"` or `"function"` | `"overlap"` | How to compare the student's ink with the reference. See [Grading](#grading).               |
| `tolerance`        | number                      | `12`        | Distance in logical pixels within which ink counts as matching.                             |
| `pass-threshold`   | number                      | `0.8`       | Match score in `(0, 1]` that earns full credit.                                             |
| `partial-credit`   | boolean                     | `true`      | Award proportional credit below `pass-threshold`. If `false`, scores below it earn nothing. |
| `weight`           | integer                     | `1`         | Weight of this element within the question score.                                           |
| `max-points`       | integer                     | `10000`     | Maximum number of points accepted in one response.                                          |
| `telemetry`        | boolean                     | `false`     | Collect pressure, tilt, elapsed time, and pointer type in addition to coordinates.          |
| `allow-blank`      | boolean                     | `false`     | Allow submission without any visible strokes.                                               |
| `stroke-color`     | string                      | `#111827`   | CSS color used to render strokes.                                                           |
| `stroke-width`     | number                      | `2`         | Rendered stroke width in logical pixels.                                                    |

## Grading

The reference drawing uses the same format as a submitted answer, so an instructor can draw it with this element and save the submitted JSON. Only visible strokes are used; undone strokes are ignored for both the reference and the submission. Alternatively, `server.py` may set `data["correct_answers"][answers_name]` directly, which takes precedence over `reference-file`.

Both modes resample strokes to evenly spaced points, then compute:

- **coverage**: the share of the reference that the student's ink covers, and
- **accuracy**: the share of the student's ink that lies on the reference.

The match score is the harmonic mean of the two, so missing parts and stray marks both lower it. Scores at or above `pass-threshold` earn full credit; lower scores earn `score / pass-threshold` when `partial-credit` is enabled.

- `grading="overlap"` compares the drawings as shapes: a point matches if it is within `tolerance` of any point in the other drawing. Use it for freeform marks such as shapes, labels, or shading.
- `grading="function"` compares the drawings as graphs $y = f(x)$: the canvas is split into `tolerance`-wide columns, and a column matches if the median heights of both drawings in it are within `tolerance`. Use it for graphing questions; it is less forgiving of ink drawn at the wrong height.

The submission panel shows the score and coverage feedback. The answer panel shows the reference drawing.

## Answer format

```json
{
  "version": 1,
  "canvas": { "width": 800, "height": 400 },
  "responseDuration": 1840,
  "events": [
    { "type": "stroke-start", "at": 1200, "strokeIndex": 0 },
    { "type": "stroke-end", "at": 1840, "strokeIndex": 0 }
  ],
  "strokes": [
    {
      "startedAt": 1200,
      "endedAt": 1840,
      "duration": 640,
      "cancelled": false,
      "points": [
        { "x": 0.15, "y": 0.21, "dt": 1200, "p": 0.5, "tx": 0, "ty": 0, "pointerType": "pen" }
      ]
    }
  ]
}
```

Coordinates are normalized to `[0, 1]`. `responseDuration`, `startedAt`, `endedAt`, `duration`, and point-level `dt` values are elapsed milliseconds from when the student began the response, using a monotonic browser timer; the timer resumes from the saved duration when a saved answer is reopened. A cancelled stroke is marked with `cancelled: true`. Pressure and tilt values depend on browser and device support; unavailable values are represented as zero. When telemetry is disabled, points contain only `x` and `y`, while stroke timing fields are kept.

The `events` array records stroke lifecycle and editing actions. Undo and clear hide strokes from the canvas by marking them `undone` with an `undoneAt` time, but retain their points and timing in the submitted answer for analysis.

### Where responses are stored

The full recording above is saved as a separate file attached to the submission, named `<answers-name>-strokes.json`. Grading and replay read that file, so each submission can be reconstructed exactly. The submitted answer itself holds only a summary:

| Field                     | Meaning                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `strokes_submitted`       | Strokes in the submitted drawing (after undo and clear).                            |
| `undo_count`              | Times the student pressed undo.                                                     |
| `clear_count`             | Times the student cleared the canvas.                                               |
| `cancelled_strokes`       | Strokes the browser cancelled, for example when a palm touched down.                |
| `first_stroke_started_ms` | When the first stroke started, in milliseconds after the question opened.           |
| `last_stroke_ended_ms`    | When the last stroke ended.                                                         |
| `response_duration_ms`    | Time from opening the question to submitting.                                       |
| `start_stroke`            | First point of the submitted drawing, as `[x, y]` canvas pixels.                    |
| `end_stroke`              | Last point of the submitted drawing.                                                |
| `telemetry`               | Whether pen telemetry was collected (`telemetry="true"`).                           |
| `background_image`        | The `background-image` file, such as `grid-paper.png`, or empty for a blank canvas. |

When the element autogrades, its feedback also records `coverage_percent`, `accuracy_percent`, and `overlapping_points` (sample points along the student's ink within `tolerance` of the reference).

On an assessment's **Downloads** page:

- `all_submissions.csv`, `final_submissions.csv`, and `best_submissions.csv` show the summary, without stroke points or telemetry.
- `freehand_summary.csv` has one row per student, question, submission, and canvas, with the canvas score (0–100); the question's gradebook points and maximum points (automatic plus manual); whether the question is autograded (`is_autograded`: `TRUE` or `FALSE`); the background image file (`none` for a blank canvas); the grading details; and the summary fields.
- `freehand_telemetry.json` contains every submission's complete recording, labelled with the student, question, and submission.
- The submitted files downloads (`all_files.zip`, `final_files.zip`, `best_files.zip`) include each `<answers-name>-strokes.json`.

Answers submitted before this change keep their strokes in the submitted answer and still display, grade, and replay.

This element collects raw pen and touch input data. Before using it with real student responses, establish appropriate consent, retention, access, and deletion policies for the course or study.

## Example implementations

- [element/freehand]
- [template/freehand/basic]

[template/freehand/basic]: https://github.com/PrairieLearn/PrairieLearn/tree/master/exampleCourse/questions/template/freehand/basic
[element/freehand]: https://github.com/PrairieLearn/PrairieLearn/tree/master/exampleCourse/questions/element/freehand
