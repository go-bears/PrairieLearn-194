# `pl-tablet-input` element

`pl-tablet-input` provides a blank canvas for handwritten responses. It uses browser Pointer Events, so it supports a mouse, touch, Apple Pencil, Wacom tablets, and Surface Pen when the browser exposes those inputs.

The answer is a versioned JSON object containing normalized stroke points. With `telemetry="true"`, points include elapsed time, pressure, tilt, and a coarse pointer type. No device identifier, browser fingerprint, IP address, or wall-clock timestamp is collected.

## Sample element

```html
<pl-tablet-input
  answers-name="handwriting"
  telemetry="true"
  width="800"
  height="400"
></pl-tablet-input>
```

The element is intentionally not gradeable. Instructors can analyze the submitted answer in the normal submission data path.

## Customizations

| Attribute      | Type    | Default   | Description                                                                        |
| -------------- | ------- | --------- | ---------------------------------------------------------------------------------- |
| `answers-name` | string  | -         | Name used to store the response.                                                   |
| `width`        | integer | `800`     | Logical canvas width in pixels.                                                    |
| `height`       | integer | `400`     | Logical canvas height in pixels.                                                   |
| `max-points`   | integer | `10000`   | Maximum number of points accepted in one response.                                 |
| `telemetry`    | boolean | `false`   | Collect pressure, tilt, elapsed time, and pointer type in addition to coordinates. |
| `allow-blank`  | boolean | `false`   | Allow submission without any strokes.                                              |
| `stroke-color` | string  | `#111827` | CSS color used to render strokes.                                                  |
| `stroke-width` | number  | `2`       | Rendered stroke width in logical pixels.                                           |

## Answer format

```json
{
  "version": 1,
  "canvas": { "width": 800, "height": 400 },
  "responseDuration": 1840,
  "events": [
    { "type": "stroke-start", "at": 1200 },
    { "type": "stroke-end", "at": 1840, "strokeIndex": 0 }
  ],
  "strokes": [
    {
      "startedAt": 1200,
      "endedAt": 1840,
      "duration": 640,
      "cancelled": false,
      "undone": false,
      "points": [
        { "x": 0.15, "y": 0.21, "dt": 0, "p": 0.5, "tx": 0, "ty": 0, "pointerType": "pen" }
      ]
    }
  ]
}
```

Coordinates are normalized to `[0, 1]`. `responseDuration`, `startedAt`, `endedAt`, `duration`, and point-level `dt` values are elapsed milliseconds from page initialization, using a monotonic browser timer. A cancelled stroke is marked with `cancelled: true`. Pressure and tilt values depend on browser and device support; unavailable values are represented as zero. When telemetry is disabled, only normalized `x` and `y` coordinates are retained, except for stroke timing fields.

The `events` array records stroke lifecycle and editing actions. Undo and clear hide strokes from the canvas by marking them `undone`, but retain their points and timing in the submitted answer for analysis.

This element collects raw tablet input data. Before using it with real student responses, establish appropriate consent, retention, access, and deletion policies for the course or study.
