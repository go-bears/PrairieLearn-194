# Handwriting telemetry design stub

This file is a design stub for adding pen and handwriting telemetry to `pl-drawing`.
It is intentionally documentation-only: do not collect telemetry until the privacy and
retention decisions below have been approved.

## POC goal

Capture a student response from a browser canvas using Pointer Events. The same client
path should work with:

- Wacom tablets in a desktop browser
- Surface Pen in Edge
- Apple Pencil or touch in Safari on iPad

The first POC should save raw strokes as the answer and should not attempt handwriting
to-text recognition.

## Suggested answer shape

Use a versioned, normalized payload. Coordinates are relative to the logical canvas size,
not the device pixel ratio.

```json
{
  "version": 1,
  "canvas": { "width": 800, "height": 400 },
  "strokes": [
    {
      "points": [
        { "x": 0.15, "y": 0.21, "dt": 0, "p": 0.5, "tx": 0, "ty": 0 }
      ]
    }
  ]
}
```

Recommended fields:

- `x`, `y`: normalized coordinates in `[0, 1]`
- `dt`: elapsed milliseconds from the beginning of the response
- `p`: normalized pressure in `[0, 1]`, when available
- `tx`, `ty`: tilt values, when available
- `pointerType`: optional coarse value such as `pen`, `touch`, or `mouse`

Do not store browser fingerprints, device identifiers, IP addresses, or precise wall-clock
timestamps as part of the answer. Record a separate `inputCapabilities` summary only if
it is necessary for the study.

## Implementation checklist

- [ ] Add a dedicated handwriting mode or element rather than changing existing drawing
      behavior unexpectedly.
- [ ] Use `pointerdown`, `pointermove`, `pointerup`, and `pointercancel`.
- [ ] Set `touch-action: none` on the canvas and call `setPointerCapture` on pointer down.
- [ ] Use `event.getCoalescedEvents()` when available to preserve pen motion smoothly.
- [ ] Keep the logical canvas dimensions independent from display scaling.
- [ ] Render the current stroke locally and provide undo, clear, and keyboard-accessible
      controls.
- [ ] Make telemetry collection opt-in at the question or course level.
- [ ] Submit a compact structured answer; do not submit only a screenshot.
- [ ] Add tests for empty input, one stroke, multiple strokes, pointer cancellation,
      resize behavior, and restoration of a submitted answer.
- [ ] Test with Wacom, Surface Pen, Apple Pencil, mouse, and touch input.
- [ ] Document the data collected in the question authoring documentation.

## Compression

Compression is useful for transport and storage, but it is not privacy protection.
For a POC, compact the data before serialization:

1. Normalize coordinates.
2. Store time deltas rather than absolute timestamps.
3. Quantize values to an agreed precision, for example coordinates to 16-bit integers.
4. Remove optional fields that are unavailable or not needed.
5. Serialize with a compact format. JSON is easiest to debug; MessagePack or CBOR can be
   considered later.
6. Apply gzip or Brotli at the transport/storage boundary. Prefer server-managed
   compression where possible instead of adding a large client dependency.

Do not base64-encode compressed data unless the receiving field requires text. Base64 adds
roughly 33% overhead.

## Encryption and privacy

Start with HTTPS/TLS in transit and server-side encryption at rest. For most POCs, this is
safer and easier to operate than putting an encryption key in the question or browser.
A browser cannot protect data from a user who can inspect the page, so client-side encryption
must not be treated as an access-control boundary.

Before collecting real student data, decide:

- whether raw strokes are needed or derived features are sufficient
- who may decrypt the data
- how long raw telemetry is retained
- whether students can opt out or delete it
- whether the data is used for grading, research, or both
- whether institutional approval or consent is required

### Instructor-only analysis option

If the server must not be able to read raw telemetry, use envelope encryption:

1. The instructor or institution creates an asymmetric public/private key pair.
2. The public key is associated with the course or analysis project; the private key stays
   outside PrairieLearn, preferably in an approved key-management system.
3. The browser generates a random AES-256-GCM key for each response or batch.
4. The browser encrypts the compressed payload with AES-GCM using a unique nonce.
5. The browser encrypts the AES key with the instructor public key using RSA-OAEP or an
   approved HPKE/Web Crypto-compatible scheme.
6. Store the ciphertext, nonce, algorithm/version metadata, and wrapped AES key.
7. The instructor decrypts through a controlled analysis tool; never send the private key
   to the question page or store it in course source files.

This design needs key rotation, recovery, authorization, audit logging, and a plan for
lost keys before production use. It is probably too much for the first POC.

## Recommended POC privacy mode

For the first implementation:

- collect only while the student is actively drawing
- keep raw telemetry in the normal answer submission
- use HTTPS and existing PrairieLearn access controls
- make telemetry disabled by default unless explicitly enabled
- show a short data-collection notice in the question
- add a maximum response size and fail gracefully when it is exceeded
- provide a server-side purge path for test data
- use synthetic handwriting for development and automated tests

The next implementation decision is whether telemetry is part of the gradeable answer or
is a separate research artifact. That choice determines whether it should use the existing
`pl-drawing` submission path or a separately permissioned storage and analysis path.
