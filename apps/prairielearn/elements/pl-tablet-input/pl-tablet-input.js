(function () {
  function init(root, options) {
    const canvas = root.querySelector('.pl-tablet-input-canvas');
    const answerInput = root.querySelector('.js-tablet-input-answer');
    const undoButton = root.querySelector('.js-tablet-input-undo');
    const clearButton = root.querySelector('.js-tablet-input-clear');
    const context = canvas.getContext('2d');
    const strokes = [];
    const events = [];
    let activeStroke = null;
    const responseStartedAt = performance.now();
    let replayFrame = null;
    let replayPlaying = false;

    function elapsedTime() {
      return Math.max(0, Math.round(performance.now() - responseStartedAt));
    }

    function pointFromEvent(event) {
      const bounds = canvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
        y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
        dt: elapsedTime(),
        p: Math.round(Math.max(0, Math.min(1, event.pressure || 0)) * 1000) / 1000,
        tx: Number.isFinite(event.tiltX) ? event.tiltX : 0,
        ty: Number.isFinite(event.tiltY) ? event.tiltY : 0,
        pointerType: event.pointerType || 'unknown',
      };
    }

    function drawPoint(point, previous) {
      context.strokeStyle = options.strokeColor;
      context.lineWidth = options.strokeWidth;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.beginPath();
      if (previous) {
        context.moveTo(previous.x * options.width, previous.y * options.height);
      } else {
        context.moveTo(point.x * options.width, point.y * options.height);
      }
      context.lineTo(point.x * options.width, point.y * options.height);
      context.stroke();
    }

    function redraw() {
      context.clearRect(0, 0, options.width, options.height);
      strokes
        .filter((stroke) => !stroke.undone)
        .forEach((stroke) => stroke.points.forEach((point, index) => drawPoint(point, stroke.points[index - 1])));
    }

    function drawReplay(answer, time) {
      context.clearRect(0, 0, options.width, options.height);
      const replayEvents = Array.isArray(answer?.events) ? answer.events : [];
      (answer?.strokes ?? []).forEach((stroke, strokeIndex) => {
        if ((stroke.startedAt ?? 0) > time) return;
        const undoneByEvent = replayEvents.some(
          (event) =>
            event.at <= time &&
            (event.type === 'undo' || event.type === 'clear') &&
            event.strokeIndex === strokeIndex,
        );
        if (stroke.undoneAt <= time || undoneByEvent) return;
        const points = stroke.points.filter((point) => point.dt <= time);
        points.forEach((point, index) => drawPoint(point, points[index - 1]));
      });
    }

    function setupReplay(answer) {
      const replayButton = root.querySelector('.js-tablet-input-replay');
      const replayTime = root.querySelector('.js-tablet-input-replay-time');
      const replayLabel = root.querySelector('.js-tablet-input-replay-label');
      if (!options.replay || !replayButton || !replayTime || !replayLabel) return;

      const duration = Math.max(
        0,
        answer?.responseDuration ??
          Math.max(0, ...(answer?.strokes ?? []).flatMap((stroke) => stroke.points.map((point) => point.dt))),
      );
      replayTime.max = String(duration);

      function renderAt(time) {
        const roundedTime = Math.max(0, Math.min(duration, Math.round(time)));
        replayTime.value = String(roundedTime);
        replayLabel.value = `${roundedTime} ms`;
        drawReplay(answer, roundedTime);
      }

      function stopReplay() {
        replayPlaying = false;
        if (replayFrame !== null) cancelAnimationFrame(replayFrame);
        replayFrame = null;
        replayButton.innerHTML = '<i class="bi bi-play-fill" aria-hidden="true"></i>';
        replayButton.setAttribute('aria-label', 'Play tablet input replay');
      }

      function playReplay(startTime) {
        const startedAt = performance.now() - startTime;
        replayPlaying = true;

        replayButton.innerHTML = '<i class="bi bi-pause-fill" aria-hidden="true"></i>';
        replayButton.setAttribute('aria-label', 'Pause tablet input replay');
        function frame(now) {
          const time = now - startedAt;
          renderAt(time);
          if (time < duration && replayPlaying) {
            replayFrame = requestAnimationFrame(frame);
          } else {
            stopReplay();
          }
        }
        replayFrame = requestAnimationFrame(frame);
      }

      replayButton.addEventListener('click', () => {
        if (replayPlaying) {
          stopReplay();
        } else {
          const currentTime = Number(replayTime.value);
          playReplay(currentTime >= duration ? 0 : currentTime);
        }
      });
      replayTime.addEventListener('input', () => {
        stopReplay();
        renderAt(Number(replayTime.value));
      });
      renderAt(duration);
    }

    function updateAnswer() {
      answerInput.value = JSON.stringify({
        version: 1,
        canvas: { width: options.width, height: options.height },
        responseDuration: elapsedTime(),
        events,
        strokes: options.telemetry
          ? strokes
          : strokes.map(({ startedAt, endedAt, duration, cancelled, points }) => ({
              startedAt,
              endedAt,
              duration,
              cancelled,
              undone,
              undoneAt,
              points: points.map(({ x, y }) => ({ x, y })),
            })),
      });
    }

    function restoreAnswer(answer) {
      if (!answer || !Array.isArray(answer.strokes)) return;
      answer.strokes.forEach((stroke) => {
        if (!stroke || !Array.isArray(stroke.points)) return;
        const restoredStroke = { ...stroke };
        strokes.push(restoredStroke);
        if (!restoredStroke.undone) {
          restoredStroke.points.forEach((point, index) => drawPoint(point, restoredStroke.points[index - 1]));
        }
      });
    }

    function addEvents(events) {
      events.forEach((event) => {
        if (activeStroke && activeStroke.points.length < options.maxPoints) {
          const point = pointFromEvent(event);
          activeStroke.points.push(point);
          drawPoint(point, activeStroke.points[activeStroke.points.length - 2]);
        }
      });
    }

    canvas.addEventListener('pointerdown', (event) => {
      if (!options.editable || activeStroke) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      activeStroke = { startedAt: elapsedTime(), points: [] };
      strokes.push(activeStroke);
      events.push({ type: 'stroke-start', at: activeStroke.startedAt });
      addEvents([event]);
      updateAnswer();
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!activeStroke) return;
      event.preventDefault();
      addEvents(event.getCoalescedEvents ? event.getCoalescedEvents() : [event]);
    });

    function finishStroke(event) {
      if (!activeStroke) return;

      if (event.type !== 'pointercancel') addEvents([event]);
      if (activeStroke.points.length === 0) {
        strokes.pop();
        events.push({ type: 'stroke-cancel', at: elapsedTime(), empty: true });
      } else {
        activeStroke.endedAt = elapsedTime();
        activeStroke.duration = activeStroke.endedAt - activeStroke.startedAt;
        activeStroke.cancelled = event.type === 'pointercancel';
        events.push({
          type: activeStroke.cancelled ? 'stroke-cancel' : 'stroke-end',
          at: activeStroke.endedAt,
          strokeIndex: strokes.length - 1,
        });
      }
      activeStroke = null;
      updateAnswer();
    }
    canvas.addEventListener('pointerup', finishStroke);
    canvas.addEventListener('pointercancel', finishStroke);
    undoButton.addEventListener('click', () => {
      const strokeIndex = strokes.findLastIndex((stroke) => !stroke.undone);
      if (strokeIndex === -1) return;
      const stroke = strokes[strokeIndex];
      stroke.undone = true;
      stroke.undoneAt = elapsedTime();
      events.push({ type: 'undo', at: stroke.undoneAt, strokeIndex });
      redraw();
      updateAnswer();
    });
    clearButton.addEventListener('click', () => {
      const at = elapsedTime();
      strokes.forEach((stroke, strokeIndex) => {
        if (!stroke.undone) {
          stroke.undone = true;
          stroke.undoneAt = at;
          events.push({ type: 'clear', at, strokeIndex });
        }
      });
      redraw();
      updateAnswer();
    });
    restoreAnswer(options.initialAnswer);
    setupReplay(options.initialAnswer);
    updateAnswer();
  }

  window.PLTabletInput = { init };
})();