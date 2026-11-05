import { describe, expect, it } from "vitest";
import { containsWord, editDistance, isCloseGuess, isCorrectGuess, normalizeGuess, sanitizeText } from "@inkwave/shared";
import { drawerPoints, guesserPoints, rankScores } from "../src/game/scoring";
import { hintCount, hintSchedule, letterIndices, maskWord, pickHintIndex } from "../src/game/hints";
import { containsProfanity, maskProfanity } from "../src/game/profanity";
import { WORD_LISTS, parseCustomWords, pickWordChoices } from "../src/game/words";
import { applySettingsPatch } from "../src/game/settings";
import { DEFAULT_SETTINGS } from "@inkwave/shared";

describe("word matching", () => {
  it("is case-insensitive, trims whitespace and ignores accents", () => {
    expect(isCorrectGuess("  GiRaFFe ", "giraffe")).toBe(true);
    expect(isCorrectGuess("cafe", "café")).toBe(true);
    expect(isCorrectGuess("Piña", "pina")).toBe(true);
    expect(isCorrectGuess("niño", "nino")).toBe(true);
  });
  it("ignores spaces and hyphens inside multi-word answers", () => {
    expect(isCorrectGuess("ice cream", "ice cream")).toBe(true);
    expect(isCorrectGuess("icecream", "ice cream")).toBe(true);
    expect(isCorrectGuess("paru paro", "paru-paro")).toBe(true);
  });
  it("rejects wrong and empty guesses", () => {
    expect(isCorrectGuess("", "cat")).toBe(false);
    expect(isCorrectGuess("!!!", "cat")).toBe(false);
    expect(isCorrectGuess("cats", "cat")).toBe(false);
  });
  it("computes edit distance", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("abc", "abc")).toBe(0);
    expect(editDistance("abc", "abcd")).toBe(1);
    expect(editDistance("abcdef", "a", 1)).toBe(2); // early exit
  });
  it("flags guesses one edit away as close", () => {
    expect(isCloseGuess("girafe", "giraffe")).toBe(true); // deletion
    expect(isCloseGuess("giraffes", "giraffe")).toBe(true); // insertion
    expect(isCloseGuess("giraffo", "giraffe")).toBe(true); // substitution
    expect(isCloseGuess("Giraffe", "giraffe")).toBe(false); // correct, not close
    expect(isCloseGuess("grafe", "giraffe")).toBe(false); // two edits
    expect(isCloseGuess("ox", "ax")).toBe(false); // too short to hint
  });
  it("detects the word hidden inside a drawer message", () => {
    expect(containsWord("it's a big GIRAFFE lol", "giraffe")).toBe(true);
    expect(containsWord("g i r a f f e", "giraffe")).toBe(true);
    expect(containsWord("nice drawing", "giraffe")).toBe(false);
  });
  it("normalizes text", () => {
    expect(normalizeGuess(" Crème-Brûlée ")).toBe("cremebrulee");
  });
});

describe("text sanitizing", () => {
  it("strips control and zero-width characters and caps length", () => {
    expect(sanitizeText("he\u0000llo​  world\n", 50)).toBe("he llo world");
    expect(sanitizeText("abcdefghij", 4)).toBe("abcd");
    expect(sanitizeText(42, 10)).toBe("");
  });
});

describe("scoring", () => {
  it("rewards faster guesses", () => {
    expect(guesserPoints(60_000, 60_000, 0)).toBe(350);
    expect(guesserPoints(30_000, 60_000, 0)).toBe(225);
    expect(guesserPoints(0, 60_000, 0)).toBe(100);
    expect(guesserPoints(30_000, 60_000, 0)).toBeGreaterThan(guesserPoints(10_000, 60_000, 0));
  });
  it("rewards earlier guess order", () => {
    const t = [0, 1, 2, 3, 4, 5, 9].map((o) => guesserPoints(30_000, 60_000, o));
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeLessThanOrEqual(t[i - 1]);
    expect(t[0] - t[5]).toBe(50);
    expect(guesserPoints(0, 60_000, 9)).toBe(50); // never below the floor
  });
  it("clamps out-of-range time", () => {
    expect(guesserPoints(-5, 60_000, 0)).toBe(100);
    expect(guesserPoints(999_999, 60_000, 0)).toBe(350);
  });
  it("pays the drawer by share of guessers", () => {
    expect(drawerPoints(0, 4)).toBe(0);
    expect(drawerPoints(2, 4)).toBe(125);
    expect(drawerPoints(4, 4)).toBe(250);
    expect(drawerPoints(1, 0)).toBe(0);
  });
  it("ranks ties together", () => {
    const r = rankScores([
      { id: "a", score: 10 },
      { id: "b", score: 30 },
      { id: "c", score: 30 },
      { id: "d", score: 5 },
    ]);
    expect(r.map((x) => [x.id, x.rank])).toEqual([
      ["b", 1],
      ["c", 1],
      ["a", 3],
      ["d", 4],
    ]);
  });
});

describe("hints", () => {
  it("masks letters but keeps spaces and hyphens", () => {
    expect(maskWord("ice cream", new Set())).toBe("___ _____");
    expect(maskWord("paru-paro", new Set([0]))).toBe("p___-____");
    expect(letterIndices("a b-c")).toEqual([0, 2, 4]);
  });
  it("never reveals more than half the letters", () => {
    expect(hintCount("cat", 5)).toBe(1);
    expect(hintCount("elephant", 5)).toBe(4);
    expect(hintCount("elephant", 2)).toBe(2);
    expect(hintCount("ox", 0)).toBe(0);
  });
  it("spaces hints evenly through the turn", () => {
    expect(hintSchedule(60_000, 2)).toEqual([20_000, 40_000]);
    expect(hintSchedule(80_000, 3)).toEqual([20_000, 40_000, 60_000]);
    expect(hintSchedule(60_000, 0)).toEqual([]);
  });
  it("only reveals unrevealed letters", () => {
    const revealed = new Set<number>();
    const word = "bus stop";
    for (let i = 0; i < 7; i++) {
      const idx = pickHintIndex(word, revealed)!;
      expect(idx).not.toBe(3); // the space
      expect(revealed.has(idx)).toBe(false);
      revealed.add(idx);
    }
    expect(pickHintIndex(word, revealed)).toBeNull();
  });
});

describe("profanity filter", () => {
  it("catches common words and disguises", () => {
    expect(containsProfanity("shit")).toBe(true);
    expect(containsProfanity("sh1t head")).toBe(true);
    expect(containsProfanity("f u c k")).toBe(true);
    expect(containsProfanity("Putangina")).toBe(true);
    expect(containsProfanity("gago")).toBe(true);
  });
  it("leaves innocent words alone", () => {
    for (const ok of ["class", "Scunthorpe", "assassin", "Dickens", "grape", "thorny", "leche flan", "Mika"]) {
      expect(containsProfanity(ok), ok).toBe(false);
    }
  });
  it("masks only the offending word", () => {
    expect(maskProfanity("you are a bitch!")).toBe("you are a *****!");
    expect(maskProfanity("nice drawing")).toBe("nice drawing");
  });
});

describe("word lists", () => {
  for (const [code, list] of Object.entries(WORD_LISTS)) {
    it(`${code} has 300+ unique, filter-clean words in three tiers`, () => {
      const all = [...list.easy, ...list.medium, ...list.hard];
      expect(list.easy.length).toBeGreaterThan(50);
      expect(list.medium.length).toBeGreaterThan(50);
      expect(list.hard.length).toBeGreaterThan(50);
      expect(all.length).toBeGreaterThanOrEqual(300);
      expect(new Set(all).size).toBe(all.length);
      for (const w of all) expect(containsProfanity(w), w).toBe(false);
    });
  }

  it("parses custom words", () => {
    expect(parseCustomWords(" Cat, dog,,cat , hot  dog ")).toEqual(["cat", "dog", "hot dog"]);
  });

  it("picks distinct choices and avoids used words", () => {
    const used = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const c = pickWordChoices(DEFAULT_SETTINGS, 5, used);
      expect(c).toHaveLength(5);
      expect(new Set(c).size).toBe(5);
      for (const w of c) {
        expect(used.has(w)).toBe(false);
        used.add(w);
      }
    }
  });

  it("uses custom words only when asked", () => {
    const s = { ...DEFAULT_SETTINGS, customWords: "alpha, beta, gamma", customOnly: true };
    for (let i = 0; i < 20; i++) for (const w of pickWordChoices(s, 3, new Set())) expect(["alpha", "beta", "gamma"]).toContain(w);
  });

  it("joins two words in combination mode", () => {
    const s = { ...DEFAULT_SETTINGS, wordMode: "combination" as const, customWords: "red, blue, green, gold", customOnly: true };
    const c = pickWordChoices(s, 3, new Set());
    for (const w of c) {
      const [a, b] = w.split(" ");
      expect(a).not.toBe(b);
      expect(["red", "blue", "green", "gold"]).toContain(a);
      expect(["red", "blue", "green", "gold"]).toContain(b);
    }
  });
});

describe("settings", () => {
  it("clamps every number and rejects junk", () => {
    const s = applySettingsPatch(DEFAULT_SETTINGS, { maxPlayers: 99, rounds: 0, drawTime: "30", wordChoices: 9, hints: -1, wordMode: "evil", language: "xx" }, 1);
    expect(s).toMatchObject({ maxPlayers: 20, rounds: 2, drawTime: 30, wordChoices: 5, hints: 0, wordMode: "normal", language: "en" });
  });
  it("never sets max players below the current count", () => {
    expect(applySettingsPatch(DEFAULT_SETTINGS, { maxPlayers: 2 }, 6).maxPlayers).toBe(6);
  });
});
