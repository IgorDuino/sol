import assert from "node:assert/strict";
import { test } from "bun:test";
import {
	evaluateCalculatorQuery as evaluate,
	formatExpressionResult as format,
	normalizeCalculatorQuery,
} from "./calculator";

for (const [query, expected] of [
	["(3.5 * 10 * 3000) - 6%", 98700],
	["(3,5 × 10 × 3 000) − 6％", 98700],
	["6%", 0.06],
	["200 + 10%", 220],
	["200 - 10%", 180],
	["200 * 10%", 20],
	["200 / 10%", 2000],
	["200 + (5 + 5)%", 220],
	["200 - (10%)", 180],
	["200 + -10%", 180],
	["200 - -10%", 220],
	["100 + 10% + 10%", 121],
	["100 - 10% - 10%", 81],
	["10% + 5%", 0.15],
	["100 + (5% + 5%)", 110],
	["(200 - 10%) * 2", 360],
	["100 + 10% * 2", 100.2],
	["(100 + 10%) * (1 + 20%)", 132],
	["2 + 3 * 4", 14],
	["(2 + 3) * 4", 20],
	["2(3 + 4)", 14],
	["(2+3)(4+5)", 45],
	["2^3^2", 512],
	["-2^2", -4],
	["(-2)^2", 4],
	["2^-2", 0.25],
	["2**3", 8],
	["3² + 2³", 17],
	["5!", 120],
	["3,5 * 10", 35],
	["1.234,56 + 1", 1235.56],
	["1,234.56 + 1", 1235.56],
	["1\u202f234,5 + 2,5", 1237],
	["12 × 3 ÷ 2 − 1", 17],
	["sqrt(9) + abs(-2)", 5],
	["√9 + sqrt 16", 7],
	["sqrt(2,25)", 1.5],
	["min(2,3) + max(2,3)", 5],
	["pow(2,3)", 8],
	["roundTo(1.2345,2)", 1.23],
	["sin(PI / 2)", 1],
	["2pi", 2 * Math.PI],
	["2π", 2 * Math.PI],
	["1e3 + 2e-2", 1000.02],
	["0", 0],
	["-5 + 5", 0],
	["if(2 > 1, 3, 4)", 3],
	["min([1,2,3])", 1],
]) {
	test(`${query} = ${expected}`, () => {
		const actual = evaluate(query);
		assert.notEqual(actual, null);
		assert.ok(
			Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-12,
			`${actual} != ${expected}`,
		);
	});
}

for (const query of [
	"",
	" ",
	"(3.5 * 10) -",
	"200 + %",
	"(1 + 2",
	"2 + 2)",
	"2 3",
	"10 % 3",
	"1 / 0",
	"0/0",
	"sqrt(-1)",
	"10^1000",
	"hello",
	"1 + banana",
	"foo(2)",
	"x=2",
	"1;2",
	"2".repeat(2049),
]) {
	test(`invalid or non-finite expression has no result: ${query.slice(0, 35)}`, () => {
		assert.equal(evaluate(query), null);
	});
}

test("formatting suppresses floating-point noise without erasing small or large numbers", () => {
	assert.equal(format(evaluate("0.1+0.2")), "0.3");
	assert.equal(format(evaluate("0,1+0,2"), "0,1+0,2"), "0,3");
	assert.equal(format(1e-15), "1e-15");
	assert.equal(format(1e301), "1e+301");
	assert.equal(format(Number.MAX_SAFE_INTEGER), "9007199254740991");
	assert.equal(format(-0), "0");
	assert.equal(format(evaluate("pow(2,0.5)"), "pow(2,0.5)"), "1.4142135623731");
});

test("commas in function argument lists stay separators", () => {
	assert.equal(normalizeCalculatorQuery("max(2,3)"), "max(2,3)");
	assert.equal(normalizeCalculatorQuery("3,5 + max(2,3)"), "3.5 + max(2,3)");
	assert.equal(evaluate("3,5 + max(2,3)"), 6.5);
});
