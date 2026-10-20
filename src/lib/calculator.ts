import { Parser } from "expr-eval";

const parser = new Parser({
	allowMemberAccess: false,
	operators: { assignment: false, fndef: false },
});
const unaryFunctions = new Set(Object.keys(parser.unaryOps));
// A separate function keeps the base expression evaluated exactly once.
parser.functions.addPercent = (base: number, fraction: number) =>
	base + base * fraction;
parser.functions.subtractPercent = (base: number, fraction: number) =>
	base - base * fraction;

function normalizeInput(query: string) {
	let decimalComma = false;
	const source = query
		.replace(/[×✕⋅·]/g, "*")
		.replace(/÷/g, "/")
		.replace(/[−–—]/g, "-")
		.replace(/％/g, "%")
		.replace(/\*\*/g, "^")
		.replace(/π/g, "PI")
		.replace(/√/g, "sqrt ")
		.replace(/[²³]/g, (power) => (power === "²" ? "^2" : "^3"))
		.replace(/\b\d{1,3}(?:[ \u00a0\u202f]\d{3})+\b/g, (number) =>
			number.replace(/\s/g, ""),
		);

	// Commas separate arguments in multi-argument functions (max(2,3));
	// elsewhere they are decimal separators (3,5 and sqrt(2,25)).
	const decimalCommaContexts = [true];
	const expression = source.replace(
		/[a-zA-Z_]\w*\s*\(|[()]|(?:\d[\d.,]*|\.\d+)/g,
		(token) => {
			if (token.endsWith("(")) {
				const name = token.slice(0, -1).trim();
				decimalCommaContexts.push(
					name
						? unaryFunctions.has(name)
						: decimalCommaContexts[decimalCommaContexts.length - 1] === true,
				);
			} else if (token === ")") {
				if (decimalCommaContexts.length > 1) decimalCommaContexts.pop();
			} else if (decimalCommaContexts[decimalCommaContexts.length - 1]) {
				if (/^\d{1,3}(?:\.\d{3})+,\d+$/.test(token)) {
					decimalComma = true;
					return token.replace(/\./g, "").replace(",", ".");
				}
				if (/^\d{1,3}(?:,\d{3})+\.\d+$/.test(token))
					return token.replace(/,/g, "");
				if (/^\d+,\d+$/.test(token)) {
					decimalComma = true;
					return token.replace(",", ".");
				}
			}
			return token;
		},
	);
	return { expression, decimalComma };
}

export function normalizeCalculatorQuery(query: string): string {
	return normalizeInput(query).expression;
}

type Operand = { expression: string; percent: boolean };
const operand = (expression: string, percent = false): Operand => ({
	expression,
	percent,
});
const isNumber = (token = "") =>
	/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(token);
const isName = (token = "") => /^[a-zA-Z_]\w*$/.test(token);

// Translate calculator syntax into expr-eval's public expression API. Percent
// is postfix; on the right of + or - it changes the left amount proportionally.
// Parentheses, unary signs, precedence, and function arguments stay explicit.
function calculatorExpression(source: string) {
	const tokens =
		source.match(
			/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[a-zA-Z_]\w*|[^\s]/gi,
		) ?? [];
	let position = 0;
	const peek = () => tokens[position];
	const take = () => tokens[position++];
	const expect = (token: string) => {
		if (take() !== token) throw new Error("Incomplete expression");
	};

	function sum(): Operand {
		let left = product();
		while (peek() === "+" || peek() === "-") {
			const operator = take();
			const right = product();
			left =
				right.percent && !left.percent
					? operand(
							`${operator === "+" ? "addPercent" : "subtractPercent"}(${left.expression},${right.expression})`,
						)
					: operand(
							`(${left.expression}${operator}${right.expression})`,
							left.percent && right.percent,
						);
		}
		return left;
	}

	function product(): Operand {
		let left = unary();
		while (
			peek() === "*" ||
			peek() === "/" ||
			peek() === "(" ||
			isName(peek())
		) {
			const operator = peek() === "*" || peek() === "/" ? take() : "*";
			const right = unary();
			left = operand(`(${left.expression}${operator}${right.expression})`);
		}
		return left;
	}

	function unary(): Operand {
		if (peek() === "+" || peek() === "-") {
			const sign = take();
			const value = unary();
			return operand(`(${sign}${value.expression})`, value.percent);
		}
		// Preserve expr-eval's prefix math functions, such as sqrt 9.
		if (
			isName(peek()) &&
			unaryFunctions.has(peek()) &&
			tokens[position + 1] !== "("
		) {
			const name = take();
			return operand(`${name}(${unary().expression})`);
		}
		let left = postfix();
		if (peek() === "^") {
			take();
			left = operand(`(${left.expression}^${unary().expression})`);
		}
		return left;
	}

	function postfix(): Operand {
		let value = atom();
		while (peek() === "%" || peek() === "!") {
			value =
				take() === "%"
					? operand(`(${value.expression}/100)`, true)
					: operand(`(${value.expression}!)`);
		}
		return value;
	}

	function atom(): Operand {
		const token = take();
		if (token === "(") {
			const value = sum();
			expect(")");
			return value;
		}
		if (isNumber(token)) return operand(token);
		if (!isName(token)) throw new Error("Expected a number or math function");
		if (peek() !== "(")
			return operand(token === "pi" ? "PI" : token === "e" ? "E" : token);
		take();
		const args: string[] = [];
		if (peek() !== ")") {
			args.push(sum().expression);
			while (peek() === ",") {
				take();
				args.push(sum().expression);
			}
		}
		expect(")");
		return operand(`${token}(${args.join(",")})`);
	}

	const result = sum();
	if (position !== tokens.length) throw new Error("Unexpected input");
	return result.expression;
}

export function evaluateCalculatorQuery(query: string): number | null {
	if (!query.trim() || query.length > 2048) return null;
	try {
		const source = normalizeCalculatorQuery(query);
		if (source.includes(";")) return null;
		let result: unknown;
		if (source.includes("%")) {
			result = parser.evaluate(calculatorExpression(source));
		} else {
			try {
				// Preserve the existing engine's full syntax for ordinary expressions.
				result = parser.evaluate(source);
			} catch {
				// Calculator conveniences such as 2(3+4) and 2pi need translation.
				result = parser.evaluate(calculatorExpression(source));
			}
		}
		return typeof result === "number" && Number.isFinite(result)
			? result
			: null;
	} catch {
		// An incomplete expression is normal while typing; show no stale result.
		return null;
	}
}

export function formatExpressionResult(value: number, query = "") {
	if (!Number.isFinite(value)) return value.toString();
	// Keep small numbers and large integers; hide floating-point arithmetic noise.
	const text = (
		Number.isInteger(value) ? value : Number(value.toPrecision(15))
	).toString();
	return normalizeInput(query).decimalComma ? text.replace(".", ",") : text;
}
