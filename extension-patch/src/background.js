/**
 * Add to your service worker (or import it). Content scripts call chrome.runtime.sendMessage({type, ...}).
 * Settings (platform URL + key) live in chrome.storage.local under "xsPlatform" and are edited in the panel's Platform tab.
 */
import { listJobs, ping, saveShortlist } from "./platformClient.js";

async function config() {
  const { xsPlatform } = await chrome.storage.local.get("xsPlatform");
  if (!xsPlatform?.platformUrl || !xsPlatform?.apiKey) throw new Error("Open the Platform tab and paste the platform URL and key.");
  return xsPlatform;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    const cfg = await config();
    if (message.type === "XS_PING") return ping(cfg);
    if (message.type === "XS_JOBS") return { jobs: await listJobs(cfg) };
    if (message.type === "XS_SAVE_SHORTLIST") return saveShortlist(cfg, message.shortlist, message.resume ?? null);
    throw new Error(`Unknown message ${message.type}`);
  })()
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true; // keep the channel open for the async answer
});
