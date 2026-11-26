const BOOT_SCRIPT = `
(function () {
  try {
    if (!window.__nativeReplaceState) {
      window.__nativeReplaceState = history.replaceState.bind(history);
    }
    var input = document.getElementById("clinic-url");
    var steps = document.getElementById("check-steps");
    if (!input || !steps || input.value) return;
    if (!steps.classList.contains("hidden")) return;
    var raw = new URLSearchParams(window.location.search).get("url");
    if (!raw) return;
    var value = raw.trim();
    if (!value || value.length > 300 || /[\\s<>]/.test(value)) return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\\/\\//i.test(value)) return;
    var host = value.replace(/^[a-z][a-z0-9+.-]*:\\/\\//i, "").split(/[/?#]/)[0];
    if (!host || host.indexOf(".") === -1 || host.indexOf("@") !== -1) return;
    input.value = value;
    document.documentElement.setAttribute("data-autocheck", "");
  } catch (e) {}
})();
`;

export function AutoCheckScript() {
  return <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />;
}
