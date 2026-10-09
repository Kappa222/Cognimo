import { describe, expect, it } from "vitest";
import { capText, chunkText, normalizeTitle } from "./chunks";

describe("chunkText", () => {
  it("returns [] for empty or blank input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("keeps a short text in one chunk", () => {
    expect(chunkText("hello")).toEqual(["hello"]);
  });

  it("hard-splits a single oversized paragraph", () => {
    const chunks = chunkText("a".repeat(250), 100, 20);
    expect(chunks).toHaveLength(4);
    expect(chunks.every((c) => c.length > 0)).toBe(true);
    expect(chunks[0]).toBe("a".repeat(100));
  });

  it("splits paragraphs across chunks without losing content", () => {
    const paras = ["első bekezdés tartalma", "második bekezdés tartalma", "harmadik bekezdés tartalma"];
    const chunks = chunkText(paras.join("\n\n"), 40, 10);
    expect(chunks.length).toBeGreaterThan(1);
    for (const p of paras) {
      expect(chunks.some((c) => c.includes(p.slice(0, 10)))).toBe(true);
    }
  });
});

describe("capText", () => {
  it("returns short texts unchanged", () => {
    expect(capText("abc", 10)).toBe("abc");
    expect(capText("abc", 3)).toBe("abc");
  });

  it("truncates long texts with the Hungarian marker", () => {
    const capped = capText("x".repeat(100), 10);
    expect(capped.startsWith("x".repeat(10))).toBe(true);
    expect(capped).toContain("rövidítve");
  });
});

describe("normalizeTitle", () => {
  it("trims and lowercases", () => {
    expect(normalizeTitle("  Versailles ")).toBe("versailles");
    expect(normalizeTitle("Weimar")).toBe("weimar");
  });
});
