// Praecise Control for a browser that gives an extension no debugger: Firefox, Safari.
//
// The person opens this from its button on the tab they want worked and presses "Use
// this tab". That press is what lets this extension into the tab, and only that tab,
// for as long as it stays on its site. Nothing is asked for in advance.
//
// The agent's side listens on this machine only. What it asks is carried out in the
// page by page.js, or here for a picture and an address.

const api = globalThis.browser ?? globalThis.chrome;
const PORT = 17345;

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
      // A background page with nothing to do is put to sleep; a line now and then says this one is in use.
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

/** Ask the page. The script is put in when it is not there, which it is not after the page has gone somewhere new. */
async function inPage(method, params) {
  const target = { tabId: offered.tabId };
  const call = () => api.scripting.executeScript({ target, func: (name, given) => (globalThis.__praeciseControl ? globalThis.__praeciseControl.call(name, given) : "absent"), args: [method, params] });
  let [first] = await call();
  if (first && first.result === "absent") {
    await api.scripting.executeScript({ target, files: ["page.js"] });
    [first] = await call();
  }
  const answer = first && first.result;
  if (!answer || answer === "absent") throw new Error("the page did not answer");
  if (answer.error) throw new Error(answer.error);
  return answer.result;
}

async function picture(region) {
  const view = await inPage("window", {});
  const tab = await api.tabs.get(offered.tabId);
  if (!tab.active) throw new Error("the tab has to be the one in front in its window to be pictured");
  const shot = await api.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const drawn = await createImageBitmap(await (await fetch(shot)).blob());
  // The picture is made in the page's own pixels, whatever the display draws them with.
  const scale = drawn.width / view.width;
  const part = region ? { x: region.x, y: region.y, width: Math.min(region.width, view.width - region.x), height: Math.min(region.height, view.height - region.y) } : { x: 0, y: 0, width: view.width, height: view.height };
  if (part.width < 1 || part.height < 1 || part.x < 0 || part.y < 0) throw new Error("that region has no area on the page");
  // A region is enlarged to fill the page's own size, and no further than is still a picture of something.
  const zoom = region ? Math.max(1, Math.min(4, view.width / part.width, view.height / part.height)) : 1;
  const canvas = new OffscreenCanvas(Math.round(part.width * zoom), Math.round(part.height * zoom));
  canvas.getContext("2d").drawImage(drawn, part.x * scale, part.y * scale, part.width * scale, part.height * scale, 0, 0, canvas.width, canvas.height);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  let text = "";
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return { mime: "image/png", data: btoa(text), name: region ? "zoom.png" : "screenshot.png" };
}

function sameSite(address) {
  try {
    return new URL(address).origin === offered.origin;
  } catch {
    return false;
  }
}

async function go(address) {
  if (!sameSite(address)) throw new Error(`the tab was offered on ${offered.origin} and may not be taken to another site`);
  const arrived = new Promise((resolve) => {
    const heard = (tabId, change) => {
      if (tabId === offered?.tabId && change.status === "complete") {
        api.tabs.onUpdated.removeListener(heard);
        resolve();
      }
    };
    api.tabs.onUpdated.addListener(heard);
    setTimeout(resolve, 15_000);
  });
  await api.tabs.update(offered.tabId, { url: address });
  await arrived;
  return null;
}

async function asked(message) {
  if (typeof message.id !== "number") return;
  if (!offered) return send({ id: message.id, error: "no tab is offered; the person offers one from the extension" });
  const params = message.params || {};
  try {
    let result;
    if (message.method === "screenshot") result = await picture(params.region);
    else if (message.method === "open") result = await go(params.url);
    else result = await inPage(message.method, params);
    send({ id: message.id, result });
  } catch (err) {
    const said = String((err && err.message) || err);
    // Let into the tab no longer: it has left the site it was offered on.
    if (/permission|access|host/i.test(said) && !/not a reference|no longer/.test(said)) {
      send({ id: message.id, error: "the tab is no longer offered: the tab left the site it was offered on" });
      return withdraw("the tab left the site it was offered on");
    }
    send({ id: message.id, error: said });
  }
}

async function offer(tabId) {
  const tab = await api.tabs.get(tabId);
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
  offered = { tabId, origin: url.origin, title: tab.title || url.host };
  try {
    const view = await inPage("window", {});
    send({ type: "offered", speaks: "screen", tab: { id: tabId, url: address, title: offered.title }, window: view });
  } catch (err) {
    offered = undefined;
    throw err;
  }
  return offered;
}

async function withdraw(reason, tell = true) {
  if (!offered) return;
  offered = undefined;
  if (tell) send({ type: "withdrawn", reason });
}

api.tabs.onRemoved.addListener((tabId) => {
  if (offered && tabId === offered.tabId) withdraw("the tab was closed");
});
api.tabs.onUpdated.addListener((tabId, change) => {
  if (offered && tabId === offered.tabId && change.url && !sameSite(change.url)) withdraw("the tab left the site it was offered on");
});

api.runtime.onMessage.addListener((message, _sender, respond) => {
  const done = (work) => work.then((value) => respond({ ok: true, value }), (err) => respond({ ok: false, error: String((err && err.message) || err) }));
  if (message.type === "state") respond({ ok: true, value: offered || null });
  else if (message.type === "offer") done(offer(message.tabId));
  else if (message.type === "stop") done(withdraw("the person stopped it").then(() => null));
  else return false;
  return true;
});
