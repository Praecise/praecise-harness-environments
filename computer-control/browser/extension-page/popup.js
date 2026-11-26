// The one place a tab is offered or taken back. Opening this on a tab and pressing its
// button is what lets the extension into that tab.

const api = globalThis.browser ?? globalThis.chrome;
const heading = document.getElementById("heading");
const about = document.getElementById("about");
const tabs = document.getElementById("tabs");
const said = document.getElementById("said");

const ask = (message) => api.runtime.sendMessage(message);

function row(label, action, press, data = {}) {
  const item = document.createElement("li");
  const name = document.createElement("span");
  name.textContent = label;
  const button = document.createElement("button");
  button.textContent = action;
  Object.assign(button.dataset, data);
  button.addEventListener("click", async () => {
    said.textContent = "";
    const answer = await press();
    if (!answer.ok) said.textContent = answer.error;
    await show();
  });
  item.append(name, button);
  return item;
}

async function show() {
  tabs.replaceChildren();
  const { value: offered } = await ask({ type: "state" });
  if (offered) {
    heading.textContent = "An agent is using a tab";
    about.textContent = `It can read and work this tab while it stays on ${new URL(offered.origin).host}.`;
    tabs.append(row(offered.title, "Stop", () => ask({ type: "stop" })));
    return;
  }
  heading.textContent = "Let an agent use this tab";
  about.textContent = "It can read and work this tab, on the site it is on, until you stop it.";
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const address = tab ? tab.url || tab.pendingUrl || "" : "";
  if (tab && /^https?:/.test(address)) tabs.append(row(tab.title || address, "Use this tab", () => ask({ type: "offer", tabId: tab.id }), { tab: String(tab.id), url: address }));
  else about.textContent = "This tab is not a web page, so it cannot be offered.";
}

show();
