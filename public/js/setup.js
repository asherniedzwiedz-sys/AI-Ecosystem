// First-run setup: two ways to start the board.
//   Start fresh    -> every count at 0; tiles grow with use
//   Upload my data -> read a chat export (or pasted counts), show what was
//                     found, and only save it on Confirm
import { AIS, ORDER } from "./ais.js";
import { rankAIs } from "./usage.js";
import { ImportError, parseImport } from "./usage-import.js";

export const SETUP_DONE_KEY = "switchboard-setup-done";
const DEFAULT_SOURCE = "chatgpt";
const MAX_FILE_BYTES = 400 * 1024 * 1024;

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString();

// onChoose(choice) runs as soon as "fresh" or "upload" is picked.
// onImport(counts) runs on Confirm with the counts that were shown.
// onClose() runs whenever the dialog closes.
export function createSetup({ onChoose, onImport, onClose, currentUsage }) {
  const dialog = $("setup");
  const steps = { choose: $("setup-choose"), upload: $("setup-upload"), review: $("setup-review") };
  const source = $("import-ai");
  const fileInput = $("import-file");
  const paste = $("import-paste");
  const pasteBtn = $("import-paste-btn");
  const status = $("import-status");
  let found = null; // what parseImport returned, waiting for Confirm
  let reading = 0;

  for (const id of ORDER) source.append(new Option(AIS[id].name, id));

  function showStep(name, focus) {
    for (const [key, el] of Object.entries(steps)) el.hidden = key !== name;
    focus?.focus();
  }

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle("error", isError);
  }

  function review(result, origin) {
    found = result;
    const list = $("review-list");
    list.replaceChildren();
    const ids = rankAIs(result.counts).filter((id) => id in result.counts);
    for (const id of ids) {
      const item = document.createElement("li");
      item.style.setProperty("--c", AIS[id].color);
      const name = document.createElement("span");
      name.textContent = AIS[id].name;
      const count = document.createElement("strong");
      count.textContent = fmt(result.counts[id]);
      item.append(name, count);
      list.append(item);
    }
    $("review-source").textContent =
      result.kind === "history"
        ? `${origin}: ${fmt(result.messages)} messages you sent in ${fmt(result.conversations)} conversations, counted for ${AIS[ids[0]].name}.`
        : `${origin}: ${ids.map((id) => `${AIS[id].name} ${fmt(result.counts[id])}`).join(", ")}.` +
          (result.skipped?.length ? ` Skipped ${result.skipped.length} that ${result.skipped.length === 1 ? "isn't" : "aren't"} one of the 8 AIs.` : "");
    const usage = currentUsage();
    const othersUsed = ORDER.some((id) => !(id in result.counts) && usage[id] > 0);
    $("review-note").textContent = othersUsed
      ? "Confirm sets these counts. The other AIs keep the counts they have."
      : "Confirm sets these counts. The other AIs start at 0.";
    showStep("review", $("review-confirm"));
  }

  function tryParse(text, origin) {
    try {
      review(parseImport(text, source.value), origin);
      setStatus("");
    } catch (err) {
      setStatus(err instanceof ImportError ? err.message : "Couldn't read that. Try a different file.", true);
    }
  }

  for (const option of dialog.querySelectorAll("[data-choice]")) {
    option.addEventListener("click", () => {
      const choice = option.dataset.choice;
      onChoose(choice);
      if (choice === "fresh") {
        dialog.close();
        return;
      }
      setStatus("");
      showStep("upload", source);
    });
  }

  $("import-file-btn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = ""; // so picking the same file again still fires
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setStatus(`${file.name} is too big to read here (over ${MAX_FILE_BYTES / 1024 / 1024} MB).`, true);
      return;
    }
    const token = ++reading;
    setStatus(`Reading ${file.name}…`);
    try {
      const text = await file.text();
      if (token === reading && !steps.upload.hidden) tryParse(text, file.name);
    } catch {
      if (token === reading) setStatus(`Couldn't open ${file.name}.`, true);
    }
  });

  paste.addEventListener("input", () => {
    pasteBtn.disabled = !paste.value.trim();
  });
  pasteBtn.addEventListener("click", () => tryParse(paste.value, "Pasted"));

  $("upload-back").addEventListener("click", () => showStep("choose", dialog.querySelector('[data-choice="upload"]')));
  $("review-back").addEventListener("click", () => {
    found = null;
    showStep("upload", $("import-file-btn"));
  });
  $("review-confirm").addEventListener("click", () => {
    if (!found) return;
    const counts = found.counts;
    found = null;
    dialog.close();
    onImport(counts);
  });
  dialog.addEventListener("close", () => {
    reading += 1;
    onClose();
  });

  return {
    open() {
      found = null;
      source.value = DEFAULT_SOURCE;
      paste.value = "";
      pasteBtn.disabled = true;
      setStatus("");
      showStep("choose");
      dialog.showModal();
    },
  };
}
