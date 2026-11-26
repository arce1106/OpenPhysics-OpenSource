// A small browser-safe fallback for environments without crypto.subtle.
const constants: number[] = [];
const initial: number[] = [];
for (let candidate = 2; constants.length < 64; candidate += 1) {
  let prime = true;
  for (let divisor = 2; divisor * divisor <= candidate; divisor += 1) {
    if (candidate % divisor === 0) {
      prime = false;
      break;
    }
  }
  if (!prime)
    continue;
  if (initial.length < 8)
    initial.push((Math.sqrt(candidate) * 0x100000000) | 0);
  constants.push((Math.cbrt(candidate) * 0x100000000) | 0);
}
const rotate = (value: number, amount: number) => (value >>> amount) | (value << (32 - amount));
export function sha256(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const length = Math.ceil((bytes.length + 9) / 64) * 64;
  const buffer = new Uint8Array(length);
  buffer.set(bytes);
  buffer[bytes.length] = 0x80;
  const view = new DataView(buffer.buffer);
  view.setUint32(length - 8, Math.floor(bytes.length * 8 / 0x100000000));
  view.setUint32(length - 4, bytes.length * 8 >>> 0);
  const hash = [...initial];
  const words = new Int32Array(64);
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i += 1)
      words[i] = view.getInt32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const x = words[i - 15], y = words[i - 2];
      words[i] = words[i - 16] + (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3))
        + words[i - 7] + (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10));
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i += 1) {
      const first = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25))
        + ((e & f) ^ (~e & g)) + constants[i] + words[i]) | 0;
      const second = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22))
        + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      [a, b, c, d, e, f, g, h] = [(first + second) | 0, a, b, c, (d + first) | 0, e, f, g];
    }
    [a, b, c, d, e, f, g, h].forEach((part, i) => { hash[i] = (hash[i] + part) | 0; });
  }
  return hash.map(part => (part >>> 0).toString(16).padStart(8, '0')).join('');
}
