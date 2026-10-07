// Saved settings and counts. localStorage can throw or come back empty
// (private mode, blocked storage), so values also live in memory: the page
// keeps working for the visit even when nothing can be saved.
const memory = new Map();
const listeners = new Set();

export const store = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      if (value !== null) return value;
    } catch {}
    return memory.get(key) ?? fallback;
  },
  set(key, value) {
    memory.set(key, value);
    try {
      localStorage.setItem(key, value);
    } catch {}
    for (const fn of listeners) fn(key, value);
  },
  remove(key) {
    memory.delete(key);
    try {
      localStorage.removeItem(key);
    } catch {}
  },
  // Called with (key, value) after every set, e.g. to mirror saves elsewhere.
  onSet(fn) {
    listeners.add(fn);
  },
};
