// One tab, offered by the person, worked by an agent on this machine.
//
// The agent's side listens on this machine only. This connects out to it when a tab is
// offered, attaches the browser's own debugger to that tab, which the browser says in a
// bar across the top, and passes on a short list of commands: look, read what the page
// tells a screen reader, move the pointer, press keys, go to an address. Nothing is
// evaluated in the page, and nothing about its cookies, storage or network is asked.
//
// The offer is for the site the tab is on. If the tab goes to another site, is closed,
// or the person stops it, the agent is cut off.

const PORT = 17345;

/** What an agent may ask of the tab. Anything else is refused here, whatever asks. */
const ALLOWED = new Set([
  "Page.enable",
  "Page.getLayoutMetrics",
  "Page.captureScreenshot",
  "Page.navigate",
  "Input.dispatchMouseEvent",
  "Input.dispatchKeyEvent",
  "Input.insertText",
  "Accessibility.getFullAXTree",
  "Accessibility.getPartialAXTree",
  "DOM.scrollIntoViewIfNeeded",
  "DOM.getContentQuads",
]);

let socket;
let offered;
let alive;

const send = (message) => {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
};

function connect() {
  if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const made = new WebSocket(`ws://127.0.0.1:${PORT}/`);
    made.onopen = () => {
      socket = made;
      // A worker with nothing to do is put to sleep; a line now and then says this one is in use.
      clearInterval(alive);
      alive = setInterval(() => send({ type: "ping" }), 20_000);
      resolve();
    };
    made.onerror = () => reject(new Error("No agent is listening on this machine."));
    made.onclose = () => {
      if (socket === made) socket = undefined;
      clearInterval(alive);
      if (offered) withdraw("the agent went away", false);
    };
    made.onmessage = (event) => asked(JSON.parse(event.data));
  });
}

async function asked(message) {
  if (typeof message.id !== "number") return;
  if (!offered) return send({ id: message.id, error: "no tab is offered; the person offers one from the extension" });
  if (!ALLOWED.has(message.method)) return send({ id: message.id, error: `${message.method} is not something an agent may ask of a tab` });
  if (message.method === "Page.navigate" && !sameSite(message.params && message.params.url)) {
    return send({ id: message.id, error: `the tab was offered on ${offered.origin} and may not be taken to another site` });
  }
  try {
    send({ id: message.id, result: await chrome.debugger.sendCommand({ tabId: offered.tabId }, message.method, message.params || {}) });
  } catch (err) {
    send({ id: message.id, error: String((err && err.message) || err) });
  }
}

function sameSite(address) {
  try {
    return new URL(address).origin === offered.origin;
  } catch {
    return false;
  }
}

async function offer(tabId) {
  const tab = await chrome.tabs.get(tabId);
  // A tab that is still loading has its address under another name.
  const address = tab.url || tab.pendingUrl || "";
  let url;
  try {
    url = new URL(address);
  } catch {
    throw new Error("Only a web page can be offered.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only a web page can be offered.");
  if (offered) await withdraw("another tab was offered", true);
  await connect();
  await chrome.debugger.attach({ tabId }, "1.3");
  offered = { tabId, origin: url.origin, title: tab.title || url.host };
  send({ type: "offered", tab: { id: tabId, url: address, title: offered.title } });
  return offered;
}

async function withdraw(reason, tell = true) {
  if (!offered) return;
  const was = offered;
  offered = undefined;
  if (tell) send({ type: "withdrawn", reason });
  try {
    await chrome.debugger.detach({ tabId: was.tabId });
  } catch {
    // Already detached.
  }
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (offered && source.tabId === offered.tabId && method.startsWith("Page.")) send({ type: "event", method, params });
});
chrome.debugger.onDetach.addListener((source) => {
  if (offered && source.tabId === offered.tabId) withdraw("the person stopped it");
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (offered && tabId === offered.tabId) withdraw("the tab was closed");
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (offered && tabId === offered.tabId && change.url && !sameSite(change.url)) withdraw("the tab left the site it was offered on");
});

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  const done = (work) => work.then((value) => respond({ ok: true, value }), (err) => respond({ ok: false, error: String((err && err.message) || err) }));
  if (message.type === "state") respond({ ok: true, value: offered || null });
  else if (message.type === "offer") done(offer(message.tabId));
  else if (message.type === "stop") done(withdraw("the person stopped it").then(() => null));
  else return false;
  return true;
});
