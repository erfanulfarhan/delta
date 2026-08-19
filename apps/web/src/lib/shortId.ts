const ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz';

/**
 * Short, URL-safe, unguessable.
 *
 * The id is the capability: possession of it is what grants read access to a
 * result, since the table itself is not readable. 12 characters from a 32
 * character alphabet is 60 bits, far past guessing. The alphabet omits 0/o/1/l
 * so an id read aloud or copied by hand does not turn into a different one.
 */
export function shortId(length = 12): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}
