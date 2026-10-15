// @ts-nocheck
import { STATIC_RESOURCE } from "../const";

let initializePromise: Promise<void> | null = null;
let initializeApiUrl = "";

type DocsApiWindow = Window & {
  DocsAPI?: unknown;
};

function resetLoadedDocsApi(apiUrl: string) {
  if (!initializeApiUrl || initializeApiUrl === apiUrl) {
    return;
  }

  document
    .querySelectorAll<HTMLScriptElement>(
      'script[src*="/web-apps/apps/api/documents/api.js"]',
    )
    .forEach((script) => script.remove());
  document
    .querySelectorAll<HTMLIFrameElement>("iframe[data-onlyoffice-preload]")
    .forEach((iframe) => iframe.remove());

  try {
    delete (window as DocsApiWindow).DocsAPI;
  } catch {
    (window as DocsApiWindow).DocsAPI = undefined;
  }
}

function preloadEditorFrame() {
  if (document.querySelector(`iframe[data-onlyoffice-preload="${STATIC_RESOURCE.onlyoffice.preloadHtml}"]`)) {
    return;
  }

  const iframe = document.createElement("iframe");
  iframe.src = STATIC_RESOURCE.onlyoffice.preloadUrl;
  iframe.dataset.onlyofficePreload = STATIC_RESOURCE.onlyoffice.preloadHtml;
  iframe.className = "w-0 h-0 hidden absolute -z-10";
  iframe.hidden = true;
  iframe.tabIndex = -1;
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);
}

export async function initializeOnlyOffice() {
  if (typeof window === "undefined") return;

  const apiUrl = STATIC_RESOURCE.onlyoffice.apiUrl;

  if (initializePromise && initializeApiUrl === apiUrl) {
    return initializePromise;
  }

  if (initializePromise && initializeApiUrl !== apiUrl) {
    initializePromise = null;
  }
  resetLoadedDocsApi(apiUrl);
  initializeApiUrl = apiUrl;

  initializePromise = new Promise<void>((resolve, reject) => {
    preloadEditorFrame();

    if (window.DocsAPI?.DocEditor) {
      resolve();
      return;
    }

    let script = document.querySelector<HTMLScriptElement>(
      `script[src="${apiUrl}"]`,
    );

    const needsAppend = !script;
    if (!script) {
      script = document.createElement("script");
      script.src = apiUrl;
    }

    script.addEventListener("load", () => {
      if (window.DocsAPI?.DocEditor) {
        resolve();
      } else {
        script?.remove();
        initializePromise = null;
        reject(new Error(`OnlyOffice DocsAPI 未注册，请检查 SDK 文件及脚本响应类型：${apiUrl}`));
      }
    }, { once: true });
    script.addEventListener(
      "error",
      () => {
        initializePromise = null;
        script?.remove();
        reject(new Error(`无法加载 OnlyOffice DocsAPI：${apiUrl}。请确认构建时已包含 public/packages/onlyoffice 静态 SDK。`));
      },
      { once: true },
    );
    if (needsAppend) document.head.appendChild(script);
  });

  return initializePromise;
}
