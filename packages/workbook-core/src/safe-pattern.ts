/** A bounded, non-backtracking subset of JavaScript patterns. No groups,
 * alternation, lookaround, backreferences, counted or lazy quantifiers.
 * Matching uses an NFA over individual UTF-16 code units, O(pattern × subject).
 */
export const PATTERN_LIMITS = Object.freeze({ patternLength: 1024, tokens: 256, subjectLength: 65_536, work: 2_000_000 });
type Token = { character: RegExp; min: 0 | 1; repeat: boolean };
type Pattern = { tokens: Token[]; start: boolean; end: boolean };
const cache = new Map<string, Pattern>();

function compile(source: string): Pattern {
  const found = cache.get(source);
  if (found) return found;
  if (source.length > PATTERN_LIMITS.patternLength) throw new Error('Pattern length budget exceeded.');
  let i = 0;
  const start = source.startsWith('^');
  if (start) i++;
  let end = false;
  const tokens: Token[] = [];
  while (i < source.length) {
    let atom = source[i++]!;
    if (atom === '$' && i === source.length) { end = true; break; }
    if (atom === '\\') {
      const escaped = source[i++];
      if (escaped === undefined || !/^[dDsSwW\\.^$*+?()[\]{}|/-]$/.test(escaped)) throw new Error('Unsupported pattern escape.');
      atom += escaped;
    } else if (atom === '[') {
      let closed = false;
      if (source[i] === '^') atom += source[i++];
      while (i < source.length) {
        const character = source[i++]!;
        atom += character;
        if (character === '\\') {
          const escaped = source[i++];
          if (escaped === undefined || !/^[dDsSwW\\\]\[\-^]$/.test(escaped)) throw new Error('Unsupported character class escape.');
          atom += escaped;
        } else if (character === ']') { closed = true; break; }
      }
      if (!closed) throw new Error('Unclosed character class.');
    } else if ('()|{}*+?^$]'.includes(atom)) {
      throw new Error('Pattern uses syntax outside the bounded subset.');
    }
    const quantifier = source[i];
    const quantified = quantifier === '*' || quantifier === '+' || quantifier === '?';
    if (quantified) i++;
    tokens.push({ character: new RegExp(`^(?:${atom})$`), min: quantifier === '*' || quantifier === '?' ? 0 : 1, repeat: quantifier === '*' || quantifier === '+' });
    if (tokens.length > PATTERN_LIMITS.tokens) throw new Error('Pattern token budget exceeded.');
  }
  const pattern = { tokens, start, end };
  if (cache.size >= 256) cache.delete(cache.keys().next().value!);
  cache.set(source, pattern);
  return pattern;
}

export function patternProblem(source: string): string | undefined {
  try { compile(source); return undefined; }
  catch (error) { return (error as Error).message; }
}

export interface PatternBudget { remaining: number }
export function testSafePattern(source: string, subject: string, budget?: PatternBudget): boolean {
  const { tokens, start, end } = compile(source);
  if (subject.length > PATTERN_LIMITS.subjectLength || (subject.length + 1) * (tokens.length + 1) > PATTERN_LIMITS.work) {
    throw new Error('Pattern matching resource budget exceeded.');
  }
  const work = (subject.length + 1) * (tokens.length + 1);
  if (budget) {
    if (work > budget.remaining) throw new Error('Cumulative pattern matching resource budget exceeded.');
    budget.remaining -= work;
  }
  const close = (states: Set<number>) => {
    for (let j = 0; j < tokens.length; j++) if (states.has(j) && tokens[j]!.min === 0) states.add(j + 1);
  };
  let states = new Set([0]);
  for (let position = 0; position <= subject.length; position++) {
    if (!start) states.add(0);
    close(states);
    const atEnd = position === subject.length;
    if (states.has(tokens.length) && (!end || atEnd)) return true;
    if (position === subject.length) break;
    const next = new Set<number>();
    for (const j of states) {
      const token = tokens[j];
      if (!token || !token.character.test(subject[position]!)) continue;
      next.add(j + 1);
      if (token.repeat) next.add(j);
    }
    states = next;
  }
  return false;
}
