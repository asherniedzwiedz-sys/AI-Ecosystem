// First-run setup: three ways to start the board.
//   Pick my regulars -> tap the AIs you use, favorite first; they start bigger
//   Start even       -> every tile the same size
//   Surprise me      -> a random head start
import { AIS, ORDER } from "./ais.js";
import { emptyUsage, seedRegulars, seedSurprise } from "./usage.js";

export const SETUP_KEY = "switchboard-setup";

// onApply(choice, usage) is called once the person has chosen.
// onCancel() runs when the dialog is dismissed without a choice.
export function createSetup({ onApply, onCancel }) {
  const dialog = document.getElementById("setup");
  const choose = document.getElementById("setup-choose");
  const pickStep = document.getElementById("setup-pick");
  const grid = document.getElementById("pick-grid");
  const done = document.getElementById("setup-done");
  let picked = [];
  let applied = false;

  const chips = ORDER.map((id) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "pick-chip";
    chip.style.setProperty("--c", AIS[id].color);
    chip.setAttribute("aria-pressed", "false");
    const dot = document.createElement("span");
    dot.className = "dot";
    const name = document.createElement("span");
    name.textContent = AIS[id].name;
    const order = document.createElement("span");
    order.className = "order";
    chip.append(dot, name, order);
    chip.addEventListener("click", () => {
      picked = picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id];
      renderPicks();
    });
    grid.append(chip);
    return { id, chip, order };
  });

  function renderPicks() {
    for (const { id, chip, order } of chips) {
      const at = picked.indexOf(id);
      chip.setAttribute("aria-pressed", String(at >= 0));
      order.textContent = at >= 0 ? String(at + 1) : "";
    }
    done.disabled = picked.length === 0;
  }

  function showStep(step) {
    choose.hidden = step !== "choose";
    pickStep.hidden = step !== "pick";
  }

  function apply(choice, usage) {
    applied = true;
    dialog.close();
    onApply(choice, usage);
  }

  for (const option of dialog.querySelectorAll("[data-choice]")) {
    option.addEventListener("click", () => {
      const choice = option.dataset.choice;
      if (choice === "regulars") {
        showStep("pick");
        chips[0].chip.focus();
      } else if (choice === "even") {
        apply("even", emptyUsage());
      } else {
        apply("surprise", seedSurprise());
      }
    });
  }
  document.getElementById("setup-back").addEventListener("click", () => showStep("choose"));
  done.addEventListener("click", () => apply("regulars", seedRegulars(picked)));
  dialog.addEventListener("close", () => {
    if (!applied) onCancel();
  });

  return {
    open() {
      picked = [];
      applied = false;
      renderPicks();
      showStep("choose");
      dialog.showModal();
    },
  };
}
