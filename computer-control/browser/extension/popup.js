// The one place a tab is offered or taken back.

const heading = document.getElementById("heading");
const about = document.getElementById("about");
const tabs = document.getElementById("tabs");
const said = document.getElementById("said");

const ask = (message) => chrome.runtime.sendMessage(message);

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
    about.textContent = `It can look at and work this tab while it stays on ${new URL(offered.origin).host}.`;
    tabs.append(row(offered.title, "Stop", () => ask({ type: "stop" })));
    return;
  }
  heading.textContent = "Let an agent use a tab";
  about.textContent = "It can look at and work the tab you choose, on the site it is on, until you stop it.";
  const here = (await chrome.windows.getCurrent()).id;
  // A tab that is still loading has its address under another name.
  const address = (tab) => tab.url || tab.pendingUrl || "";
  const open = (await chrome.tabs.query({})).filter((tab) => /^https?:/.test(address(tab)));
  // This window's tabs first, and of those the one in front.
  const rank = (tab) => (tab.windowId === here ? 2 : 0) + (tab.active ? 1 : 0);
  open.sort((a, b) => rank(b) - rank(a));
  for (const tab of open) tabs.append(row(tab.title || address(tab), "Use this tab", () => ask({ type: "offer", tabId: tab.id }), { tab: String(tab.id), url: address(tab) }));
  if (!open.length) about.textContent = "There is no web page open to offer.";
}

show();
