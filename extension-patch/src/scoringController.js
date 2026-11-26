/**
 * Start / Stop control for scoring (red = idle, green = running).
 *
 * Scoring never begins on its own. Cards that appear while stopped are only COUNTED ("waiting"); pressing Start
 * drains them. Stop halts the queue immediately (in-flight request finishes, nothing new starts). The state is
 * deliberately NOT persisted: every page load starts stopped, so a refresh can never burn quota by surprise.
 */
export function createScoringController({ scoreCard, concurrency = 2, onChange = () => {} }) {
  const waiting = new Map(); // key -> card
  let running = false;
  let active = 0;
  const done = new Set();

  const emit = () => onChange({ running, waiting: waiting.size, active, scored: done.size });

  async function pump() {
    while (running && active < concurrency && waiting.size > 0) {
      const [key, card] = waiting.entries().next().value;
      waiting.delete(key);
      active++;
      emit();
      try {
        await scoreCard(card);
        done.add(key);
      } catch (error) {
        // Failed cards go back to waiting so the next Start retries them; the error is surfaced, not swallowed.
        waiting.set(key, card);
        console.warn("[XS-NaukriAI] scoring failed", key, error);
        running = false;
      } finally {
        active--;
        emit();
      }
    }
    if (running && waiting.size === 0 && active === 0) {
      running = false;
      emit();
    }
  }

  return {
    /** Call for every card the reader finds. Already scored cards are ignored. */
    offer(card) {
      if (done.has(card.key) || waiting.has(card.key)) return;
      waiting.set(card.key, card);
      emit();
      if (running) void pump();
    },
    start() {
      if (running) return;
      running = true;
      emit();
      void pump();
      // Pump again as in-flight work finishes (concurrency slots free up).
      const tick = setInterval(() => {
        if (!running) return clearInterval(tick);
        void pump();
      }, 400);
    },
    stop() {
      running = false;
      emit();
    },
    toggle() {
      running ? this.stop() : this.start();
    },
    isRunning: () => running,
    markScored(key) {
      done.add(key);
      waiting.delete(key);
      emit();
    },
    reset() {
      running = false;
      waiting.clear();
      done.clear();
      emit();
    },
    snapshot: () => ({ running, waiting: waiting.size, active, scored: done.size }),
  };
}

/** Renders the red/green toggle into `host`. Returns an unmount function. */
export function mountScoringToggle(host, controller) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-live", "polite");
  Object.assign(button.style, {
    display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", width: "100%", height: "36px",
    border: "0", borderRadius: "8px", color: "#fff", font: "600 13px Inter, system-ui, sans-serif", cursor: "pointer",
  });
  const render = ({ running, waiting, active, scored }) => {
    button.setAttribute("aria-pressed", String(running));
    button.style.background = running ? "#15803d" : "#dc2626";
    button.textContent = running
      ? `Scoring: ${scored} done, ${waiting + active} left. Press to stop`
      : waiting > 0
        ? `Stopped: ${waiting} card${waiting === 1 ? "" : "s"} waiting. Press to start`
        : "Stopped. Press to start scoring";
  };
  button.addEventListener("click", () => controller.toggle());
  render(controller.snapshot());
  host.prepend(button);
  return { render, unmount: () => button.remove() };
}
