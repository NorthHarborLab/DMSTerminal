import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

const { chromium } = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
  : await import("playwright");
const screenshots = resolve(".impeccable/review");
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("dialog", (dialog) => dialog.accept());
function previewFixture() {
  const width = 160, height = 90;
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = (Math.floor(x / 20) + Math.floor(y / 15)) % 2 ? [48, 122, 160] : [120, 196, 195];
    const position = y * (width * 3 + 1) + 1 + x * 3;
    for (let channel = 0; channel < 3; channel++) pixels[position + channel] = color[channel];
  }
  function chunk(type, data) {
    const name = Buffer.from(type), result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length);
    name.copy(result, 4); data.copy(result, 8);
    let crc = 0xffffffff;
    for (const byte of Buffer.concat([name, data])) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8); return result;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
try {
  await page.goto("http://127.0.0.1:4173");
  await page.getByRole("button", { name: "添加服务器", exact: true }).click();
  await page.getByLabel("显示名称", { exact: true }).fill("本地 SFTP 测试");
  await page.getByLabel("主机地址", { exact: true }).fill("127.0.0.1");
  await page.getByLabel("端口", { exact: true }).fill("22222");
  await page.getByLabel("用户名", { exact: true }).fill("demo");
  await page.getByLabel("凭据保存", { exact: true }).selectOption("save");
  await page.getByLabel("SSH 密码", { exact: true }).fill("dsm-terminal-demo");
  await page.getByRole("button", { name: "保存服务器", exact: true }).click();
  await page.getByRole("button", { name: /本地 SFTP 测试.*凭据已保存/ }).click();
  assert.equal(await page.getByLabel("使用已加密保存的凭据").isChecked(), true);
  await page.getByRole("button", { name: "连接", exact: true }).click();
  await page.getByRole("button", { name: "信任并连接", exact: true }).click();
  await page.getByRole("cell", { name: "readme.txt", exact: true }).waitFor();
  const png = previewFixture();
  await page.locator('.file-toolbar input[type="file"]').setInputFiles({ name: "preview.png", mimeType: "image/png", buffer: png });
  await page.getByRole("cell", { name: "preview.png", exact: true }).waitFor();
  await page.getByRole("cell", { name: "readme.txt", exact: true }).click();
  await page.getByRole("button", { name: "重命名", exact: true }).click();
  await page.getByLabel("新名称", { exact: true }).fill("readme-renamed.txt");
  await page.getByRole("cell", { name: "preview.png", exact: true }).click();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await page.getByRole("cell", { name: "readme-renamed.txt", exact: true }).waitFor();
  assert.equal(await page.getByRole("cell", { name: "preview.png", exact: true }).count(), 1);
  await page.getByRole("cell", { name: "readme-renamed.txt", exact: true }).click();
  await page.getByRole("button", { name: "重命名", exact: true }).click();
  await page.getByLabel("新名称", { exact: true }).fill("readme.txt");
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await page.getByRole("cell", { name: "readme.txt", exact: true }).waitFor();
  await page.getByRole("cell", { name: "readme.txt", exact: true }).click();
  await page.locator(".file-text-preview").waitFor();
  await page.screenshot({ path: resolve(screenshots, "desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "缩略图视图", exact: true }).click();
  await page.getByRole("button", { name: /preview.png/ }).click();
  await page.locator(".file-image-preview").waitFor();
  await page.screenshot({ path: resolve(screenshots, "desktop-thumbnails.png"), fullPage: true });
  await page.getByRole("button", { name: "主题与颜色", exact: true }).first().click();
  await page.getByRole("button", { name: /明亮纸白/ }).click();
  await page.getByRole("button", { name: "应用主题", exact: true }).click();
  await page.screenshot({ path: resolve(screenshots, "desktop-light.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(screenshots, "mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "主题与颜色", exact: true }).click();
  await page.screenshot({ path: resolve(screenshots, "mobile-themes.png"), fullPage: true });
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "服务器", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "添加服务器", exact: true }).isVisible(), true);
  await page.getByRole("button", { name: "关闭服务器列表", exact: true }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, "Mobile document overflow");
  assert.deepEqual(errors, []);
  console.log("UI verification passed: encrypted saved login, terminal + SFTP, upload, text/image previews, theme switching, mobile navigation");
} finally { await browser.close(); }
