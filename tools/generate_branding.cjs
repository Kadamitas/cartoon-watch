const fs = require("node:fs"), path = require("node:path");
const { chromium } = require("../companion/node_modules/playwright");
const root = path.resolve(__dirname, ".."), navy = "#111623", cream = "#FFF1D6", coral = "#FF805E";
const c = "M116 41C101 23 72 21 49 33C22 47 10 76 12 107C14 138 33 158 60 159C78 160 95 153 108 139L100 111C91 122 79 128 68 125C56 122 51 110 55 94C59 76 69 65 81 66C89 66 94 70 99 77L116 41Z";
const w = "M111 42L142 34L140 111L163 44L190 39L186 110L217 30L248 40L203 158L169 161L169 111L149 162L115 155L111 42Z";
const glyphs = {
    C: "M8 1H3Q1 1 1 3V9Q1 11 3 11H8", A: "M0 11L4 1L8 11M2 7H6",
    R: "M1 11V1H5Q8 1 8 4Q8 6 5 6H1M5 6L8 11", T: "M0 1H8M4 1V11",
    O: "M3 1H6Q8 1 8 3V9Q8 11 6 11H3Q1 11 1 9V3Q1 1 3 1Z", N: "M1 11V1L8 11V1",
    W: "M0 1L2 11L5 5L8 11L10 1", H: "M1 1V11M8 1V11M1 6H8"
};
function group(children, x = 0, y = 0, scale = 1, scaleY = scale) { return { children, x, y, scale, scaleY }; }
function shape(d, fill, stroke, width = 0) { return { d, fill, stroke, width }; }
function mark() {
    return [group([shape(c, navy, "#070A11", 22), shape(w, navy, "#070A11", 22)], 3, 10),
        shape(c, cream, cream, 18), shape(w, coral, cream, 18),
        shape(c, cream, navy, 9), shape(w, coral, navy, 9),
        shape("M124 49L131 47L130 78L124 94Z", "#FFAD7A"),
        shape("M223 42L232 45L211 97L204 97Z", "#FFAD7A"),
        shape("M31 172L194 169L178 181L43 185Z", coral),
        shape("M36 26L40 12L44 25L58 29L44 33L40 46L35 33L23 30Z", "#76D9CC")];
}
function wordmark() {
    let x = 0;
    return [..."CARTOON WATCH"].flatMap(letter => {
        const start = x;
        x += letter === " " ? 7 : letter === "W" ? 15 : 13;
        return letter === " " ? [] : [group([shape(glyphs[letter], "none", cream, 1.9)], start)];
    });
}
function scene(width, height, square = false) {
    const objects = [shape(`M0 0H${width}V${height}H0Z`, navy)];
    if (square) objects.push(group(mark(), width * .12, height * .205, width * .00295));
    else {
        const s = Math.min(width / 320, height / 180), left = (width - 320 * s) / 2, top = (height - 180 * s) / 2;
        objects.push(group([group(mark(), 63, 8, .76), group(wordmark(), 82, 153, 1.02)], left, top, s));
    }
    return objects;
}
function televisionScene(width, height) {
    return [shape(`M0 0H${width}V${height}H0Z`, navy), group([group(mark(), 12, 8, 1.12, .88)], 0, 0, width / 320)];
}
function svg(objects, width, height) {
    const draw = nodes => nodes.map(n => n.children ? `<g transform="translate(${n.x} ${n.y}) scale(${n.scale}${n.scaleY === n.scale ? "" : " " + n.scaleY})">${draw(n.children)}</g>` : `<path d="${n.d}" fill="${n.fill}"${n.stroke ? ` stroke="${n.stroke}" stroke-width="${n.width}" stroke-linejoin="round" stroke-linecap="round"` : ""}/>`).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${draw(objects)}</svg>\n`;
}
function vector(objects, width, height) {
    const draw = (nodes, indent) => nodes.map(n => n.children ? `${indent}<group android:translateX="${n.x}" android:translateY="${n.y}" android:scaleX="${n.scale}" android:scaleY="${n.scaleY}">\n${draw(n.children, indent + "    ")}\n${indent}</group>` : `${indent}<path android:pathData="${n.d}" android:fillColor="${n.fill === "none" ? "#00000000" : n.fill}"${n.stroke ? ` android:strokeColor="${n.stroke}" android:strokeWidth="${n.width}" android:strokeLineJoin="round" android:strokeLineCap="round"` : ""} />`).join("\n");
    return `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="${width}dp" android:height="${height}dp" android:viewportWidth="${width}" android:viewportHeight="${height}">\n${draw(objects, "    ")}\n</vector>\n`;
}
function write(file, data) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
}
(async () => {
    write("app/src/main/assets/brand.svg", svg(scene(108, 108, true), 108, 108));
    write("branding/banner.svg", svg(scene(320, 180), 320, 180));
    write("app/src/main/res/drawable/cw_launcher.xml", vector(scene(108, 108, true), 108, 108));
    write("app/src/main/res/drawable/cw_banner.xml", vector(scene(320, 180), 320, 180));
    write("app/src/main/res/drawable-television/cw_launcher.xml", vector(televisionScene(320, 180), 320, 180));
    const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
    const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || (process.platform === "win32" && fs.existsSync(edge) ? edge : undefined) });
    try {
        const page = await browser.newPage({ deviceScaleFactor: 1 });
        for (const [file, width, height, square, television] of [
            ["branding/icon-80.png", 80, 80, true], ["branding/icon-128.png", 128, 128, true], ["branding/icon-130.png", 130, 130, true],
            ["clients/roku/images/channel.png", 540, 405], ["clients/roku/images/card.png", 336, 164], ["clients/roku/images/splash.png", 1920, 1080],
            ["outputs/Cartoon-Watch-Icon.png", 512, 512, true], ["outputs/Cartoon-Watch-Banner.png", 960, 540], ["outputs/Cartoon-Watch-TV-Icon.png", 960, 540, false, true]
        ]) {
            await page.setViewportSize({ width, height });
            await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}svg{display:block}</style>${svg(television ? televisionScene(width, height) : scene(width, height, square), width, height)}`);
            write(file, await page.screenshot({ type: "png", animations: "disabled" }));
        }
    } finally { await browser.close(); }
    console.log("Generated CW vectors and launcher images.");
})().catch(error => { console.error(error); process.exitCode = 1; });
