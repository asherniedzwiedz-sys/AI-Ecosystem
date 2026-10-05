// WebAudio ticks and a ding. The context is created on the first user gesture
// (browsers block audio before that).
let ctx;
let enabled = true;

function audio() {
  if (!enabled) return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  ctx ??= new AudioCtx();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function setSound(on) {
  enabled = on;
}

// Unlock audio inside a click handler so later ticks (fired from timers) can play.
export function unlockAudio() {
  audio();
}

// Relay click as a lamp passes. `pitch` nudges it up as the wheel slows.
export function tick(pitch = 0) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  const osc = ac.createOscillator();
  const filter = ac.createBiquadFilter();
  const gain = ac.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(1500 + pitch * 500, t);
  filter.type = "lowpass";
  filter.frequency.value = 3200;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.05, t + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  osc.connect(filter).connect(gain).connect(ac.destination);
  osc.start(t);
  osc.stop(t + 0.04);
}

// Bell for the landing: a fundamental plus an inharmonic partial.
export function ding() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  for (const [freq, level, decay] of [
    [1046.5, 0.16, 1.2],
    [2637, 0.05, 0.7],
    [3520, 0.02, 0.4],
  ]) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }
}
