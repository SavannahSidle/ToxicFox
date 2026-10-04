(() => {
  "use strict";

  const stage = document.querySelector(".stage");
  const canvas = document.querySelector("#field");
  if (!stage || !canvas) return;

  const logicalWidth = Number(canvas.dataset.logicalWidth || canvas.getAttribute("width")) || 960;
  const logicalHeight = Number(canvas.dataset.logicalHeight || canvas.getAttribute("height")) || 540;
  canvas.dataset.logicalWidth = String(logicalWidth);
  canvas.dataset.logicalHeight = String(logicalHeight);

  function scaleCanvasForDisplay() {
    const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    if (Number(canvas.dataset.pixelRatio) === ratio) return;
    canvas.width = Math.round(logicalWidth * ratio);
    canvas.height = Math.round(logicalHeight * ratio);
    canvas.dataset.pixelRatio = String(ratio);
    canvas.getContext("2d").setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  scaleCanvasForDisplay();
  let resizeFrame = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(scaleCanvasForDisplay);
  }, { passive: true });

  const controls = document.createElement("section");
  controls.className = "touch-controls";
  controls.setAttribute("aria-label", "Touch game controls");
  controls.innerHTML = `
    <div class="stick-group">
      <div class="virtual-stick" role="application" tabindex="0"
        aria-label="Movement stick. Drag left or right to move; pushing farther runs. Vertical motion is visual only.">
        <span class="stick-ring" aria-hidden="true"></span>
        <span class="stick-knob" aria-hidden="true"></span>
      </div>
      <span class="touch-hint">DRAG TO MOVE · EDGE TO RUN</span>
    </div>
    <div class="action-group" aria-label="Fox actions">
      <div class="secondary-actions">
        <button type="button" class="touch-action investigate" data-control="KeyI"
          aria-label="Hold to investigate">INVESTIGATE</button>
        <button type="button" class="touch-action" data-pulse="KeyX"
          aria-label="Sit or stand">SIT</button>
        <button type="button" class="touch-action" data-pulse="KeyZ"
          aria-label="Lie down or stand">LIE DOWN</button>
      </div>
      <button type="button" class="jump-action" data-control="Space"
        aria-label="Jump">JUMP</button>
    </div>
  `;
  stage.insertAdjacentElement("afterend", controls);

  const stick = controls.querySelector(".virtual-stick");
  const knob = controls.querySelector(".stick-knob");
  const activeCodes = new Set();
  let stickPointer = null;
  let stickDirection = null;
  let stickWalking = false;

  const keyName = code => ({
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    ShiftLeft: "Shift",
    Space: " ",
    KeyI: "i",
    KeyX: "x",
    KeyZ: "z"
  })[code] || code;

  function sendKey(type, code) {
    window.dispatchEvent(new KeyboardEvent(type, {
      code,
      key: keyName(code),
      bubbles: true,
      cancelable: true
    }));
    if (type === "keydown") activeCodes.add(code);
    else activeCodes.delete(code);
  }

  function press(code) {
    if (!activeCodes.has(code)) sendKey("keydown", code);
  }

  function release(code) {
    if (activeCodes.has(code)) sendKey("keyup", code);
  }

  function pulse(code) {
    press(code);
    release(code);
  }

  function resetStick() {
    if (stickDirection) release(stickDirection);
    release("ShiftLeft");
    stickDirection = null;
    stickWalking = false;
    stick.classList.remove("active");
    stick.removeAttribute("data-direction");
    stick.setAttribute("aria-valuetext", "Centered");
    knob.style.transform = "translate(-50%, -50%)";
  }

  function updateStick(clientX, clientY) {
    const rect = stick.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const maxRadius = rect.width * .31;
    let dx = clientX - centerX;
    let dy = clientY - centerY;
    const distance = Math.hypot(dx, dy);
    if (distance > maxRadius) {
      const scale = maxRadius / distance;
      dx *= scale;
      dy *= scale;
    }

    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

    const horizontal = dx / maxRadius;
    const magnitude = Math.min(1, distance / maxRadius);
    const nextDirection = horizontal < -.18 ? "ArrowLeft" : horizontal > .18 ? "ArrowRight" : null;
    const nextWalking = Boolean(nextDirection && magnitude < .72);

    if (stickDirection !== nextDirection) {
      if (stickDirection) release(stickDirection);
      stickDirection = nextDirection;
      if (stickDirection) press(stickDirection);
    }

    if (stickWalking !== nextWalking) {
      stickWalking = nextWalking;
      if (stickWalking) press("ShiftLeft");
      else release("ShiftLeft");
    }

    const directionText = nextDirection === "ArrowLeft" ? "left" : nextDirection === "ArrowRight" ? "right" : "centered";
    stick.dataset.direction = directionText;
    stick.setAttribute("aria-valuetext",
      nextDirection ? `${directionText}, ${nextWalking ? "walking" : "running"}` : "Centered");
  }

  stick.addEventListener("pointerdown", event => {
    if (stickPointer !== null) return;
    stickPointer = event.pointerId;
    stick.setPointerCapture(event.pointerId);
    stick.classList.add("active");
    updateStick(event.clientX, event.clientY);
    event.preventDefault();
  });

  stick.addEventListener("pointermove", event => {
    if (event.pointerId !== stickPointer) return;
    updateStick(event.clientX, event.clientY);
    event.preventDefault();
  });

  function endStick(event) {
    if (event.pointerId !== stickPointer) return;
    if (stick.hasPointerCapture?.(event.pointerId)) stick.releasePointerCapture(event.pointerId);
    stickPointer = null;
    resetStick();
    event.preventDefault();
  }

  stick.addEventListener("pointerup", endStick);
  stick.addEventListener("pointercancel", endStick);
  stick.addEventListener("lostpointercapture", event => {
    if (event.pointerId === stickPointer) {
      stickPointer = null;
      resetStick();
    }
  });

  const heldPointers = new Map();

  controls.querySelectorAll("[data-control]").forEach(button => {
    button.addEventListener("pointerdown", event => {
      if (heldPointers.has(event.pointerId)) return;
      const code = button.dataset.control;
      heldPointers.set(event.pointerId, { button, code });
      button.setPointerCapture(event.pointerId);
      button.classList.add("pressed");
      button.setAttribute("aria-pressed", "true");
      press(code);
      event.preventDefault();
    });

    const finish = event => {
      const held = heldPointers.get(event.pointerId);
      if (!held || held.button !== button) return;
      heldPointers.delete(event.pointerId);
      if (button.hasPointerCapture?.(event.pointerId)) button.releasePointerCapture(event.pointerId);
      button.classList.remove("pressed");
      button.setAttribute("aria-pressed", "false");
      release(held.code);
      event.preventDefault();
    };

    button.addEventListener("pointerup", finish);
    button.addEventListener("pointercancel", finish);
    button.addEventListener("lostpointercapture", event => {
      const held = heldPointers.get(event.pointerId);
      if (!held || held.button !== button) return;
      heldPointers.delete(event.pointerId);
      button.classList.remove("pressed");
      button.setAttribute("aria-pressed", "false");
      release(held.code);
    });
  });

  controls.querySelectorAll("[data-pulse]").forEach(button => {
    button.addEventListener("pointerdown", event => {
      button.classList.add("pressed");
      pulse(button.dataset.pulse);
      event.preventDefault();
    });
    const finish = event => {
      button.classList.remove("pressed");
      event.preventDefault();
    };
    button.addEventListener("pointerup", finish);
    button.addEventListener("pointercancel", finish);
    button.addEventListener("lostpointercapture", finish);
  });

  function releaseAll() {
    resetStick();
    stickPointer = null;
    for (const { button, code } of heldPointers.values()) {
      button.classList.remove("pressed");
      button.setAttribute("aria-pressed", "false");
      release(code);
    }
    heldPointers.clear();
    for (const code of [...activeCodes]) release(code);
  }

  window.addEventListener("blur", releaseAll);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseAll();
  });
  window.addEventListener("pagehide", releaseAll);
})();