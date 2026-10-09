import { describe, expect, it } from "vitest";
import { islandConcepts, planConcepts, validatePlan } from "./plan";

describe("validatePlan", () => {
  it("rejects non-arrays and empty plans", () => {
    expect(validatePlan(null)).toBeNull();
    expect(validatePlan(undefined)).toBeNull();
    expect(validatePlan({})).toBeNull();
    expect(validatePlan([])).toBeNull();
    expect(validatePlan("plan")).toBeNull();
  });

  it("rejects islands with a non-string title", () => {
    expect(validatePlan([{ title: 42, key_concepts: ["a"] }])).toBeNull();
  });

  it("rejects islands with a non-array key_concepts", () => {
    expect(validatePlan([{ title: "Island", key_concepts: "a" }])).toBeNull();
    expect(validatePlan([{ title: "Island" }])).toBeNull();
  });

  it("rejects plans longer than the island cap", () => {
    const big = Array.from({ length: 51 }, (_, i) => ({
      title: `Island ${i}`,
      key_concepts: ["a"],
    }));
    expect(validatePlan(big)).toBeNull();
  });

  it("accepts a well-formed plan and returns it", () => {
    const plan = [
      { title: "Alpha", key_concepts: ["a", "b"] },
      { title: "Beta", key_concepts: [] },
    ];
    expect(validatePlan(plan)).toBe(plan);
  });
});

describe("islandConcepts", () => {
  const plan = [
    { title: "  Versailles  ", key_concepts: ["treaty", "reparations"] },
    { title: "Weimar", key_concepts: ["constitution"] },
  ];

  it("matches titles case-insensitively with trimming", () => {
    expect(islandConcepts(plan, "versailles")).toEqual(["treaty", "reparations"]);
    expect(islandConcepts(plan, "  VERSAILLES ")).toEqual(["treaty", "reparations"]);
  });

  it("returns [] for unknown islands and malformed plans", () => {
    expect(islandConcepts(plan, "missing")).toEqual([]);
    expect(islandConcepts(null, "Versailles")).toEqual([]);
    expect(islandConcepts("nope", "Versailles")).toEqual([]);
  });

  it("drops non-string and blank concepts", () => {
    const messy = [{ title: "X", key_concepts: ["ok", 7, "  ", null] }];
    expect(islandConcepts(messy, "x")).toEqual(["ok"]);
  });
});

describe("planConcepts", () => {
  it("collects distinct concepts across islands", () => {
    const plan = [
      { title: "A", key_concepts: ["one", "two"] },
      { title: "B", key_concepts: ["two", "three"] },
    ];
    expect(planConcepts(plan)).toEqual(["one", "two", "three"]);
  });

  it("returns [] for malformed input", () => {
    expect(planConcepts(null)).toEqual([]);
    expect(planConcepts([{ title: "A" }])).toEqual([]);
  });
});
