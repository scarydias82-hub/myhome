const BASE_MS = Number(process.env.REQUEST_DELAY_MS ?? 2500);

export function delay(ms = BASE_MS) {
  const jitter = Math.random() * 1000;
  return new Promise((resolve) => setTimeout(resolve, ms + jitter));
}
