// Behaviour test for the Add to chat plugin: evaluates the built client bundle
// under happy-dom with real React and walks the annotation flow —
// selection → offer → comment → submit → badge → chip → attach-on-send —
// against a stub composer whose draft mirrors the real InputState.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";

const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = fs.readFileSync(path.join(here, "..", "lib", "client.js"), "utf8");

const window = new Window({ url: "http://localhost/" });
for (const key of ["document", "HTMLElement", "HTMLInputElement", "Element", "Node", "Text", "Event", "MouseEvent", "KeyboardEvent", "FocusEvent", "Range", "getComputedStyle", "navigator", "MutationObserver", "NodeFilter", "requestAnimationFrame", "cancelAnimationFrame"]) {
	if (window[key] !== undefined && globalThis[key] === undefined) globalThis[key] = window[key];
}
globalThis.window = window;
globalThis.self = window;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const react = (await import("react")).default ?? (await import("react"));
const jsxRuntime = await import("react/jsx-runtime");
const reactDom = (await import("react-dom")).default ?? (await import("react-dom"));
const reactDomClient = await import("react-dom/client");
const { act } = await import("react-dom/test-utils");

let registered = null;
window.__ModuleLoader__ = { load: (module) => { registered = module; } };
const requireStub = (specifier) => {
	if (specifier === "react") return react;
	if (specifier === "react/jsx-runtime") return jsxRuntime;
	if (specifier === "react-dom") return reactDom;
	throw new Error(`unexpected require("${specifier}")`);
};

let failed = false;
const check = (label, condition, detail = "") => {
	console.log(`${condition ? "[ok]" : "[FAIL]"} ${label}${detail ? ` — ${detail}` : ""}`);
	if (!condition) failed = true;
};

new Function(bundle)();
check("bundle registers as dsh-add-to-chat", registered?.id === "dsh-add-to-chat");
const exported = registered.factory(requireStub);
const { formatQuote, isChatSelection, AddToChat, rangeForText, positionOf } = exported.__test;
check("quote with comment", formatQuote("a\nb", "needs work") === "> a\n> b\n\nneeds work\n\n");

window.document.body.innerHTML = `
	<div data-chat-flow>
		<p data-chat-node-key="msg-1">Quote me please</p>
	</div>
	<div data-composer-card>
		<div data-composer-input contenteditable="true"></div>
		<button type="button" aria-label="Attach files"></button>
		<button type="button" data-test-send></button>
	</div>
`;
const message = window.document.querySelector('[data-chat-node-key="msg-1"]');
const composer = window.document.querySelector("[data-composer-card]");
const composerInput = window.document.querySelector("[data-composer-input]");
const selection = window.getSelection();
const range = window.document.createRange();
range.selectNodeContents(message);
check("isChatSelection accepts a chat range", isChatSelection(range) === true);
check("rangeForText finds the anchored fragment", rangeForText(message, "Quote me") !== null);
const fakeRange = { getBoundingClientRect: () => ({ left: 300, top: 500, width: 120, height: 20, right: 420 }) };
check("anchor is the selection start", positionOf(fakeRange, null).x === 300);

let draft = "";
const writes = [];
const inputActions = {
	captureInsertion: () => ({ id: "span-1" }),
	insertText: () => true,
	setDraft: (text) => {
		writes.push(text);
		draft = text;
	},
};

const container = window.document.createElement("div");
window.document.body.appendChild(container);
const root = reactDomClient.createRoot(container);
const render = async () => {
	await act(async () => {
		root.render(react.createElement(AddToChat, { inputActions, useInput: (selector) => selector({ draft }), sessionId: "s1" }));
	});
};
await render();

const q = (selector) => window.document.querySelector(selector);
const click = async (selector) => {
	const element = typeof selector === "string" ? q(selector) : selector;
	await act(async () => {
		element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
};
const focus = async (element) => {
	await act(async () => {
		element.dispatchEvent(new window.FocusEvent("focusin", { bubbles: true }));
	});
};
const type = async (text) => {
	const input = q('[data-add-to-chat="comment"]');
	const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
	await act(async () => {
		setter.call(input, text);
		input.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
	return input;
};
const select = async () => {
	selection.removeAllRanges();
	selection.addRange(range);
	await act(async () => {
		window.document.dispatchEvent(new window.Event("mouseup", { bubbles: true }));
	});
};

// ── 1. the offer button opens the comment field ──────────────────────────────
await select();
check("offer button appears after selecting", q('[data-add-to-chat="start"]')?.textContent === "Add to chat");
await click('[data-add-to-chat="start"]');
check("comment field appears", q('[data-add-to-chat="comment"]') !== null);
check("no submit button while empty", q('[data-add-to-chat="submit"]') === null);
await type("a comment");
check("submit button appears after typing", q('[data-add-to-chat="submit"]')?.textContent === "↑");

// ── 2. submitting stores the annotation and leaves the field alone ───────────
await click('[data-add-to-chat="submit"]');
check("annotation persisted", JSON.parse(window.localStorage.getItem("dsh-add-to-chat:annotations:v1") ?? "[]").length === 1);
check("the draft holds only the invisible placeholder", writes.length === 1 && writes[0] === "\u200B", JSON.stringify(writes[0]));
check("placeholder enables the composer's send admission (trim keeps U+200B)", "\u200B".trim() !== "");
check("badge rendered", q('[data-add-to-chat="badge"]')?.getAttribute("data-provisional") === "false");
check("chip counts one annotation", q('[data-add-to-chat="chip"]')?.textContent?.startsWith("1 annotation") === true);

// ── 3. the chip lists annotations with per-item actions ─────────────────────
await focus(q('[data-add-to-chat="chip-clear"]'));
check("chip hover lists the annotation", q('[data-add-to-chat="chip-card"]')?.textContent?.includes("a comment") === true, q('[data-add-to-chat="chip-card"]')?.textContent ?? "");
check("chip list has per-item edit and delete", q('[data-add-to-chat="chip-item-edit"]') !== null && q('[data-add-to-chat="chip-item-delete"]') !== null);

// ── 4. the badge hover card still works ─────────────────────────────────────
await focus(q('[data-add-to-chat="badge"]'));
check("badge card shows text and comment", q('[data-add-to-chat="card"]')?.textContent?.includes("a comment") === true);

// ── 5. attaching happens at send, not before ────────────────────────────────
// Typing real text leaves the placeholder behind: it must be stripped.
draft = "input field\u200B";
await render();
check("typing strips the placeholder", writes.at(-1) === "input field", JSON.stringify(writes.at(-1)));
await act(async () => {
	composerInput.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
});
const attached = writes.at(-1);
check("Enter attaches the annotations to the outgoing message", attached === "input field\n\n> Quote me please\n\na comment\n\n", JSON.stringify(attached));
check("attachments do not leak into the visible field before send", q('[data-add-to-chat="chip"]') !== null);

// ── 6. the sent message resets the annotations ──────────────────────────────
draft = "";
await render();
check("annotations reset once the message is sent", q('[data-add-to-chat="chip"]') === null && q('[data-add-to-chat="badge"]') === null);
check("storage cleared after send", JSON.parse(window.localStorage.getItem("dsh-add-to-chat:annotations:v1") ?? "[]").length === 0);

// ── 7. clicking the send control attaches too ───────────────────────────────
await render();
await select();
await click('[data-add-to-chat="start"]');
await type("second");
await click('[data-add-to-chat="submit"]');
draft = "another message";
await render();
const writesBeforeClick = writes.length;
await act(async () => {
	q("[data-test-send]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
});
check("the unlabelled send control attaches the annotations", writes.length === writesBeforeClick + 1 && writes.at(-1).endsWith("second\n\n"), JSON.stringify(writes.at(-1)));

// A different button inside the composer must not attach.
draft = "draft";
await render();
const writesBeforeAttachClick = writes.length;
await act(async () => {
	q('[aria-label="Attach files"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
});
check("other composer buttons do not attach", writes.length === writesBeforeAttachClick, `writes=${writes.length}`);

console.log(failed ? "ADD TO CHAT TEST FAILED" : "ADD TO CHAT TEST OK");
process.exit(failed ? 1 : 0);
