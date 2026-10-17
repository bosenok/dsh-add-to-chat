(function(g){try{if(typeof g.process==="undefined")g.process={env:{NODE_ENV:"production"}}}catch(e){}})(typeof window!=="undefined"?window:globalThis);
// Client half of the dsh-add-to-chat plugin.
//
// The annotation flow over the conversation flow, mirroring the reference UX:
//   1. select text            → a small "Add to chat" button at the selection start;
//   2. click it               → the comment field plus a provisional numbered badge;
//   3. type anything          → the round submit button appears;
//   4. submit                 → the annotation is saved and its block lands in the composer;
//   5. hover the badge        → a card with the selected text and the comment;
//   6. click the badge        → the editor with delete, Cancel and Save.
// A chip above the composer counts the session's annotations and clears them.
// Composer changes go through the composer's own InputActions, and the live
// selection is never modified by this plugin.
window.__ModuleLoader__.load({
	id: "dsh-add-to-chat",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		let react = require("react");
		let jsx = require("react/jsx-runtime");
		let reactDom = require("react-dom");

		const OFFER_LABEL = "Add to chat";
		const CHAT_FLOW_SELECTOR = "[data-chat-flow]";
		const CHAT_NODE_SELECTOR = "[data-chat-node-key]";
		const COMPOSER_SELECTOR = "[data-composer-card]";
		const COMPOSER_INPUT_SELECTOR = "[data-composer-input]";
		const STORAGE_KEY = "dsh-add-to-chat:annotations:v1";
		const COUNTER_KEY = "dsh-add-to-chat:counter:v1";
		const PANEL_WIDTH = 340;
		/** Invisible placeholder that keeps the composer's send control enabled. */
		const ZWSP = "\u200B";

		/**
		 * Render one selection as a markdown blockquote ready for the composer,
		 * optionally followed by the user's comment about that fragment.
		 * Pure: exercised directly by the tests.
		 */
		function formatQuote(text, comment) {
			const body = String(text ?? "")
				.replace(/\r\n?/gu, "\n")
				.replace(/[ \t]+$/gmu, "")
				.replace(/\n{3,}/gu, "\n\n")
				.trim();
			if (body.length === 0) return "";
			const quoted = body
				.split("\n")
				.map((line) => (line.length === 0 ? ">" : `> ${line}`))
				.join("\n");
			const note = String(comment ?? "").trim();
			return note.length === 0 ? `${quoted}\n\n` : `${quoted}\n\n${note}\n\n`;
		}

		/** Whether this range belongs to a chat message rather than the chrome. */
		function isChatSelection(range) {
			const node = range?.startContainer;
			const element = node == null ? null : node.nodeType === 1 ? node : node.parentElement;
			if (element == null || typeof element.closest !== "function") return false;
			if (element.closest(COMPOSER_SELECTOR) !== null) return false;
			return element.closest(CHAT_FLOW_SELECTOR) !== null;
		}

		/**
		 * Viewport anchor for one range: the START of the selection (where the
		 * button and panel open) plus the END (where the badge sits).
		 */
		function positionOf(range, element) {
			let rect = typeof range?.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
			if (rect == null || (rect.width === 0 && rect.height === 0)) {
				rect = typeof element?.getBoundingClientRect === "function" ? element.getBoundingClientRect() : null;
			}
			if (rect == null || (rect.width === 0 && rect.height === 0)) return { x: 24, y: 96, endX: 48 };
			return { x: rect.left, y: Math.max(rect.top, 12), endX: rect.right };
		}

		/** Keep a fixed-width panel on screen while hugging its anchor. */
		function clampLeft(x, width) {
			const viewportWidth = typeof window !== "undefined" && Number.isFinite(window.innerWidth) ? window.innerWidth : 1024;
			return Math.min(Math.max(x, 8), Math.max(viewportWidth - width - 8, 8));
		}

		/** Stable identity of the message element a selection starts in. */
		function nodeKeyOf(element) {
			const holder = typeof element?.closest === "function" ? element.closest(CHAT_NODE_SELECTOR) : null;
			return holder?.getAttribute?.("data-chat-node-key") ?? "";
		}

		/** Read the current document selection as an annotation candidate, or null. */
		function readSelection() {
			const selection = typeof window !== "undefined" && typeof window.getSelection === "function" ? window.getSelection() : null;
			if (selection == null || selection.isCollapsed === true || selection.rangeCount === 0) return null;
			const range = selection.getRangeAt(0);
			if (isChatSelection(range) === false) return null;
			const text = String(selection.toString() ?? "").trim();
			if (text.length === 0) return null;
			const node = range.startContainer;
			const element = node == null ? null : node.nodeType === 1 ? node : node.parentElement;
			return { text, nodeKey: nodeKeyOf(element), ...positionOf(range, element) };
		}

		/** Identity of one selection, used to keep a dismissed panel dismissed. */
		function signatureOf(selection) {
			return selection == null ? null : `${selection.nodeKey}\u0000${selection.text}`;
		}

		/**
		 * Locate `text` inside one message element and return a DOM Range, so a
		 * badge can be positioned without mutating React-owned content.
		 */
		function rangeForText(root, text) {
			if (root == null || typeof text !== "string" || text.length === 0) return null;
			const showText = typeof window !== "undefined" && window.NodeFilter != null ? window.NodeFilter.SHOW_TEXT : 4;
			if (typeof window?.document?.createTreeWalker !== "function") return null;
			const walker = window.document.createTreeWalker(root, showText);
			const nodes = [];
			let combined = "";
			for (let node = walker.nextNode(); node != null; node = walker.nextNode()) {
				nodes.push({ node, start: combined.length });
				combined += node.nodeValue ?? "";
			}
			const index = combined.indexOf(text);
			if (index < 0) return null;
			const locate = (offset) => {
				for (let i = nodes.length - 1; i >= 0; i--) {
					if (offset >= nodes[i].start) return { node: nodes[i].node, offset: offset - nodes[i].start };
				}
				return null;
			};
			const from = locate(index);
			const to = locate(index + text.length);
			if (from == null || to == null) return null;
			try {
				const range = window.document.createRange();
				range.setStart(from.node, Math.min(from.offset, (from.node.nodeValue ?? "").length));
				range.setEnd(to.node, Math.min(to.offset, (to.node.nodeValue ?? "").length));
				return range;
			} catch {
				return null;
			}
		}

		/** Load persisted annotations, tolerating any storage failure. */
		function loadAnnotations() {
			try {
				const raw = window.localStorage?.getItem(STORAGE_KEY);
				const parsed = raw ? JSON.parse(raw) : [];
				return Array.isArray(parsed) ? parsed.filter((entry) => entry != null && typeof entry.id === "string") : [];
			} catch {
				return [];
			}
		}

		/** Persist annotations, tolerating any storage failure. */
		function storeAnnotations(list) {
			try {
				window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(list));
			} catch {
				// storage unavailable: annotations stay in memory
			}
		}

		/** Highest annotation number ever used per session, so numbers never repeat. */
		function loadCounters() {
			try {
				const parsed = JSON.parse(window.localStorage?.getItem(COUNTER_KEY) ?? "{}");
				return parsed != null && typeof parsed === "object" ? parsed : {};
			} catch {
				return {};
			}
		}

		function storeCounters(counters) {
			try {
				window.localStorage?.setItem(COUNTER_KEY, JSON.stringify(counters));
			} catch {
				// storage unavailable: numbering falls back to the live list
			}
		}

		function AddToChat(props) {
			const inputActions = props?.inputActions;
			const useInput = props?.useInput;
			const sessionId = props?.sessionId ?? "";
			const draft = typeof useInput === "function" ? useInput((state) => state?.draft) : undefined;

			const [annotations, setAnnotations] = react.useState(() => loadAnnotations());
			/** "idle" | "offer" | "compose" | "edit" */
			const [mode, setMode] = react.useState("idle");
			const [target, setTarget] = react.useState(null);
			const [comment, setComment] = react.useState("");
			const [editingId, setEditingId] = react.useState(null);
			const [hoverId, setHoverId] = react.useState(null);
			const [badges, setBadges] = react.useState([]);
			// The chip lives ABOVE the composer card, never inside its text area.
			const [chipPos, setChipPos] = react.useState(null);
			const [chipHover, setChipHover] = react.useState(false);
			const inputRef = react.useRef(null);
			// Signature of a selection the user dismissed by clicking away.
			const suppressed = react.useRef(null);

			const mine = react.useMemo(() => annotations.filter((entry) => entry.sessionId === sessionId), [annotations, sessionId]);
			const nextNumber = react.useMemo(() => {
				const counters = loadCounters();
				const used = mine.map((entry) => Number(entry.number) || 0);
				return Math.max(Number(counters[sessionId]) || 0, ...used, 0) + 1;
			}, [mine, sessionId]);

			// Selection tracking: the panel opens when a gesture finishes, and the
			// live selection is never touched here.
			react.useEffect(() => {
				const refresh = () => {
					if (mode !== "idle" && mode !== "offer") return;
					try {
						const next = readSelection();
						if (next != null && suppressed.current === signatureOf(next)) return;
						if (next == null) suppressed.current = null;
						setTarget(next);
						setMode(next == null ? "idle" : "offer");
					} catch {
						setTarget(null);
						setMode("idle");
					}
				};
				const dismiss = () => {
					if (mode !== "offer") return;
					setTarget(null);
					setMode("idle");
				};
				document.addEventListener("mouseup", refresh);
				document.addEventListener("keyup", refresh);
				window.addEventListener("scroll", dismiss, true);
				window.addEventListener("resize", dismiss);
				return () => {
					document.removeEventListener("mouseup", refresh);
					document.removeEventListener("keyup", refresh);
					window.removeEventListener("scroll", dismiss, true);
					window.removeEventListener("resize", dismiss);
				};
			}, [mode]);

			react.useEffect(() => {
				if (mode !== "compose" && mode !== "edit") return;
				const timer = setTimeout(() => inputRef.current?.focus?.(), 0);
				return () => clearTimeout(timer);
			}, [mode]);

			// Badge geometry: saved annotations anchor to their text, the compose
			// badge to the live selection end. React-owned DOM is never mutated.
			react.useEffect(() => {
				if (mine.length === 0 && mode !== "compose") {
					setBadges([]);
					return;
				}
				let frame = 0;
				const recompute = () => {
					frame = 0;
					const flow = document.querySelector(CHAT_FLOW_SELECTOR);
					const next = [];
					for (const entry of mine) {
						if (flow == null) continue;
						const message = entry.nodeKey ? flow.querySelector(`${CHAT_NODE_SELECTOR}[data-chat-node-key="${entry.nodeKey}"]`) ?? flow : flow;
						const range = rangeForText(message, entry.text);
						const rect = range?.getBoundingClientRect?.();
						const box = rect != null && (rect.width > 0 || rect.height > 0) ? rect : message.getBoundingClientRect?.();
						if (box == null) continue;
						const right = Number.isFinite(box.right) && box.right !== 0 ? box.right : box.left + box.width;
						// Two annotations can anchor to the same spot: stagger so both
						// badges stay visible and countable.
						let point = { x: Math.min(right + 6, (window.innerWidth || 1024) - 30), y: box.top };
						while (next.some((other) => Math.abs(other.y - point.y) < 20 && Math.abs(other.x - point.x) < 24) && point.y < (window.innerHeight || 800)) {
							point = { ...point, y: point.y + 24 };
						}
						next.push({ id: entry.id, number: entry.number, x: point.x, y: point.y, provisional: false });
					}
					if (mode === "compose" && target != null) {
						next.push({ id: "compose", number: nextNumber, x: Math.min((target.endX ?? target.x) + 6, (window.innerWidth || 1024) - 30), y: target.y, provisional: true });
					}
					setBadges(next);
					// Anchor the chip just above the composer card.
					const composer = document.querySelector(COMPOSER_SELECTOR);
					const rect = composer?.getBoundingClientRect?.();
					setChipPos(rect != null && rect.width > 0 ? { left: rect.left + 8, top: Math.max(rect.top - 46, 8) } : { left: 16, top: 16 });
				};
				const schedule = () => {
					if (frame !== 0) return;
					frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(recompute) : setTimeout(recompute, 16);
				};
				recompute();
				const flow = document.querySelector(CHAT_FLOW_SELECTOR);
				const observer = typeof MutationObserver === "function" && flow != null ? new MutationObserver(schedule) : null;
				observer?.observe(flow, { childList: true, subtree: true, characterData: true });
				window.addEventListener("scroll", schedule, true);
				window.addEventListener("resize", schedule);
				const timer = setInterval(schedule, 1000);
				return () => {
					observer?.disconnect();
					window.removeEventListener("scroll", schedule, true);
					window.removeEventListener("resize", schedule);
					clearInterval(timer);
				};
			}, [mine, mode, target, nextNumber]);


			/**
			/**
			 * Annotations never sit in the visible draft: the chip stands for them
			 * and their blocks are appended to the outgoing message at send time.
			 */
			const attachToDraft = react.useCallback(() => {
				if (mine.length === 0) return false;
				const current = typeof draft === "string" ? draft.split(ZWSP).join("") : "";
				const blocks = [...mine]
					.sort((a, b) => a.number - b.number)
					.map((entry) => entry.payload)
					.join("");
				if (blocks.length === 0) return false;
				const body = current.trim().length === 0 ? blocks : `${current.trimEnd()}\n\n${blocks}`;
				try {
					inputActions?.setDraft?.(body);
					return true;
				} catch (error) {
					console.error("add-to-chat: attaching annotations failed", error);
					return false;
				}
			}, [draft, inputActions, mine]);

			// The composer admits a send when `draft.trim() !== ""`, and U+200B
			// survives trim while staying invisible: with it the send control is
			// enabled for an annotation-only message, and the field still looks
			// empty. It disappears as soon as real text is typed.
			react.useEffect(() => {
				if (typeof draft !== "string") return;
				const bare = draft.split(ZWSP).join("");
				if (mine.length > 0 && bare.trim().length === 0 && draft.includes(ZWSP) === false) {
					inputActions?.setDraft?.(draft + ZWSP);
				} else if (draft.includes(ZWSP) && (mine.length === 0 || bare.trim().length > 0)) {
					inputActions?.setDraft?.(bare);
				}
			}, [draft, inputActions, mine.length]);

			// Send interception: the composer submits with Enter (its documented
			// shortcut) or the send control. Annotations are appended to the draft
			// in the same tick, so the outgoing message carries them while the
			// visible field stays clean.
			const pendingAttach = react.useRef(false);
			react.useEffect(() => {
				if (mine.length === 0) return;
				const inComposer = (node) => (typeof node?.closest === "function" ? node.closest(COMPOSER_SELECTOR) : null);
				const looksLikeSend = (button) => {
					if (button == null || button.getAttribute("aria-haspopup") !== null) return false;
					if (button.closest("[data-composer-chip]") !== null) return false;
					const label = `${button.getAttribute("aria-label") ?? ""} ${button.getAttribute("title") ?? ""}`;
					if (/send|发送|submit/iu.test(label)) return true;
					// Structural fallback for an unlabelled icon control: the send
					// button is the last plain, enabled button of the composer bar.
					const card = button.closest(COMPOSER_SELECTOR);
					if (card == null) return false;
					const candidates = [...card.querySelectorAll("button")].filter(
						(candidate) =>
							candidate.getAttribute("aria-haspopup") === null &&
							candidate.closest("[data-composer-chip]") === null &&
							candidate.closest("[data-add-to-chat]") === null &&
							candidate.disabled !== true,
					);
					return candidates.length > 0 && candidates[candidates.length - 1] === button;
				};
				const onKeyDown = (event) => {
					if (event.key !== "Enter" || event.shiftKey === true || event.isComposing === true) return;
					if (inComposer(event.target) === null) return;
					if (attachToDraft()) pendingAttach.current = true;
				};
				const onClick = (event) => {
					if (inComposer(event.target) === null) return;
					const button = typeof event.target?.closest === "function" ? event.target.closest("button") : null;
					if (button == null || button.closest('[data-add-to-chat]') !== null) return;
					if (looksLikeSend(button) === false) return;
					if (attachToDraft()) pendingAttach.current = true;
				};
				document.addEventListener("keydown", onKeyDown, true);
				document.addEventListener("click", onClick, true);
				return () => {
					document.removeEventListener("keydown", onKeyDown, true);
					document.removeEventListener("click", onClick, true);
				};
			}, [attachToDraft, mine.length]);

			// A sent message empties the draft; that is when the annotations have
			// served their purpose and the chip resets for the next message.
			react.useEffect(() => {
				if (pendingAttach.current === false) return;
				if (typeof draft === "string" && draft.trim().length > 0) return;
				pendingAttach.current = false;
				const next = annotations.filter((entry) => entry.sessionId !== sessionId);
				setAnnotations(next);
				storeAnnotations(next);
				setHoverId(null);
			}, [annotations, draft, sessionId]);

			const reset = react.useCallback(() => {
				setMode("idle");
				setTarget(null);
				setComment("");
				setEditingId(null);
			}, []);

			/** Step 2: the offer button opens the comment field. */
			const startCompose = react.useCallback(() => {
				if (target == null) return;
				setComment("");
				setEditingId(null);
				setMode("compose");
			}, [target]);

			/** Step 4: commit the annotation. */
			const submit = react.useCallback(() => {
				if (target == null) return;
				const note = comment.trim();
				if (note.length === 0) return; // the submit button only exists after typing
				const payload = formatQuote(target.text, note);
				const counters = loadCounters();
				const number = nextNumber;
				storeCounters({ ...counters, [sessionId]: number });
				const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
				const next = [...annotations, { id, number, sessionId, nodeKey: target.nodeKey, text: target.text, comment: note, payload }];
				setAnnotations(next);
				storeAnnotations(next);
				reset();
				try {
					document.querySelector(COMPOSER_INPUT_SELECTOR)?.focus?.();
				} catch {
					// focus is best effort
				}
			}, [annotations, comment, nextNumber, reset, sessionId, target]);

			/** Step 6: the editor's Save. */
			const saveEdit = react.useCallback(() => {
				const existing = annotations.find((entry) => entry.id === editingId);
				if (existing != null) {
					const payload = formatQuote(existing.text, comment);
					const next = annotations.map((entry) => (entry.id === editingId ? { ...entry, comment: comment.trim(), payload } : entry));
					setAnnotations(next);
					storeAnnotations(next);
				}
				reset();
			}, [annotations, comment, editingId, reset]);

			const removeOne = react.useCallback(
				(id) => {
					const existing = annotations.find((entry) => entry.id === id);
					if (existing != null) {
						const next = annotations.filter((entry) => entry.id !== id);
						setAnnotations(next);
						storeAnnotations(next);
					}
					reset();
				},
				[annotations, reset],
			);

			const clearAll = react.useCallback(() => {
				const next = annotations.filter((entry) => entry.sessionId !== sessionId);
				setAnnotations(next);
				storeAnnotations(next);
				setHoverId(null);
				reset();
			}, [annotations, mine, reset, sessionId]);

			const openEditor = react.useCallback(
				(entry) => {
					setEditingId(entry.id);
					setComment(entry.comment ?? "");
					setTarget({ text: entry.text, nodeKey: entry.nodeKey, x: entry.x ?? 24, y: entry.y ?? 96, endX: entry.x ?? 24 });
					setMode("edit");
					setHoverId(null);
				},
				[],
			);

			// Clicking outside the panel dismisses it without touching selection.
			react.useEffect(() => {
				if (mode !== "compose" && mode !== "edit") return;
				const onOutsidePointerDown = (event) => {
					const node = event?.target;
					if (typeof node?.closest === "function" && (node.closest('[data-add-to-chat="root"]') !== null || node.closest('[data-add-to-chat="badge"]') !== null)) return;
					suppressed.current = signatureOf(target);
					reset();
				};
				document.addEventListener("mousedown", onOutsidePointerDown, true);
				document.addEventListener("touchstart", onOutsidePointerDown, true);
				return () => {
					document.removeEventListener("mousedown", onOutsidePointerDown, true);
					document.removeEventListener("touchstart", onOutsidePointerDown, true);
				};
			}, [mode, reset, target]);

			const buttonStyle = {
				font: "inherit",
				fontSize: "12px",
				lineHeight: "1",
				padding: "7px 12px",
				borderRadius: "999px",
				border: "1px solid #3a3a3a",
				background: "#2f2f2f",
				color: "#e8e8e8",
				cursor: "pointer",
			};
			const roundStyle = { ...buttonStyle, width: "34px", height: "34px", padding: 0, borderRadius: "999px", display: "inline-flex", alignItems: "center", justifyContent: "center" };

			// Step 1: the offer button.
			const offer =
				mode !== "offer" || target == null
					? null
					: reactDom.createPortal(
							jsx.jsx("div", {
								"data-add-to-chat": "offer",
								style: { position: "fixed", left: `${clampLeft(target.x, 160)}px`, top: `${Math.max(target.y - 44, 8)}px`, zIndex: 2147483000 },
								onMouseDown: (event) => event.preventDefault(),
								children: jsx.jsx("button", { type: "button", "data-add-to-chat": "start", onClick: startCompose, style: buttonStyle, children: OFFER_LABEL }, "start"),
							}),
							document.body,
						);

			// Steps 2–3 and 6: the comment panel.
			const composing = mode === "compose" || mode === "edit";
			const filled = comment.trim().length > 0;
			const panel =
				!composing || target == null
					? null
					: reactDom.createPortal(
							jsx.jsx("div", {
								"data-add-to-chat": "root",
								style: {
									position: "fixed",
									left: `${clampLeft(target.x, PANEL_WIDTH)}px`,
									top: `${Math.max(target.y - 116, 8)}px`,
									zIndex: 2147483000,
									display: "flex",
									alignItems: "center",
									gap: "8px",
									width: `${PANEL_WIDTH}px`,
									boxSizing: "border-box",
									padding: "10px 10px 10px 14px",
									borderRadius: "999px",
									border: "1px solid #3a3a3a",
									background: "#242424",
									boxShadow: "0 10px 30px rgba(0, 0, 0, 0.55)",
								},
								onMouseDown: (event) => event.preventDefault(),
								children: [
									mode === "edit"
										? jsx.jsx("button", {
												type: "button",
												"data-add-to-chat": "delete",
												title: "Delete annotation",
												onClick: () => removeOne(editingId),
												style: { ...buttonStyle, border: "none", background: "transparent", padding: "4px 6px", fontSize: "14px" },
												children: "🗑",
											}, "delete")
										: null,
									jsx.jsx("input", {
										ref: inputRef,
										type: "text",
										"data-add-to-chat": "comment",
										value: comment,
										placeholder: "Add an optional comment...",
										onChange: (event) => setComment(event.target.value),
										onKeyDown: (event) => {
											if (event.key === "Enter") {
												event.preventDefault();
												if (mode === "edit") saveEdit();
												else submit();
											} else if (event.key === "Escape") {
												event.preventDefault();
												reset();
											}
										},
										style: { font: "inherit", fontSize: "13px", flex: "1", minWidth: 0, border: "none", outline: "none", background: "transparent", color: "#e8e8e8" },
									}, "comment"),
									mode === "edit"
										? jsx.jsx("button", { type: "button", "data-add-to-chat": "cancel", onClick: reset, style: buttonStyle, children: "Cancel" }, "cancel")
										: null,
									mode === "edit"
										? jsx.jsx("button", { type: "button", "data-add-to-chat": "save", onClick: saveEdit, style: { ...buttonStyle, background: "#f5f5f5", color: "#111", borderColor: "#f5f5f5", fontWeight: 600 }, children: "Save" }, "save")
										: filled
											? jsx.jsx("button", {
													type: "button",
													"data-add-to-chat": "submit",
													title: "Add to chat",
													onClick: submit,
													style: { ...roundStyle, background: "#f5f5f5", color: "#111", borderColor: "#f5f5f5", fontWeight: 700 },
													children: "↑",
												}, "submit")
											: null,
								],
							}),
							document.body,
						);

			// Step 5: the hover card and the click-through to the editor.
			const badgeLayer = reactDom.createPortal(
				jsx.jsx("div", {
					"data-add-to-chat": "badges",
					style: { position: "fixed", left: "0", top: "0", width: "0", height: "0", pointerEvents: "none", zIndex: 2147482000 },
					children: badges.map((badge) => {
						const entry = annotations.find((item) => item.id === badge.id);
						const card =
							hoverId === badge.id && entry != null
								? jsx.jsx("div", {
										"data-add-to-chat": "card",
										style: {
											position: "absolute",
											left: `${Math.min(badge.x + 26, (window.innerWidth || 1024) - 380)}px`,
											top: `${badge.y - 8}px`,
											width: "340px",
											pointerEvents: "auto",
											border: "1px solid #3a3a3a",
											borderRadius: "14px",
											background: "#242424",
											padding: "12px 14px",
											boxShadow: "0 10px 30px rgba(0, 0, 0, 0.55)",
											color: "#e8e8e8",
											fontSize: "12px",
										},
										children: [
											jsx.jsx("div", {
												key: "head",
												style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" },
												children: [
													jsx.jsx("span", { key: "n", style: { fontWeight: 700 }, children: `${entry.number}. Selected text:` }, "n"),
													jsx.jsx("span", {
														key: "actions",
														children: [
															jsx.jsx("button", {
																type: "button",
																"data-add-to-chat": "card-edit",
																title: "Edit annotation",
																onClick: () => openEditor({ ...entry, x: badge.x, y: badge.y }),
																style: { ...buttonStyle, border: "none", background: "transparent", padding: "2px 6px" },
																children: "✏️",
															}, "edit"),
															jsx.jsx("button", {
																type: "button",
																"data-add-to-chat": "card-delete",
																title: "Delete annotation",
																onClick: () => removeOne(entry.id),
																style: { ...buttonStyle, border: "none", background: "transparent", padding: "2px 6px" },
																children: "🗑",
															}, "del"),
														],
													}, "actions"),
												],
											}, "head"),
											jsx.jsx("div", { key: "text", style: { color: "#cfcfcf", marginBottom: "8px" }, children: entry.text }, "text"),
											jsx.jsx("div", { key: "label", style: { color: "#9a9a9a", marginBottom: "2px" }, children: "User comment:" }, "label"),
											jsx.jsx("div", { key: "comment", children: entry.comment }, "comment"),
										],
									})
								: null;
						return jsx.jsx("div", {
							key: badge.id,
							style: { position: "absolute", left: `${badge.x}px`, top: `${badge.y}px`, pointerEvents: "auto" },
							onMouseEnter: () => setHoverId(badge.provisional ? null : badge.id),
							onMouseLeave: () => setHoverId((current) => (current === badge.id ? null : current)),
							children: [
								jsx.jsx("button", {
									type: "button",
									"data-add-to-chat": "badge",
									"data-badge-number": String(badge.number),
									"data-provisional": badge.provisional ? "true" : "false",
									onMouseDown: (event) => event.preventDefault(),
									onFocus: () => setHoverId(badge.provisional ? null : badge.id),
									onBlur: () => setHoverId((current) => (current === badge.id ? null : current)),
									onClick: () => {
										if (badge.provisional) return;
										if (entry != null) openEditor({ ...entry, x: badge.x, y: badge.y });
									},
									style: {
										width: "22px",
										height: "22px",
										borderRadius: "999px",
										border: "1px solid #1b1b1b",
										background: badge.provisional ? "#3f6fd8" : "#4f8ef7",
										opacity: badge.provisional ? 0.75 : 1,
										color: "#fff",
										font: "inherit",
										fontSize: "11px",
										fontWeight: 700,
										cursor: badge.provisional ? "default" : "pointer",
										padding: 0,
									},
									children: String(badge.number),
								}, "dot"),
								card,
							],
						}, badge.id);
					}),
				}),
				document.body,
			);

			// Step 7: the composer chip, floating above the composer card, that
			// counts the annotations and lists them with per-item actions.
			const chipRow = (entry) =>
				jsx.jsx("div", {
					key: entry.id,
					"data-add-to-chat": "chip-item",
					style: { display: "flex", alignItems: "flex-start", gap: "8px", padding: "6px 0", borderTop: "1px solid #2f2f2f" },
					children: [
						jsx.jsx("span", { key: "n", style: { color: "#9a9a9a", minWidth: "16px" }, children: `${entry.number}.` }, "n"),
						jsx.jsx("div", {
							key: "body",
							style: { flex: "1", minWidth: 0 },
							children: [
								jsx.jsx("div", { key: "text", style: { color: "#cfcfcf", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: entry.text }, "text"),
								jsx.jsx("div", { key: "comment", style: { color: "#8f8f8f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: entry.comment }, "comment"),
							],
						}, "body"),
						jsx.jsx("button", {
							key: "edit",
							type: "button",
							"data-add-to-chat": "chip-item-edit",
							title: "Edit annotation",
							onClick: () => openEditor({ ...entry, x: chipPos?.left ?? 24, y: (chipPos?.top ?? 96) + 60 }),
							style: { ...buttonStyle, border: "none", background: "transparent", padding: "0 4px" },
							children: "✏️",
						}, "edit"),
						jsx.jsx("button", {
							key: "delete",
							type: "button",
							"data-add-to-chat": "chip-item-delete",
							title: "Delete annotation",
							onClick: () => removeOne(entry.id),
							style: { ...buttonStyle, border: "none", background: "transparent", padding: "0 4px" },
							children: "🗑",
						}, "del"),
					],
				});

			const chip =
				mine.length === 0 || chipPos == null
					? null
					: reactDom.createPortal(
							jsx.jsx("div", {
							"data-add-to-chat": "chip-wrap",
							style: { position: "fixed", left: `${chipPos.left}px`, top: `${chipPos.top}px`, zIndex: 2147482500, pointerEvents: "auto" },
							onMouseEnter: () => setChipHover(true),
							onMouseLeave: () => setChipHover(false),
							// Keyboard users reach the same list by focusing the chip.
							onFocus: () => setChipHover(true),
							onBlur: () => setChipHover(false),
							children: [
								chipHover
									? jsx.jsx("div", {
											key: "card",
											"data-add-to-chat": "chip-card",
											style: {
												position: "absolute",
												left: "0",
												bottom: "34px",
												width: "380px",
												maxHeight: "320px",
												overflowY: "auto",
												border: "1px solid #3a3a3a",
												borderRadius: "14px",
												background: "#242424",
												padding: "10px 14px",
												boxShadow: "0 10px 30px rgba(0, 0, 0, 0.55)",
												color: "#e8e8e8",
												fontSize: "12px",
											},
											children: [
												jsx.jsx("div", { key: "head", style: { color: "#9a9a9a" }, children: `${mine.length} annotation${mine.length === 1 ? "" : "s"}` }, "head"),
												...[...mine].sort((a, b) => a.number - b.number).map(chipRow),
											],
										}, "card")
									: null,
								jsx.jsx("div", {
									key: "chip",
									"data-add-to-chat": "chip",
									style: {
										display: "inline-flex",
										alignItems: "center",
										gap: "8px",
										padding: "6px 12px",
										borderRadius: "10px",
										border: "1px solid #3a3a3a",
										background: "#242424",
										color: "#cfcfcf",
										fontSize: "12px",
									},
							children: [
								jsx.jsx("span", { key: "label", children: `${mine.length} annotation${mine.length === 1 ? "" : "s"}` }, "label"),
								jsx.jsx("button", {
									type: "button",
									"data-add-to-chat": "chip-clear",
									title: "Clear annotations",
									onClick: clearAll,
									style: { ...buttonStyle, padding: "0 6px", border: "none", background: "transparent", fontSize: "13px", lineHeight: "1.2" },
									children: "×",
								}, "clear"),
									],
								}, "chip"),
							],
						}),
					document.body,
				);

			return jsx.jsx(react.Fragment, { children: [chip, offer, panel, badgeLayer] });
		}

		function apply(ctx) {
			ctx.slots.inject("conversation.input.overlay", () =>
				ctx.slots.register(
					{
						name: "conversation.input.overlay",
						id: "add-to-chat",
						order: 40,
						label: OFFER_LABEL,
					},
					AddToChat,
				),
			);
		}

		exports.apply = apply;
		exports.inject = ["slots"];
		exports.__test = { AddToChat, formatQuote, isChatSelection, loadAnnotations, nodeKeyOf, positionOf, rangeForText, readSelection, signatureOf, storeAnnotations };
		return module.exports;
	},
});
