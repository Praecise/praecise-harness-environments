// What Praecise Control does inside a page, for a browser that gives an extension no
// debugger. The page is read as a screen reader would be told of it, worked out here
// from the page itself, and acted on with the events a page script can make.
//
// Those events are not a person's. A click and a change to a field do what a person's
// would. A key does not: the page is told of it and the browser does nothing more. The
// few keys with an obvious meaning are carried out by hand, and a chord that is not one
// of them is refused, not pretended.
//
// What a password field holds is never read.

(() => {
  if (globalThis.__praeciseControl) return;

  class Refused extends Error {}
  const refuse = (message) => {
    throw new Refused(message);
  };

  const WORKED = new Set(["button", "link", "textbox", "searchbox", "combobox", "checkbox", "switch", "radio", "tab", "slider", "spinbutton", "menuitem", "option"]);
  const TYPED = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);
  const NAMED_BY_CONTENT = new Set(["button", "link", "heading", "tab", "menuitem", "option", "checkbox", "radio", "switch"]);
  const SKIPPED = new Set(["script", "style", "noscript", "template", "head", "meta", "link", "title"]);
  const INPUTS = { button: "button", submit: "button", reset: "button", image: "button", checkbox: "checkbox", radio: "radio", range: "slider", number: "spinbutton", search: "searchbox", hidden: "" };

  const refs = new Map();
  const named = new WeakMap();
  let counted = 0;
  let pointer = { x: 0, y: 0 };

  const tidy = (text) => (text || "").replace(/\s+/g, " ").trim();
  const isElement = (node) => node.nodeType === 1;

  function roleOf(node) {
    if (!isElement(node)) return "text";
    const said = tidy(node.getAttribute("role")).split(" ")[0];
    if (said && said !== "presentation" && said !== "none") return said;
    const tag = node.localName;
    if (tag === "a" || tag === "area") return node.hasAttribute("href") ? "link" : "";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "input") {
      const kind = (node.getAttribute("type") || "text").toLowerCase();
      return kind in INPUTS ? INPUTS[kind] : "textbox";
    }
    if (tag === "textarea") return "textbox";
    if (tag === "select") return "combobox";
    if (tag === "option") return "option";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "img") return "image";
    if (node.isContentEditable && !(node.parentElement && node.parentElement.isContentEditable)) return "textbox";
    return "";
  }

  function nameOf(node, role) {
    if (!isElement(node)) return tidy(node.nodeValue);
    const label = tidy(node.getAttribute("aria-label"));
    if (label) return label;
    const by = tidy(node.getAttribute("aria-labelledby"));
    if (by) {
      const text = tidy(by.split(" ").map((id) => { const found = node.getRootNode().getElementById?.(id); return found ? found.textContent : ""; }).join(" "));
      if (text) return text;
    }
    if (node.labels && node.labels.length) {
      const text = tidy([...node.labels].map((each) => [...each.childNodes].filter((child) => child !== node && !(isElement(child) && child.contains(node))).map((child) => child.textContent).join(" ")).join(" "));
      if (text) return text;
    }
    if (node.localName === "img" || node.localName === "area") return tidy(node.getAttribute("alt")) || tidy(node.getAttribute("title"));
    if (node.localName === "input" && ["button", "submit", "reset"].includes(node.type)) return tidy(node.value) || node.type;
    if (NAMED_BY_CONTENT.has(role)) {
      const text = tidy(node.innerText ?? node.textContent).slice(0, 200);
      if (text) return text;
    }
    return tidy(node.getAttribute("title")) || tidy(node.getAttribute("placeholder"));
  }

  function valueOf(node, role) {
    if (!isElement(node) || !TYPED.has(role) && role !== "slider") return "";
    if (node.localName === "input" && node.type === "password") return "";
    if (node.localName === "select") return tidy(node.selectedOptions[0] ? node.selectedOptions[0].textContent : "");
    if ("value" in node && typeof node.value === "string") return node.value;
    return node.isContentEditable ? tidy(node.innerText) : "";
  }

  function statesOf(node, role) {
    if (!isElement(node) || !(WORKED.has(role) || role === "row" || role === "treeitem")) return [];
    const states = [];
    const is = (attribute, value = "true") => node.getAttribute(attribute) === value;
    if (node.disabled || is("aria-disabled")) states.push("disabled");
    if (deepActive() === node) states.push("focused");
    if (node.indeterminate || is("aria-checked", "mixed")) states.push("partly checked");
    else if ((node.localName === "input" && node.checked) || is("aria-checked")) states.push("checked");
    if (is("aria-pressed")) states.push("pressed");
    if (is("aria-expanded")) states.push("expanded");
    else if (is("aria-expanded", "false")) states.push("collapsed");
    if (node.selected || is("aria-selected")) states.push("selected");
    if (node.required || is("aria-required")) states.push("required");
    if (is("aria-invalid")) states.push("invalid");
    return states;
  }

  function rectOf(node) {
    if (isElement(node)) return node.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getBoundingClientRect();
  }

  function shown(node) {
    if (!isElement(node)) return true;
    if (node.hidden || node.getAttribute("aria-hidden") === "true") return false;
    if (node.checkVisibility) return node.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true });
    const style = getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function refFor(node, role, name) {
    let ref = named.get(node);
    if (!ref) named.set(node, (ref = `ref_${++counted}`));
    refs.set(ref, { node: new WeakRef(node), role, name });
    return ref;
  }

  function describe(node, role = roleOf(node), name = nameOf(node, role)) {
    const out = { ref: refFor(node, role, name), role };
    if (name) out.name = name;
    const value = valueOf(node, role);
    if (value && value !== name) out.value = value.slice(0, 2000);
    const states = statesOf(node, role);
    if (states.length) out.states = states;
    const box = rectOf(node);
    if (box.width >= 1 && box.height >= 1) out.box = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
    return out;
  }

  /** What is inside a node, with what is in a component's own tree where the page lets it be seen. */
  const inside = (node) => (isElement(node) && node.shadowRoot ? [...node.shadowRoot.childNodes] : [...node.childNodes]);

  function read({ filter, depth, ref } = {}) {
    const interactive = filter === "interactive";
    const flat = [];
    function walk(node, level, within) {
      if (node.nodeType === 3) {
        const text = tidy(node.nodeValue);
        // A button named for its label holds that label again inside it; once is enough.
        if (!text || (within && within.includes(text)) || interactive) return [];
        return [describe(node, "text", text)];
      }
      if (!isElement(node) || SKIPPED.has(node.localName) || !shown(node)) return [];
      const role = roleOf(node);
      const below = (next, name) => inside(node).flatMap((child) => walk(child, next, name));
      if (!role) return below(level, within);
      const name = nameOf(node, role);
      const out = describe(node, role, name);
      if (interactive) {
        if (WORKED.has(role)) flat.push(out);
        if (!TYPED.has(role)) below(level + 1, name);
        return [];
      }
      // What a field holds is its value, and is not listed again as text inside it.
      if (!TYPED.has(role) && (depth === undefined || level < depth)) {
        const children = below(level + 1, name);
        if (children.length) out.children = children;
      }
      return [out];
    }
    if (ref) {
      const from = live(ref);
      const tree = walk(from, 1, "");
      return interactive ? flat : tree;
    }
    const page = { ref: refFor(document.documentElement, "page", document.title), role: "page", name: document.title };
    const children = depth === undefined || depth > 1 || interactive ? walk(document.body, 2, "") : [];
    if (interactive) return flat;
    if (children.length) page.children = children;
    if (!page.name) delete page.name;
    return [page];
  }

  /** The node a reference names, as it is now. One that has gone or become something else is refused. */
  function live(ref) {
    const known = refs.get(ref) ?? refuse(`${ref} is not a reference this page has given; read the page again`);
    const node = known.node.deref();
    if (!node || !node.isConnected || !shown(isElement(node) ? node : node.parentElement)) refuse(`${ref} is no longer on the page; read the page again`);
    if (known.role === "page") return node;
    const role = roleOf(node);
    const name = nameOf(node, role);
    if (role !== known.role || name !== known.name) refuse(`${ref} is no longer on the page (it is now ${role}${name ? ` ${JSON.stringify(name)}` : ""}); read the page again`);
    return node;
  }

  function locate({ ref }) {
    const node = live(ref);
    const target = isElement(node) ? node : node.parentElement;
    const box = rectOf(node);
    if (box.bottom < 0 || box.top > innerHeight || box.right < 0 || box.left > innerWidth) target.scrollIntoView({ block: "center", inline: "center" });
    const out = describe(node);
    if (!out.box) refuse(`${ref} takes up no room on the page; read the page again`);
    return out;
  }

  function deepActive() {
    let active = document.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
    return active;
  }

  function under({ x, y }) {
    if (!(x >= 0 && y >= 0 && x < innerWidth && y < innerHeight)) refuse(`[${x}, ${y}] is outside the page as it is shown`);
    pointer = { x, y };
    let found = document.elementFromPoint(x, y);
    while (found && found.shadowRoot && found.shadowRoot.elementFromPoint(x, y) && found.shadowRoot.elementFromPoint(x, y) !== found) found = found.shadowRoot.elementFromPoint(x, y);
    return found ?? refuse(`nothing is at [${x}, ${y}]`);
  }

  function activate({ ref }) {
    const node = live(ref);
    const target = isElement(node) ? node : node.parentElement;
    if (target.disabled || target.getAttribute("aria-disabled") === "true") refuse(`${ref} is disabled`);
    if (typeof target.focus === "function") target.focus({ preventScroll: true });
    target.click();
    return null;
  }

  /** Put a value in a field the way typing would: through the field's own setter, then telling the page. */
  function put(field, value) {
    const proto = field.localName === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(field, value);
    field.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fill({ ref, value }) {
    if (typeof value !== "string") refuse("`value` is what the field should hold");
    const node = live(ref);
    const role = roleOf(node);
    if (!TYPED.has(role)) refuse(`${ref} is a ${role}, which is not typed into; press it and choose`);
    if (node.disabled || node.readOnly) refuse(`${ref} is ${node.disabled ? "disabled" : "not to be changed"}`);
    node.focus({ preventScroll: true });
    if (node.localName === "select") {
      const wanted = [...node.options].find((each) => tidy(each.textContent) === tidy(value) || each.value === value) ?? refuse(`${ref} has no choice called ${JSON.stringify(value)}`);
      node.value = wanted.value;
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (node.localName === "input" || node.localName === "textarea") {
      put(node, value);
    } else {
      getSelection().selectAllChildren(node);
      if (!document.execCommand("insertText", false, value) && value) refuse(`${ref} refused the value`);
    }
    return null;
  }

  function mouse(target, type, { x, y }, more = {}) {
    const Kind = type.startsWith("pointer") && globalThis.PointerEvent ? PointerEvent : MouseEvent;
    return target.dispatchEvent(new Kind(type, { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, ...more }));
  }

  function click({ at, button = "left", count = 1, modifiers = [] }) {
    const target = under(at);
    const held = { shiftKey: modifiers.includes("shift"), ctrlKey: modifiers.includes("ctrl") || modifiers.includes("control"), altKey: modifiers.includes("alt"), metaKey: ["cmd", "command", "super", "meta"].some((each) => modifiers.includes(each)) };
    const which = { left: 0, middle: 1, right: 2 }[button] ?? 0;
    const focusable = target.closest("a[href], button, input, select, textarea, [tabindex], [contenteditable='true'], [contenteditable='']");
    for (let nth = 1; nth <= Math.max(1, Math.min(3, count)); nth++) {
      const more = { button: which, detail: nth, ...held };
      mouse(target, "pointerdown", at, more);
      mouse(target, "mousedown", at, more);
      if (focusable && nth === 1) focusable.focus({ preventScroll: true });
      mouse(target, "pointerup", at, more);
      mouse(target, "mouseup", at, more);
      if (which === 0) mouse(target, "click", at, more);
      else if (which === 2) mouse(target, "contextmenu", at, more);
      if (which === 0 && nth === 2) mouse(target, "dblclick", at, more);
    }
    return null;
  }

  function move({ to }) {
    const target = under(to);
    mouse(target, "pointermove", to);
    mouse(target, "mouseover", to);
    mouse(target, "mousemove", to);
    return null;
  }

  function scroll({ at, by = {} }) {
    let target = under(at);
    const scrolls = (node) => {
      const style = getComputedStyle(node);
      return (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) || (/(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth);
    };
    while (target && target !== document.documentElement && !scrolls(target)) target = target.parentElement;
    (target && target !== document.documentElement && target !== document.body ? target : window).scrollBy((by.dx || 0) * 100, (by.dy || 0) * 100);
    return null;
  }

  function insert(text) {
    const field = deepActive();
    if (!field || field === document.body) refuse("nothing on the page has the keyboard; click a field first");
    if (field.localName === "input" || field.localName === "textarea") {
      if (field.disabled || field.readOnly) refuse("the field that has the keyboard cannot be changed");
      const start = field.selectionStart ?? field.value.length;
      const end = field.selectionEnd ?? field.value.length;
      put(field, field.value.slice(0, start) + text + field.value.slice(end));
      try { field.setSelectionRange(start + text.length, start + text.length); } catch { /* a kind of field with no caret to place */ }
    } else if (field.isContentEditable) {
      if (!document.execCommand("insertText", false, text)) refuse("the page refused the text");
    } else refuse("what has the keyboard is not typed into");
  }

  function keyed(field, key, more = {}) {
    const told = { key, bubbles: true, cancelable: true, composed: true, ...more };
    const went = field.dispatchEvent(new KeyboardEvent("keydown", told));
    field.dispatchEvent(new KeyboardEvent("keyup", told));
    return went;
  }

  function type({ text }) {
    if (typeof text !== "string") refuse("`text` is what to type");
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    lines.forEach((line, nth) => {
      if (nth > 0) {
        const field = deepActive();
        if (field && (field.localName === "textarea" || field.isContentEditable)) insert("\n");
        else key({ combo: "Return" });
      }
      if (line) insert(line);
    });
    return null;
  }

  const NAMES = { return: "Enter", enter: "Enter", kp_enter: "Enter", tab: "Tab", escape: "Escape", esc: "Escape", backspace: "Backspace", delete: "Delete", space: " ", home: "Home", end: "End", pageup: "PageUp", page_up: "PageUp", pagedown: "PageDown", page_down: "PageDown", left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown", arrowleft: "ArrowLeft", arrowright: "ArrowRight", arrowup: "ArrowUp", arrowdown: "ArrowDown" };

  function key({ combo }) {
    const parts = tidy(combo).split("+").map((part) => part.trim()).filter(Boolean);
    if (!parts.length) refuse("`combo` is the key to press");
    const last = parts.pop();
    const held = parts.map((part) => part.toLowerCase());
    const field = deepActive() || document.body;
    const commanding = held.some((each) => ["ctrl", "control", "cmd", "command", "meta", "super"].includes(each));
    const name = NAMES[last.toLowerCase()] ?? (last.length === 1 ? last : /^f\d{1,2}$/i.test(last) ? last.toUpperCase() : refuse(`"${last}" in "${combo}" is not a key this page script knows`));
    const more = { shiftKey: held.includes("shift"), ctrlKey: held.includes("ctrl") || held.includes("control"), altKey: held.includes("alt"), metaKey: ["cmd", "command", "meta", "super"].some((each) => held.includes(each)) };

    if (commanding || more.altKey) {
      // Select all is the one command carried out here. Any other would only be told to the page, and the browser would do nothing.
      if (commanding && !more.altKey && name.toLowerCase() === "a") {
        keyed(field, name, more);
        if (typeof field.select === "function") field.select();
        else if (field.isContentEditable) getSelection().selectAllChildren(field);
        return null;
      }
      refuse(`"${combo}" cannot be pressed from inside a page as a person presses it; use what the page offers for it`);
    }
    // The page is told first, and may take the key for itself.
    if (!keyed(field, name, more)) return null;
    if (name === "Enter") {
      if (field.localName === "textarea" || field.isContentEditable) insert("\n");
      else if (field.localName === "input" && field.form) field.form.requestSubmit ? field.form.requestSubmit() : field.form.submit();
      else if (field !== document.body && typeof field.click === "function") field.click();
    } else if (name === " " && field !== document.body && ["button", "checkbox", "radio", "switch"].includes(roleOf(field))) {
      field.click();
    } else if (name === "Tab") {
      const stops = [...document.querySelectorAll("a[href], button, input, select, textarea, [tabindex]")].filter((each) => each.tabIndex >= 0 && !each.disabled && shown(each));
      const at = stops.indexOf(field);
      const next = stops[(at + (more.shiftKey ? -1 : 1) + stops.length) % stops.length];
      if (next) next.focus();
    } else if (name === "Backspace" || name === "Delete") {
      if (field.localName === "input" || field.localName === "textarea") {
        let start = field.selectionStart ?? field.value.length;
        let end = field.selectionEnd ?? field.value.length;
        if (start === end) name === "Backspace" ? (start = Math.max(0, start - 1)) : (end = Math.min(field.value.length, end + 1));
        put(field, field.value.slice(0, start) + field.value.slice(end));
        try { field.setSelectionRange(start, start); } catch { /* a kind of field with no caret to place */ }
      } else if (field.isContentEditable) document.execCommand(name === "Backspace" ? "delete" : "forwardDelete");
    } else if (name.length === 1) {
      insert(more.shiftKey ? name.toUpperCase() : name);
    }
    return null;
  }

  const METHODS = {
    read, locate, activate, fill, click, move, scroll, type, key,
    window: () => ({ width: innerWidth, height: innerHeight, title: document.title, density: devicePixelRatio, origin: location.origin }),
    cursor: () => pointer,
    drag: () => refuse("a drag cannot be made from inside a page; this browser gives an extension no pointer of its own"),
  };

  globalThis.__praeciseControl = {
    call(method, params) {
      try {
        const known = METHODS[method] ?? refuse(`this page script cannot ${method}`);
        return { result: known(params || {}) ?? null };
      } catch (err) {
        return { error: err instanceof Refused ? err.message : `${err.name}: ${err.message}` };
      }
    },
  };
})();
