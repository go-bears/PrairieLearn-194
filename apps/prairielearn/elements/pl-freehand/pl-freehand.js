(function () {
  const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
  const clamp01 = (value) => Math.max(0, Math.min(1, value));

  /** Draws strokes with normalized coordinates onto a canvas of logical size width × height. */
  function createRenderer(canvas, { width, height, strokeColor, strokeWidth }) {
    const context = canvas.getContext('2d');
    Object.assign(context, {
      strokeStyle: strokeColor,
      lineWidth: strokeWidth,
      lineCap: 'round',
      lineJoin: 'round',
    });

    function segment(from, to) {
      context.beginPath();
      context.moveTo(from.x * width, from.y * height);
      context.lineTo(to.x * width, to.y * height);
      context.stroke();
    }

    function dot(point) {
      context.beginPath();
      context.arc(
        point.x * width,
        point.y * height,
        Math.max(3, strokeWidth * 1.5),
        0,
        2 * Math.PI,
      );
      context.fillStyle = strokeColor;
      context.fill();
    }

    /** A tap or click: every point within a couple of pixels of the first. */
    function isDot(points) {
      const [first] = points;
      return points.every(
        (point) =>
          Math.abs(point.x - first.x) * width <= 2 && Math.abs(point.y - first.y) * height <= 2,
      );
    }

    function stroke(points) {
      if (points.length === 0) return;
      if (isDot(points)) return dot(points[0]);
      points.forEach((point, index) => segment(points[index - 1] ?? point, point));
    }

    /** Redraws every stroke as it appeared at `time` ms into the response. */
    function strokes(list, time = Infinity) {
      context.clearRect(0, 0, width, height);
      for (const item of list) {
        if ((item.startedAt ?? 0) > time || (item.undone && (item.undoneAt ?? 0) <= time)) {
          continue;
        }
        stroke(item.points.filter((point) => (point.dt ?? 0) <= time));
      }
    }

    return { segment, stroke, strokes };
  }

  /** Records pointer strokes and their editing history, resuming from a saved answer. */
  function createRecorder(canvas, options, renderer, onChange) {
    const initial = options.initialAnswer;
    const clockStart = performance.now() - (initial?.responseDuration ?? 0);
    const now = () => Math.round(performance.now() - clockStart);
    const strokes = (initial?.strokes ?? []).map((stroke) => ({ ...stroke }));
    const events = [...(initial?.events ?? [])];
    let active = null;
    let activePointerId = null;
    // Other pointers (e.g. a palm resting on a tablet) must not add ink to the pen's stroke.
    const isActivePointer = (event) => active && event.pointerId === activePointerId;

    const pointCount = () => strokes.reduce((total, stroke) => total + stroke.points.length, 0);
    const visibleIndices = () => strokes.flatMap((stroke, index) => (stroke.undone ? [] : [index]));

    function log(type, details = {}) {
      events.push({ type, at: now(), ...details });
      onChange();
    }

    function pointFrom(event) {
      const bounds = canvas.getBoundingClientRect();
      const point = {
        x: round(clamp01((event.clientX - bounds.left) / bounds.width), 4),
        y: round(clamp01((event.clientY - bounds.top) / bounds.height), 4),
      };
      if (!options.telemetry) return point;
      return {
        ...point,
        dt: now(),
        p: round(clamp01(event.pressure || 0), 3),
        tx: event.tiltX || 0,
        ty: event.tiltY || 0,
        pointerType: event.pointerType || 'unknown',
      };
    }

    function extend(event) {
      const coalesced = event.getCoalescedEvents?.() ?? [];
      for (const sample of coalesced.length > 0 ? coalesced : [event]) {
        if (pointCount() >= options.maxPoints) return;
        const point = pointFrom(sample);
        renderer.segment(active.points.at(-1) ?? point, point);
        active.points.push(point);
      }
    }

    function finish(event) {
      if (!isActivePointer(event)) return;
      const cancelled = event.type === 'pointercancel';
      if (!cancelled) extend(event);
      const strokeIndex = strokes.indexOf(active);
      if (active.points.length === 0) {
        strokes.splice(strokeIndex, 1);
        log('stroke-cancel', { empty: true });
      } else {
        const endedAt = now();
        Object.assign(active, { endedAt, duration: endedAt - active.startedAt, cancelled });
        renderer.stroke(active.points);
        log(cancelled ? 'stroke-cancel' : 'stroke-end', { at: endedAt, strokeIndex });
      }
      active = null;
    }

    function hide(type, indices) {
      const at = now();
      for (const strokeIndex of indices) {
        Object.assign(strokes[strokeIndex], { undone: true, undoneAt: at });
        events.push({ type, at, strokeIndex });
      }
      renderer.strokes(strokes);
      onChange();
    }

    // `options.signal` lets embedders (e.g. the freehand question builder) detach the recorder.
    const listen = (type, handler) =>
      canvas.addEventListener(type, handler, { signal: options.signal });
    listen('pointerdown', (event) => {
      // Only the main mouse button draws; right-click keeps its context menu.
      if (active || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      activePointerId = event.pointerId;
      active = { startedAt: now(), points: [] };
      strokes.push(active);
      extend(event);
      log('stroke-start', { at: active.startedAt, strokeIndex: strokes.length - 1 });
    });
    listen('pointermove', (event) => {
      if (!isActivePointer(event)) return;
      event.preventDefault();
      extend(event);
    });
    listen('pointerup', finish);
    listen('pointercancel', finish);
    renderer.strokes(strokes);

    return {
      undo: () => hide('undo', visibleIndices().slice(-1)),
      clear: () => hide('clear', visibleIndices()),
      serialize: () => ({
        version: 1,
        canvas: { width: options.width, height: options.height },
        responseDuration: now(),
        events,
        strokes,
      }),
    };
  }

  /** Scrubbable playback of a submitted answer's strokes over time. */
  function setupReplay(root, answer, renderer) {
    const [button, slider, label] = ['replay', 'replay-time', 'replay-label'].map((name) =>
      root.querySelector(`.js-freehand-${name}`),
    );
    const duration =
      answer.responseDuration ??
      Math.max(0, ...answer.strokes.map((stroke) => stroke.endedAt ?? 0));
    let frame = null;
    slider.max = String(duration);

    function renderAt(time) {
      const clamped = Math.max(0, Math.min(duration, Math.round(time)));
      slider.value = String(clamped);
      label.value = `${(clamped / 1000).toFixed(1)} s`;
      renderer.strokes(answer.strokes, clamped);
    }

    function showPlaying(playing) {
      const verb = playing ? 'pause' : 'play';
      button.innerHTML = `<i class="bi bi-${verb}-fill" aria-hidden="true"></i>`;
      button.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} drawing replay`);
    }

    function stop() {
      cancelAnimationFrame(frame);
      frame = null;
      showPlaying(false);
    }

    function play() {
      const from = Number(slider.value) >= duration ? 0 : Number(slider.value);
      const origin = performance.now() - from;
      const tick = (timestamp) => {
        renderAt(timestamp - origin);
        if (timestamp - origin < duration) frame = requestAnimationFrame(tick);
        else stop();
      };
      showPlaying(true);
      frame = requestAnimationFrame(tick);
    }

    button.addEventListener('click', () => (frame === null ? play() : stop()));
    slider.addEventListener('input', () => {
      stop();
      renderAt(Number(slider.value));
    });
    renderAt(duration);
  }

  function init(root) {
    const options = JSON.parse(root.dataset.options);
    const canvas = root.querySelector('.pl-freehand-canvas');
    const renderer = createRenderer(canvas, options);
    if (options.replay) return setupReplay(root, options.initialAnswer, renderer);
    if (!options.editable) return renderer.strokes(options.initialAnswer?.strokes ?? []);

    const input = root.querySelector('.js-freehand-answer');
    const save = () => (input.value = JSON.stringify(recorder.serialize()));
    const recorder = createRecorder(canvas, options, renderer, save);
    root.querySelector('.js-freehand-undo').addEventListener('click', recorder.undo);
    root.querySelector('.js-freehand-clear').addEventListener('click', recorder.clear);
    save();
  }

  window.PLFreehand = { init, createRenderer, createRecorder };
})();
