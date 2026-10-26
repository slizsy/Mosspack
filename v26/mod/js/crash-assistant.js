<script type="text/javascript">
/* Mosspack crash assistant. The loader's crash journal (script-3) calls these instead of its plain pages:
 *   __mosspackCrash.stopped(journal)                      the page could not keep running (shown now)
 *   __mosspackCrash.recovered(journal, report, dismiss)   the previous session crashed (shown on the next start)
 * Both explain what probably happened, give the matching fix, and offer the report to copy or save. */
(function () {
	"use strict";
	const STYLE = `
	.mp-crash{position:fixed;z-index:2147483647;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#e9eee3}
	.mp-crash.full{inset:0;background:#12170f;display:flex;align-items:center;justify-content:center;padding:20px;overflow:auto}
	.mp-crash.bar{left:12px;right:12px;bottom:12px}
	.mp-crash .box{max-width:680px;width:100%;background:#1c2417;border:2px solid #34422b;border-radius:8px;box-shadow:0 4px 0 #0b0e09;padding:22px 26px}
	.mp-crash.bar .box{max-width:none;padding:14px 18px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
	.mp-crash .logo{font:700 20px/1 Menlo,Consolas,monospace;margin-bottom:12px}.mp-crash .logo span{color:#6fbf4a}
	.mp-crash h1{font-size:22px;margin:0 0 8px}.mp-crash p{margin:6px 0;color:#c4ceb9}
	.mp-crash ul{margin:6px 0 0;padding-left:20px;color:#c4ceb9}
	.mp-crash button{background:#2a3622;color:#e9eee3;border:1px solid #3d4d33;border-radius:5px;padding:9px 14px;font:600 14px/1 inherit;cursor:pointer;margin:12px 8px 0 0}
	.mp-crash button:hover{border-color:#6fbf4a}.mp-crash button.go{background:#6fbf4a;color:#0f140c;border-color:#6fbf4a}
	.mp-crash.bar button{margin:0}
	.mp-crash details{margin-top:12px}.mp-crash summary{cursor:pointer;color:#8d9a83}
	.mp-crash pre{max-height:220px;overflow:auto;background:#0f140c;border:1px solid #2a3622;border-radius:5px;padding:10px;font:12px/1.4 Menlo,Consolas,monospace;white-space:pre-wrap;color:#cfe8bf}`;

	// what probably happened -> [title, explanation, tips]
	function diagnose(j) {
		const text = String((j && (j.error || j.fatalKind || "")) + " " + (j && j.lastWindowError || ""));
		if (/out of memory|allocation failed|memory-pressure|memory access out of bounds/i.test(text) || (j && j.fatalKind === "memory-pressure"))
			return ["Mosspack ran out of memory", "The browser didn't give the game enough memory to keep going.",
				["Close other tabs and apps, then reload.", "Lower Render Distance in Options → Video Settings → Quality.", "On a Chromebook, restart it before playing."]];
		if (/__eagPrepareInlineAssets|payload already released or missing|inline payload size mismatch/i.test(text))
			return ["Part of the Mosspack file is missing", "The file looks incomplete, so the game can't start.",
				["Download Mosspack-26.html again and wait until it has fully finished.", "Open the file itself, not a preview inside Drive or email."]];
		if (/CompileError|LinkError|WebAssembly/i.test(text) && !/RuntimeError/.test(text))
			return ["This browser couldn't load Mosspack", "The browser rejected the game code.",
				["Use an up-to-date Chrome, Edge or Brave (version 137 or newer).", "On a Chromebook: Settings → About ChromeOS → Check for updates."]];
		if (j && (j.fatalKind === "wasm-trap" || j.fatalKind === "java-crash"))
			return ["The game crashed", "Something went wrong inside the game itself.",
				["Reload and try again; your worlds are saved regularly.", "If it keeps happening in one world, try another world to see if it's that world.",
					"Copy the report below if you want to look into it."]];
		return ["Mosspack stopped", "The page couldn't keep running.",
			["Reload and try again.", "Close other tabs if the computer is busy.", "If it keeps happening, open the file with #reset at the end to start fresh."]];
	}
	function reportText(j, report) {
		return (report ? report + "\n\n" : "") + "---- Mosspack crash journal ----\n" + JSON.stringify(j || {}, null, 2);
	}
	function el(tag, attrs, ...kids) {
		const e = document.createElement(tag);
		for (const k in attrs || {}) if (k === "class") e.className = attrs[k]; else if (k.startsWith("on")) e[k] = attrs[k]; else e.setAttribute(k, attrs[k]);
		for (const c of kids) if (c != null) e.append(c);
		return e;
	}
	function style() {
		if (document.getElementById("mp-crash-style")) return;
		document.head.appendChild(el("style", { id: "mp-crash-style" }, STYLE));
	}
	function copyButton(text) {
		const b = el("button", { onclick: () => {
			navigator.clipboard.writeText(text).then(() => { b.textContent = "Copied"; }, () => { b.textContent = "Copy failed"; });
			setTimeout(() => { b.textContent = "Copy report"; }, 1500);
		} }, "Copy report");
		return b;
	}
	function saveButton(text) {
		return el("button", { onclick: () => {
			const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
			const a = el("a", { href: url, download: "mosspack-crash-report.txt" }); a.click();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
		} }, "Save report");
	}

	window.__mosspackCrash = {
		stopped(journal) {
			style();
			const [title, why, tips] = diagnose(journal), text = reportText(journal);
			const old = document.querySelector(".mp-crash.full"); if (old) old.remove();
			document.documentElement.appendChild(el("div", { class: "mp-crash full" }, el("div", { class: "box" },
				el("div", { class: "logo" }, "moss", el("span", {}, "pack")), el("h1", {}, title), el("p", {}, why),
				el("ul", {}, ...tips.map((t) => el("li", {}, t))),
				el("button", { class: "go", onclick: () => location.reload() }, "Reload"), copyButton(text), saveButton(text),
				el("button", { onclick: () => { location.href = location.href.split("#")[0] + "#reset"; location.reload(); } }, "Reset Mosspack…"),
				el("details", {}, el("summary", {}, "Details"), el("pre", {}, text)))));
		},
		recovered(journal, report, dismiss) {
			style();
			const [title] = diagnose(journal), text = reportText(journal, report);
			const bar = el("div", { class: "mp-crash bar" });
			bar.append(el("div", { class: "box" },
				el("div", { style: "flex:1;min-width:240px" }, el("b", {}, "Mosspack closed unexpectedly last time"), el("br"),
					el("span", { style: "color:#c4ceb9" }, title + ". Your worlds are saved; the report is here if you want it.")),
				copyButton(text), saveButton(text),
				el("button", { class: "go", onclick: () => { dismiss(); bar.remove(); } }, "OK")));
			document.body.appendChild(bar);
		},
	};
})();
</script>
