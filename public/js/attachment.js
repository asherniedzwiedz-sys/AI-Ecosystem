// Attaching a file to the prompt. A link can't carry a file to another site,
// so what happens on send depends on the kind of file:
//   text, code, data -> the text rides along with the prompt (URL prefill + clipboard)
//   image            -> copied to the clipboard as an image, ready to paste
//   anything else    -> the router takes it into account; you attach it on the AI's site
// The file never leaves the device. The router only gets its name, type, size
// and, for text files, the first part of the text.

export const ROUTER_EXCERPT_CHARS = 1500;
export const INLINE_TEXT_CHARS = 150_000; // longer text is better attached on the AI's site
const MAX_TEXT_READ_BYTES = 2_000_000;
const MAX_IMAGE_EDGE = 2048; // the AIs downscale anyway; keeps the clipboard copy light

export const KIND_LABELS = {
  code: "code file",
  text: "text file",
  data: "data file",
  sheet: "spreadsheet",
  slides: "slide deck",
  doc: "document",
  pdf: "PDF",
  image: "image",
  audio: "audio file",
  video: "video",
  other: "file",
};
export const KINDS = Object.keys(KIND_LABELS);

const EXTENSIONS = {
  code:
    "py js mjs cjs ts tsx jsx java c h cpp hpp cc cs go rs rb php swift kt kts scala dart lua r jl sql sh bash zsh ps1 bat " +
    "html css scss vue svelte ino v sv vhd vhdl asm s cir sp spice m",
  text: "txt md markdown rst log tex bib yaml yml toml ini cfg conf xml json srt vtt",
  data: "csv tsv",
  sheet: "xlsx xls xlsm ods numbers",
  slides: "pptx ppt key odp",
  doc: "docx doc odt rtf pages",
  pdf: "pdf",
};
const BY_EXTENSION = new Map(
  Object.entries(EXTENSIONS).flatMap(([kind, list]) => list.split(" ").map((ext) => [ext, kind])),
);
const TEXT_KINDS = new Set(["code", "text", "data"]);

export function isTextKind(kind) {
  return TEXT_KINDS.has(kind);
}

// Extension first (it's more specific than most MIME types), then MIME type.
export function classify(name = "", type = "") {
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  if (BY_EXTENSION.has(ext)) return BY_EXTENSION.get(ext);
  const major = type.split("/")[0];
  if (major === "image" || major === "audio" || major === "video") return major;
  if (type === "application/pdf") return "pdf";
  if (major === "text" || /json|xml|javascript/.test(type)) return "text";
  return "other";
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

// What the router gets. Never the file itself.
export function routerMeta(att) {
  if (!att) return null;
  const meta = { name: att.name, type: att.type, size: att.size, kind: att.kind };
  if (att.text) meta.excerpt = att.text.slice(0, ROUTER_EXCERPT_CHARS);
  return meta;
}

// The text that goes to the AI: the prompt, plus a text file's contents.
export function outgoingText(prompt, att) {
  const text = prompt.trim();
  if (!att?.inlineText) return text;
  const block = `----- ${att.name} -----\n${att.inlineText}`;
  return text ? `${text}\n\n${block}` : block;
}

// Turns a picked, dropped or pasted file into an attachment.
export async function readAttachment(file) {
  const att = {
    file,
    name: file.name || "pasted file",
    type: file.type || "",
    size: file.size,
    kind: classify(file.name, file.type),
  };
  if (isTextKind(att.kind) && file.size <= MAX_TEXT_READ_BYTES) {
    att.text = await file.text();
    if (att.text.length <= INLINE_TEXT_CHARS) att.inlineText = att.text;
  }
  if (att.kind === "image") {
    att.preview = URL.createObjectURL(file);
    att.png = await toPng(att.preview, file).catch(() => null);
  }
  return att;
}

export function releaseAttachment(att) {
  if (att?.preview) URL.revokeObjectURL(att.preview);
}

// Browsers only put PNG on the clipboard, so convert (and shrink huge photos).
async function toPng(url, file) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const { naturalWidth: w, naturalHeight: h } = img;
  if (!w || !h) throw new Error("image has no size");
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(w, h));
  if (file.type === "image/png" && scale === 1) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encode failed"))), "image/png");
  });
}
