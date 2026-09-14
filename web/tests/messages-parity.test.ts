import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import he from "@/messages/he.json";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const placeholders = (s: string): string[] => [...s.matchAll(/\{[^}]+\}/g)].map((m) => m[0]).sort();

/** Recursively asserts en/he have the same shape (object keys, array lengths) and both hold strings at the leaves. */
function walk(path: string, a: Json, b: Json): void {
  if (Array.isArray(a) || Array.isArray(b)) {
    expect(Array.isArray(a), `${path} should be an array in both`).toBe(true);
    expect(Array.isArray(b), `${path} should be an array in both`).toBe(true);
    const arrA = a as Json[];
    const arrB = b as Json[];
    expect(arrB.length, `${path} array length mismatch`).toBe(arrA.length);
    arrA.forEach((item, i) => walk(`${path}[${i}]`, item, arrB[i]));
    return;
  }
  if (a !== null && typeof a === "object") {
    expect(b !== null && typeof b === "object" && !Array.isArray(b), `${path} should be an object in both`).toBe(true);
    const objA = a as Record<string, Json>;
    const objB = b as Record<string, Json>;
    const keysA = Object.keys(objA).sort();
    const keysB = Object.keys(objB).sort();
    expect(keysB, `${path} key set mismatch`).toEqual(keysA);
    for (const key of keysA) walk(`${path}.${key}`, objA[key], objB[key]);
    return;
  }
  expect(typeof a, `${path} should be a string leaf in en`).toBe("string");
  expect(typeof b, `${path} should be a string leaf in he`).toBe("string");
  expect(placeholders(b as string), `${path} placeholders differ`).toEqual(placeholders(a as string));
}

describe("messages parity (en/he)", () => {
  it("have identical key sets, array shapes, and {placeholder} sets", () => {
    walk("messages", en as unknown as Json, he as unknown as Json);
  });
});
