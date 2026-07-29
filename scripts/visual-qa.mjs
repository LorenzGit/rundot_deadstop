import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const baseUrl = process.argv[2] ?? "http://127.0.0.1:5191/?qa=1";
const outputDir = resolve(process.argv[3] ?? "docs/qa");
const profileDir = await mkdtemp(join(tmpdir(), "deadstop-visual-qa-"));
const chrome = spawn(
    chromePath,
    [
        "--headless=new",
        "--enable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--disable-default-apps",
        "--simulate-outdated-no-au=Tue, 31 Dec 2099 23:59:59 GMT",
        "--remote-debugging-port=0",
        `--user-data-dir=${profileDir}`,
        "about:blank",
    ],
    { stdio: "ignore" },
);

let socket;
let nextMessageId = 1;
const pending = new Map();

function delay(ms) {
    return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function waitForDevToolsPort() {
    const portFile = join(profileDir, "DevToolsActivePort");
    for (let attempt = 0; attempt < 600; attempt += 1) {
        try {
            const [port] = (await readFile(portFile, "utf8")).trim().split("\n");
            return Number(port);
        } catch {
            await delay(50);
        }
    }
    throw new Error("Chrome DevTools port did not become ready");
}

function command(method, params = {}) {
    return new Promise((resolveCommand, rejectCommand) => {
        const id = nextMessageId;
        nextMessageId += 1;
        pending.set(id, { resolve: resolveCommand, reject: rejectCommand });
        socket.send(JSON.stringify({ id, method, params }));
    });
}

async function evaluate(expression) {
    const response = await command("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
    });
    if (response.exceptionDetails) {
        const details = response.exceptionDetails;
        throw new Error(details.exception?.description ?? details.text);
    }
    return response.result?.value;
}

async function waitFor(expression, label) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (await evaluate(expression)) return;
        await delay(50);
    }
    throw new Error(`${label} did not become ready`);
}

function touchEvent(type, points) {
    return command("Input.dispatchTouchEvent", { type, touchPoints: points });
}

/** True while a thumb is on the movement stick. The stick itself is permanent. */
function stickPressed() {
    return evaluate('document.getElementById("stick-base").classList.contains("active")');
}

async function setViewport(width, height) {
    await command("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: true,
        screenWidth: width,
        screenHeight: height,
        screenOrientation: {
            type: width > height ? "landscapePrimary" : "portraitPrimary",
            angle: width > height ? 90 : 0,
        },
    });
}

async function openGame(width, height) {
    await setViewport(width, height);
    await command("Page.navigate", { url: baseUrl });
    await waitFor("document.readyState === 'complete'", "document");
    await waitFor("Boolean(window.__deadstopQa)", "DEADSTOP QA bridge");
}

async function capture(fileName) {
    await delay(350);
    const result = await command("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
    });
    await writeFile(join(outputDir, fileName), Buffer.from(result.data, "base64"));
    console.log(join(outputDir, fileName));
}

const qaSave = {
    version: 1,
    settings: {
        musicEnabled: false,
        musicVolume: 0.3,
        sfxEnabled: false,
        sfxVolume: 0.66,
        hapticsEnabled: false,
        reducedMotion: false,
        touchControls: "auto",
        autoFire: true,
    },
    records: { bestScore: 18420, deepestLevel: 9, bestChain: 7, totalRuns: 6 },
    progress: { lifetimeDowns: 214, lifetimeInk: 980, lifetimeGrazes: 44, lifetimeBoosters: 31, controlsSeen: true },
    wallet: { ink: 940 },
    kit: ["quick_feet"],
    cosmetics: { selectedPalette: "grid", unlockedPaletteIds: ["grid"] },
    dailyRewards: { lastClaimDay: null, totalClaims: 0, claimIds: [] },
    monetization: {
        pendingPurchaseIntent: null,
        redeemedOrderIds: [],
        rewardedAds: { day: null, completedToday: 0, lastCompletedAtMs: 0, claimIds: [] },
        interstitialAds: { day: null, shownToday: 0, lastShownAtMs: 0 },
    },
};

const VERSION_TAG = process.env.DEADSTOP_QA_TAG ?? "current";

function shot(name) {
    return `deadstop-${VERSION_TAG}-${name}.png`;
}

try {
    const port = await waitForDevToolsPort();
    const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(baseUrl)}`, {
        method: "PUT",
    }).then((response) => response.json());
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolveOpen, rejectOpen) => {
        socket.addEventListener("open", resolveOpen, { once: true });
        socket.addEventListener("error", rejectOpen, { once: true });
    });
    socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (!message.id) return;
        const handler = pending.get(message.id);
        if (!handler) return;
        pending.delete(message.id);
        if (message.error) handler.reject(new Error(message.error.message));
        else handler.resolve(message.result);
    });
    await Promise.all([command("Page.enable"), command("Runtime.enable")]);

    await openGame(896, 414);
    await evaluate(
        `localStorage.setItem("deadstop.local-save", ${JSON.stringify(JSON.stringify(qaSave))}); location.reload();`,
    );
    await waitFor("document.readyState === 'complete'", "reloaded document");
    await waitFor("Boolean(window.__deadstopQa)", "reloaded DEADSTOP QA bridge");
    await capture(shot("landscape-menu"));

    await evaluate("window.__deadstopQa.openKit()");
    await capture(shot("landscape-kit"));
    const kitCards = await evaluate("document.querySelectorAll('.kit-card').length");
    if (kitCards < 8) throw new Error(`The kit rendered only ${kitCards} boosters`);

    // The kit charges its price on every run, so the page has to answer what is
    // left afterwards. Assert the arithmetic, not just that text rendered.
    const ledger = JSON.parse(
        await evaluate(`JSON.stringify({
            wallet: Number(document.getElementById("kit-wallet").textContent),
            cost: parseInt(document.getElementById("kit-ledger-cost").textContent, 10),
            after: parseInt(document.getElementById("kit-ledger-after").textContent, 10),
            runs: parseInt(document.getElementById("kit-ledger-runs").textContent, 10),
            packed: document.getElementById("kit-ledger-packed").textContent,
            rows: document.querySelectorAll("#kit-ledger > div").length,
        })`),
    );
    console.log("KIT_LEDGER", JSON.stringify(ledger));
    if (ledger.rows !== 4) throw new Error(`The kit ledger lost a row (${ledger.rows})`);
    if (ledger.cost <= 0) throw new Error("The QA save packs a booster, so the kit must cost ink");
    if (ledger.after !== ledger.wallet - ledger.cost) {
        throw new Error(`Ledger balance is wrong: ${ledger.wallet} - ${ledger.cost} != ${ledger.after}`);
    }
    if (ledger.runs !== Math.floor(ledger.wallet / ledger.cost)) {
        throw new Error(`Ledger run count is wrong: saw ${ledger.runs}`);
    }
    // The ledger explains the rental, it must not crowd out the thing it
    // explains. Measured as a share of the sheet: the four rows stacked in one
    // column took a third of a short landscape sheet, two columns take a sixth.
    const kitFit = JSON.parse(
        await evaluate(`(() => {
            const ledger = document.getElementById("kit-ledger").getBoundingClientRect();
            const sheet = document.querySelector("#kit-screen .sheet").getBoundingClientRect();
            const cards = [...document.querySelectorAll(".kit-card")];
            const visible = cards.filter((c) => c.getBoundingClientRect().bottom <= sheet.bottom).length;
            return JSON.stringify({
                share: Math.round((ledger.height / sheet.height) * 100),
                ledgerHeight: Math.round(ledger.height),
                visibleCards: visible,
            });
        })()`),
    );
    console.log("KIT_FIT", JSON.stringify(kitFit));
    if (kitFit.share > 25) throw new Error(`The kit ledger eats ${kitFit.share}% of the sheet`);
    if (kitFit.visibleCards < 4) throw new Error(`Only ${kitFit.visibleCards} boosters fit under the ledger`);

    // The warning the page exists for. A healthy QA wallet never reaches it, so
    // reseed a broke one rather than trusting a state nothing here can enter.
    const brokeSave = { ...qaSave, wallet: { ink: 30 }, kit: ["quick_feet"] };
    await evaluate(
        `localStorage.setItem("deadstop.local-save", ${JSON.stringify(JSON.stringify(brokeSave))}); location.reload();`,
    );
    await waitFor("document.readyState === 'complete'", "broke document");
    await waitFor("Boolean(window.__deadstopQa)", "broke QA bridge");
    await evaluate("window.__deadstopQa.openKit()");
    const broke = JSON.parse(
        await evaluate(`JSON.stringify({
            after: document.getElementById("kit-ledger-after").textContent,
            runs: document.getElementById("kit-ledger-runs").textContent,
            flagged: document.querySelectorAll("#kit-ledger dd.short").length,
        })`),
    );
    console.log("KIT_SHORT", JSON.stringify(broke));
    if (broke.flagged !== 2) throw new Error(`An unaffordable kit must be flagged, saw ${broke.flagged}`);
    if (!broke.runs.includes("70")) throw new Error(`The shortfall must be named, saw "${broke.runs}"`);
    await capture(shot("landscape-kit-short"));
    await evaluate(
        `localStorage.setItem("deadstop.local-save", ${JSON.stringify(JSON.stringify(qaSave))}); location.reload();`,
    );
    await waitFor("Boolean(window.__deadstopQa)", "restored QA bridge");

    await evaluate("window.__deadstopQa.openLedger()");
    await capture(shot("landscape-ledger"));

    await evaluate("window.__deadstopQa.openDailyRewards()");
    await capture(shot("landscape-daily"));

    await evaluate("window.__deadstopQa.openSettings()");
    await capture(shot("landscape-settings"));

    // A full firefight: every hostile family, a live bullet lattice, safe-area insets.
    await evaluate(`(() => {
        const qa = window.__deadstopQa;
        qa.startRun();
        qa.freezeSimulation();
        document.getElementById("tap-tutorial").classList.remove("visible");
        document.documentElement.style.setProperty("--run-safe-top", "22px");
        document.documentElement.style.setProperty("--run-safe-bottom", "22px");
        qa.forceLevel(8);
        qa.forceWeapon("smg", 26);
        qa.forceBooster("second_skin");
        qa.forceBooster("quick_feet");
        qa.forceBooster("ricochet");
        qa.forceEnemy("grunt", 330, -0.4);
        qa.forceEnemy("grunt", 300, 0.55);
        qa.forceEnemy("rusher", 210, 2.7);
        qa.forceEnemy("tank", 280, 3.3);
        qa.forceEnemy("sniper", 430, -2.4);
        qa.forceEnemy("rocketeer", 340, 1.7);
        qa.setInput({ moveX: 0.2, moveY: 0, aimX: 1150, aimY: 300, firing: true });
        for (let frame = 0; frame < 40; frame += 1) qa.step(1 / 60, 1);
        qa.setInput({ firing: false, moveX: 0, moveY: 0 });
        qa.showMilestone("LEVEL 8", "HOLD THE PAGE");
    })()`);
    await capture(shot("landscape-firefight"));

    const combatState = await evaluate("JSON.stringify(window.__deadstopQa.snapshot())").then(JSON.parse);
    console.log(`COMBAT ${JSON.stringify(combatState)}`);
    if (combatState.bullets < 1) throw new Error("Firefight capture produced no rounds in flight");
    if (combatState.enemies < 6) throw new Error("Firefight capture did not populate the hostile roster");
    if (combatState.cover < 2) throw new Error("Firefight capture laid out no cover");

    const boosterChips = await evaluate("document.querySelectorAll('#booster-strip i').length");
    if (boosterChips < 3) throw new Error(`The booster strip rendered ${boosterChips} chips`);

    // The between-level draft.
    await evaluate("window.__deadstopQa.forceDraft()");
    await capture(shot("landscape-draft"));
    const draftCards = await evaluate("document.querySelectorAll('.draft-card').length");
    if (draftCards !== 3) throw new Error(`The draft rendered ${draftCards} cards`);
    await evaluate("window.__deadstopQa.chooseBooster(0)");
    const afterDraft = await evaluate("JSON.stringify(window.__deadstopQa.snapshot())").then(JSON.parse);
    if (afterDraft.phase !== "running") throw new Error("Taking a draft card did not resume the page");

    await evaluate("window.__deadstopQa.pause()");
    await capture(shot("landscape-pause"));

    await evaluate("window.__deadstopQa.startRun(); window.__deadstopQa.forceResults()");
    await capture(shot("landscape-results"));

    // Every purchasable page renders with the same layout.
    for (const palette of ["ledger", "grid", "nightshift", "blueprint", "carbon", "redpen"]) {
        await evaluate(`(() => {
            const qa = window.__deadstopQa;
            qa.startRun();
            qa.freezeSimulation();
            document.getElementById("tap-tutorial").classList.remove("visible");
            qa.setPalette(${JSON.stringify(palette)});
            qa.forceWeapon("rifle", 8);
            qa.forceEnemy("grunt", 300, 0.2);
            qa.forceEnemy("rusher", 230, 2.8);
            qa.setInput({ moveX: 0.4, moveY: 0, aimX: 1100, aimY: 340, firing: true });
            for (let frame = 0; frame < 26; frame += 1) qa.step(1 / 60, 1);
            qa.setInput({ firing: false, moveX: 0, moveY: 0 });
        })()`);
        await capture(shot(`landscape-page-${palette}`));
    }
    await evaluate('window.__deadstopQa.setPalette("ledger")');

    // Short phone in landscape: the HUD must stay inside the safe area.
    await openGame(667, 375);
    await evaluate(`(() => {
        const qa = window.__deadstopQa;
        qa.startRun();
        qa.freezeSimulation();
        document.getElementById("tap-tutorial").classList.remove("visible");
        document.documentElement.style.setProperty("--run-safe-left", "34px");
        document.documentElement.style.setProperty("--run-safe-right", "34px");
        // Force the touch layout so the thumb controls are measured, not skipped.
        document.getElementById("touch-controls-mode").value = "on";
        document.getElementById("touch-controls-mode").dispatchEvent(new Event("change", { bubbles: true }));
        document.getElementById("touch-controls").classList.remove("hidden");
        qa.forceLevel(4);
        qa.forceWeapon("shotgun", 6);
        qa.setInput({ moveX: 0.5, moveY: 0.2, aimX: 900, aimY: 300, firing: false });
        for (let frame = 0; frame < 60; frame += 1) qa.step(1 / 60, 1);
        qa.setInput({ moveX: 0, moveY: 0 });
    })()`);
    await capture(shot("short-landscape-touch-safe-area"));

    // The firing surface covers the page, so the controls above it must still
    // win a hit test: a tap on PAUSE must never be swallowed by the aim layer.
    const layering = await evaluate(`(() => {
        // Walk up from the hit element: a tap on a button's icon is a tap on
        // the button.
        const hit = (el) => {
            const r = el.getBoundingClientRect();
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            const owner = top?.closest("[id]");
            return owner ? owner.id : "none";
        };
        return JSON.stringify({
            pause: hit(document.getElementById("pause-button")),
            movePad: hit(document.getElementById("move-zone")),
            centre: document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)?.id ?? "none",
        });
    })()`).then(JSON.parse);
    console.log(`LAYERING ${JSON.stringify(layering)}`);
    if (layering.pause !== "pause-button") throw new Error(`PAUSE is not tappable: ${layering.pause}`);
    if (layering.movePad !== "move-zone") throw new Error(`The move pad is not reachable: ${layering.movePad}`);
    if (layering.centre !== "aim-zone") throw new Error(`The page centre is not a firing surface: ${layering.centre}`);

    const safeAreaResult = await evaluate(`(() => {
        const frame = document.getElementById("app-frame").getBoundingClientRect();
        const style = getComputedStyle(document.documentElement);
        const inset = (name) => Number.parseFloat(style.getPropertyValue(name)) || 0;
        const bounds = (id) => {
            const rect = document.getElementById(id).getBoundingClientRect();
            return { id, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        };
        return {
            safeLeft: inset("--run-safe-left"),
            safeRight: inset("--run-safe-right"),
            frame: { left: frame.left, right: frame.right, top: frame.top, bottom: frame.bottom },
            elements: ["score-text", "level-text", "weapon-text", "pause-button"].map(bounds),
        };
    })()`);
    console.log(`SAFE_AREA ${JSON.stringify(safeAreaResult)}`);
    for (const element of safeAreaResult.elements) {
        if (element.left < safeAreaResult.frame.left + safeAreaResult.safeLeft - 1) {
            throw new Error(`Safe-area regression: ${element.id} crosses the left inset`);
        }
        if (element.right > safeAreaResult.frame.right - safeAreaResult.safeRight + 1) {
            throw new Error(`Safe-area regression: ${element.id} crosses the right inset`);
        }
        if (element.top < safeAreaResult.frame.top - 1 || element.bottom > safeAreaResult.frame.bottom + 1) {
            throw new Error(`Safe-area regression: ${element.id} escapes the frame`);
        }
    }

    // The movement stick is permanent and visible, so the split has to be
    // exactly what the player can see: the drawn ring steers and never fires,
    // and every pixel outside it — including right beside the ring — shoots.
    // Touch emulation has to be live before the page boots, or the dispatched
    // touches never reach the listeners as pointer events.
    await command("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await openGame(844, 390);
    await evaluate(`(() => {
        const qa = window.__deadstopQa;
        qa.startRun();
        document.getElementById("tap-tutorial").classList.remove("visible");
        document.getElementById("touch-controls-mode").value = "on";
        document.getElementById("touch-controls-mode").dispatchEvent(new Event("change", { bubbles: true }));
        qa.forceWeapon("smg", 26);
    })()`);
    // Let the level card clear so the first tap lands on live input.
    await delay(300);

    // Drawn before anyone touches anything, and small enough to cost the arena
    // a corner rather than a quarter.
    const stickLayout = await evaluate(`(() => {
        const zone = document.getElementById("move-zone").getBoundingClientRect();
        const ring = document.getElementById("stick-base");
        const ringRect = ring.getBoundingClientRect();
        return JSON.stringify({
            drawn: Number(getComputedStyle(ring).opacity) > 0 && ringRect.width > 0,
            ring: { x: ringRect.left + ringRect.width / 2, y: ringRect.top + ringRect.height / 2 },
            radius: ringRect.width / 2,
            zone: { right: zone.right, top: zone.top, width: zone.width, height: zone.height },
            screenShare: (zone.width * zone.height) / (window.innerWidth * window.innerHeight),
            label: getComputedStyle(ring, "::after").content,
        });
    })()`).then(JSON.parse);

    // 1. Pressing the drawn ring steers, and costs no ammunition.
    const beforeStick = await evaluate("JSON.stringify(window.__deadstopQa.snapshot())").then(JSON.parse);
    await touchEvent("touchStart", [{ x: stickLayout.ring.x, y: stickLayout.ring.y, id: 1 }]);
    for (let step = 0; step < 40; step += 1) {
        await touchEvent("touchMove", [
            { x: stickLayout.ring.x + stickLayout.radius, y: stickLayout.ring.y - 6, id: 1 },
        ]);
        await delay(24);
    }
    const pressedWhileSteering = await stickPressed();
    await touchEvent("touchEnd", []);
    await delay(120);
    const afterStick = await evaluate("JSON.stringify(window.__deadstopQa.snapshot())").then(JSON.parse);
    const steerDistance = Math.hypot(
        afterStick.playerX - beforeStick.playerX,
        afterStick.playerY - beforeStick.playerY,
    );
    const releasedPressed = await stickPressed();

    // 2. A tap just outside the ring's hit circle is still a shot.
    const outside = { x: stickLayout.zone.right + 24, y: stickLayout.zone.top - 24 };
    const roundsBeforeTap = afterStick.rounds;
    await touchEvent("touchStart", [{ x: outside.x, y: outside.y, id: 2 }]);
    await delay(60);
    await touchEvent("touchEnd", []);
    await delay(200);
    const afterTap = await evaluate("JSON.stringify(window.__deadstopQa.snapshot())").then(JSON.parse);

    const stickTouch = {
        drawnBeforeTouch: stickLayout.drawn,
        labelled: stickLayout.label.includes("MOVE"),
        screenShare: Number(stickLayout.screenShare.toFixed(3)),
        pressedWhileSteering,
        steerDistance: Math.round(steerDistance),
        roundsSpentSteering: beforeStick.rounds - afterStick.rounds,
        releasedPressed,
        roundsSpentTappingOutside: roundsBeforeTap - afterTap.rounds,
        aimedOutside: Boolean(afterTap.touchAim),
    };
    console.log(`STICK_TOUCH ${JSON.stringify(stickTouch)}`);
    if (!stickTouch.drawnBeforeTouch) throw new Error("The movement stick is not drawn until it is touched");
    if (!stickTouch.labelled) throw new Error("The movement stick carries no MOVE label");
    if (stickTouch.screenShare > 0.1) {
        throw new Error(`The stick eats ${Math.round(stickTouch.screenShare * 100)}% of the screen`);
    }
    if (!stickTouch.pressedWhileSteering) throw new Error("Steering did not mark the stick as pressed");
    if (stickTouch.steerDistance < 20)
        throw new Error(`The stick did not move the player: ${stickTouch.steerDistance}`);
    if (stickTouch.roundsSpentSteering !== 0) throw new Error("Steering fired the weapon");
    if (stickTouch.releasedPressed) throw new Error("The stick stayed pressed after release");
    if (stickTouch.roundsSpentTappingOutside < 1) throw new Error("A tap beside the stick did not fire a shot");
    if (!stickTouch.aimedOutside) throw new Error("A tap beside the stick left no aim marker");
    await capture(shot("landscape-touch-stick"));
    await command("Emulation.setTouchEmulationEnabled", { enabled: false });

    // A short phone inside the RUN host, with real safe-area insets applied.
    // Nothing here ran with insets before, which is exactly how a HUD that
    // anchors to them shipped with the TIME bar above the score and the
    // movement stick off the top of the screen.
    await command("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await openGame(718, 440);
    await evaluate(`(async () => {
        const area = await import("/src/sdk/safeArea.ts");
        const qa = window.__deadstopQa;
        qa.startRun();
        document.getElementById("tap-tutorial").classList.remove("visible");
        document.getElementById("touch-controls-mode").value = "on";
        document.getElementById("touch-controls-mode").dispatchEvent(new Event("change", { bubbles: true }));
        // Drive the real conversion with a host reporting device pixels against
        // our CSS-pixel frame — the shape that broke it on a real handset.
        const insets = area.safeAreaOffsetsForFrame(
            { top: 228, right: 750, bottom: 1182, left: 741 },
            { top: 0, right: 718, bottom: 440, left: 0, width: 718, height: 440 },
            { width: 718, height: 440 },
        );
        const root = document.documentElement.style;
        root.setProperty("--run-safe-top", insets.top + "px");
        root.setProperty("--run-safe-right", insets.right + "px");
        root.setProperty("--run-safe-bottom", insets.bottom + "px");
        root.setProperty("--run-safe-left", insets.left + "px");
    })()`);
    await delay(400);

    const insetHud = await evaluate(`(() => {
        const box = (id) => {
            const el = document.getElementById(id);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left) };
        };
        return JSON.stringify({
            h: window.innerHeight,
            w: window.innerWidth,
            score: box("score-text"),
            time: box("time-fill"),
            stick: box("stick-base"),
            docScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
        });
    })()`).then(JSON.parse);
    console.log(`INSET_HUD ${JSON.stringify(insetHud)}`);
    if (insetHud.docScrolls) throw new Error("the document must never scroll; the game is a fixed frame");
    for (const [name, box] of [
        ["score", insetHud.score],
        ["TIME bar", insetHud.time],
        ["move stick", insetHud.stick],
    ]) {
        if (!box) throw new Error(`${name} is missing from the HUD`);
        if (box.top < 0 || box.bottom > insetHud.h) {
            throw new Error(
                `${name} is off screen with host insets applied (${box.top}..${box.bottom} of ${insetHud.h})`,
            );
        }
    }
    if (insetHud.time.top <= insetHud.score.bottom) {
        throw new Error("the TIME bar must stay below the score; insets must not invert the HUD");
    }
    // Every sheet must keep its actions reachable without scrolling. A sticky
    // BACK alone was not enough: CLAIM TODAY, RUN IT BACK and MAIN MENU sat in
    // normal flow and fell below the fold once insets shrank the sheet.
    const sheetChecks = [
        ["daily", "window.__deadstopQa.openDailyRewards()", ["daily-claim", "daily-back"]],
        ["kit", "window.__deadstopQa.openKit()", ["kit-back"]],
        ["ledger", "window.__deadstopQa.openLedger()", ["ledger-back"]],
        ["settings", "window.__deadstopQa.openSettings()", ["settings-back"]],
        ["results", "window.__deadstopQa.forceResults()", ["retry-button", "menu-button", "second-wind-button"]],
    ];
    for (const [name, open, actionIds] of sheetChecks) {
        await evaluate(open);
        // With no host the Second Wind offer hides itself, so QA never saw the
        // one block that was being clipped on a real device. Force it visible.
        await evaluate(`(() => {
            const offer = document.getElementById("second-wind-offer");
            if (offer) offer.classList.remove("hidden");
        })()`);
        await delay(320);
        const reach = await evaluate(`(() => {
            const sheet = document.querySelector(".screen.active .sheet") || document.querySelector(".screen.active");
            const bounds = sheet.getBoundingClientRect();
            const hidden = [];
            for (const id of ${JSON.stringify(actionIds)}) {
                const el = document.getElementById(id);
                if (!el) { hidden.push(id + ":missing"); continue; }
                const r = el.getBoundingClientRect();
                if (r.bottom > bounds.bottom + 1 || r.top < bounds.top - 1) hidden.push(id);
                if (r.width < 1 || r.height < 1) hidden.push(id + ":collapsed");
            }
            return JSON.stringify({ hidden });
        })()`).then(JSON.parse);
        if (reach.hidden.length > 0) {
            throw new Error(`${name}: actions unreachable without scrolling — ${reach.hidden.join(", ")}`);
        }
    }
    console.log(`SHEET_ACTIONS reachable on every sheet at ${insetHud.w}x${insetHud.h} with host insets`);

    // The results sheet is the most-seen modal and its content is fixed, so at
    // a phone size it should fit outright rather than hide stats behind the
    // rail. A few pixels of slack absorbs font rounding.
    await evaluate("window.__deadstopQa.forceResults()");
    await evaluate(`(() => { document.getElementById("second-wind-offer").classList.remove("hidden"); })()`);
    await delay(320);
    const resultsFit = await evaluate(`(() => {
        const sheet = document.querySelector("#results-screen .sheet");
        return JSON.stringify({ overflow: sheet.scrollHeight - sheet.clientHeight });
    })()`).then(JSON.parse);
    console.log(`RESULTS_FIT ${JSON.stringify(resultsFit)}`);
    if (resultsFit.overflow > 16) {
        throw new Error(`the results sheet overflows by ${resultsFit.overflow}px; stats hide behind the rail`);
    }

    // The draft always deals exactly three cards. Any layout that fits two but
    // not three orphans the last one in a half-empty row, which is what
    // auto-fit did at a phone's sheet width.
    await evaluate("window.__deadstopQa.startRun(); window.__deadstopQa.forceDraft()");
    await delay(400);
    const draftRows = await evaluate(`(() => {
        const cards = [...document.querySelectorAll("#draft-cards .draft-card")];
        const rows = new Map();
        for (const card of cards) {
            const top = Math.round(card.getBoundingClientRect().top);
            rows.set(top, (rows.get(top) ?? 0) + 1);
        }
        const perRow = [...rows.values()];
        return JSON.stringify({ cards: cards.length, perRow });
    })()`).then(JSON.parse);
    console.log(`DRAFT_GRID ${JSON.stringify(draftRows)}`);
    if (draftRows.cards !== 3) throw new Error(`the draft must deal three cards, saw ${draftRows.cards}`);
    if (new Set(draftRows.perRow).size > 1) {
        throw new Error(`the draft grid orphaned a card: rows of ${draftRows.perRow.join(", ")}`);
    }

    await capture(shot("phone-host-insets"));
    await command("Emulation.setTouchEmulationEnabled", { enabled: false });

    // Portrait shows the honest rotate nudge rather than a squashed arena.
    await openGame(390, 844);
    await capture(shot("portrait-rotate-nudge"));
    const rotateVisible = await evaluate("getComputedStyle(document.getElementById('rotate-hint')).display !== 'none'");
    if (!rotateVisible) throw new Error("Portrait did not surface the rotate nudge");

    // Reduced motion must remove the boil and the shake, never the readability.
    await openGame(896, 414);
    const motionResult = await evaluate(`(async () => {
        const qa = window.__deadstopQa;
        qa.startRun();
        document.getElementById("tap-tutorial").classList.remove("visible");
        qa.setReducedMotion(true);
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
        const samples = [];
        const started = performance.now();
        await new Promise((resolve) => {
            const sample = (now) => {
                samples.push(qa.snapshot().cameraShake);
                if (now - started >= 1600) resolve();
                else requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
        });
        window.dispatchEvent(new KeyboardEvent("keyup", { key: "d" }));
        const state = qa.snapshot();
        qa.setReducedMotion(false);
        return { samples: samples.length, maxShake: Math.max(...samples), alive: state.alive };
    })()`);
    console.log(`MOTION ${JSON.stringify(motionResult)}`);
    if (motionResult.maxShake > 0) {
        throw new Error(`Reduced motion regression: camera shook to ${motionResult.maxShake}`);
    }
    await capture(shot("landscape-reduced-motion"));

    // A heavy page on a throttled CPU.
    await command("Emulation.setCPUThrottlingRate", { rate: 4 });
    const performanceResult = await evaluate(`(async () => {
        const qa = window.__deadstopQa;
        qa.startRun();
        document.getElementById("tap-tutorial").classList.remove("visible");
        qa.setPerformanceHud(true);
        qa.forceLevel(14);
        qa.forceWeapon("smg", 26);
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
        const frameTimes = [];
        let previous = performance.now();
        const started = previous;
        await new Promise((resolve) => {
            const sample = (now) => {
                frameTimes.push(now - previous);
                previous = now;
                if (now - started >= 10000) resolve();
                else requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
        });
        window.dispatchEvent(new KeyboardEvent("keyup", { key: "d" }));
        const sorted = [...frameTimes].sort((a, b) => a - b);
        const averageMs = frameTimes.reduce((total, value) => total + value, 0) / frameTimes.length;
        return {
            cpuThrottle: 4,
            sampleSeconds: (previous - started) / 1000,
            frames: frameTimes.length,
            averageFps: 1000 / averageMs,
            averageFrameMs: averageMs,
            p95FrameMs: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
            p99FrameMs: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
            qa: qa.snapshot(),
        };
    })()`);
    console.log(`PERFORMANCE ${JSON.stringify(performanceResult)}`);
    if (performanceResult.averageFps < 55) {
        throw new Error(`Performance regression: ${performanceResult.averageFps.toFixed(1)} average FPS`);
    }
    if (performanceResult.p95FrameMs > 24) {
        throw new Error(`Performance regression: ${performanceResult.p95FrameMs.toFixed(1)} ms p95 frame`);
    }
    if (!performanceResult.qa.performance.enabled) {
        throw new Error("Frame counter did not activate");
    }
    if (!performanceResult.qa.performance.rendererReason) {
        throw new Error("Frame counter did not explain the renderer path");
    }
    await capture(shot("landscape-performance-hud"));
    await command("Emulation.setCPUThrottlingRate", { rate: 1 });
} finally {
    if (socket?.readyState === WebSocket.OPEN) socket.close();
    if (chrome.exitCode === null) {
        const exited = new Promise((resolveExit) => chrome.once("exit", resolveExit));
        chrome.kill("SIGTERM");
        await exited;
    }
    await rm(profileDir, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
}
