import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import sharp from 'sharp';

const publicBrand = join(process.cwd(), 'public/brand');

const NAVY = '#0F1729';
const CORAL = '#E2694B';
const SURFACE = '#FFFFFF';

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="-12.2 -18.05 124 124"><rect x="-12.2" y="-18.05" width="124" height="124" rx="27.9" fill="${NAVY}"/><path d="M16 74.8V30.8A19 19 0 0 1 35 11.8H64" fill="none" stroke="${CORAL}" stroke-width="12" stroke-linecap="round"/><circle cx="82.4" cy="11.8" r="4.4" fill="${NAVY}" stroke="${CORAL}" stroke-width="5.6"/><circle cx="16" cy="74.8" r="8.6" fill="#FFFFFF"/></svg>`;

/**
 * Manrope is a webfont, so the rasterizer has no system face for it and silently
 * substitutes. Glyph positions are therefore measured from whatever face actually
 * renders rather than hardcoded, otherwise the lockup drifts apart.
 */
const FAMILY = 'Helvetica, Arial, sans-serif';
const SIZE = 100;
const TRACKING = -0.035 * SIZE;

/** Arc geometry in em, converted from the ReferrioWordmark viewBox (1 unit = 0.01em). */
const ARC = {
  boxWidth: 0.38,
  boxHeight: 0.8,
  stemX: 0.16,
  topY: 0.118,
  cornerY: 0.308,
  cornerEndX: 0.35,
  cornerRadius: 0.19,
  bottomY: 0.748,
  stroke: 0.104,
  footRadius: 0.056,
  ringRadius: 0.046,
  ringStroke: 0.048,
  /** Negative margins that let the arc tuck against the letters on either side. */
  lead: -0.025,
  trail: -0.06,
  /** Breathing room between the end of the arm and the ring it points at. */
  armGap: 0.014,
};

const PEN = 400;
const BASELINE = 220;
const PROBE_WIDTH = 1800;
const PROBE_HEIGHT = 340;

function probeSvg(text: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PROBE_WIDTH}" height="${PROBE_HEIGHT}"><rect width="${PROBE_WIDTH}" height="${PROBE_HEIGHT}" fill="#fff"/><text x="${PEN}" y="${BASELINE}" font-family="${FAMILY}" font-size="${SIZE}" font-weight="700" letter-spacing="${TRACKING}" fill="#000">${text}</text></svg>`;
}

/** Pen-relative [start, end] column ranges of each visually separate ink island. */
async function inkIslands(text: string): Promise<Array<[number, number]>> {
  const { data, info } = await sharp(Buffer.from(probeSvg(text)))
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const islands: Array<[number, number]> = [];
  let start = -1;
  for (let x = 0; x <= info.width; x++) {
    let hasInk = false;
    if (x < info.width) {
      for (let y = 0; y < info.height; y++) {
        if (data[y * info.width + x] < 200) {
          hasInk = true;
          break;
        }
      }
    }
    if (hasInk && start < 0) {
      start = x;
    } else if (!hasInk && start >= 0) {
      islands.push([start - PEN, x - 1 - PEN]);
      start = -1;
    }
  }
  return islands;
}

/**
 * Advance width of a run, found by appending a marker glyph and reading where its
 * ink lands. Ink width alone would ignore side bearings and pack the letters too tight.
 */
async function advanceWidth(text: string, markerBearing: number): Promise<number> {
  const withMarker = await inkIslands(`${text}I`);
  const bare = await inkIslands(text);
  if (withMarker.length !== bare.length + 1) {
    throw new Error(`Marker glyph merged into "${text}"; cannot measure advance width.`);
  }
  return withMarker[withMarker.length - 1][0] - markerBearing;
}

async function buildWordmark(): Promise<Buffer> {
  const markerBearing = (await inkIslands('I'))[0][0];
  const headAdvance = await advanceWidth('Refe', markerBearing);

  // The dotless i leaves room for the arc's ring to act as its dot.
  const tail = 'r\u0131o';
  const tailIslands = await inkIslands(tail);
  if (tailIslands.length !== 3) {
    throw new Error(`Expected r/dotless-i/o to render as 3 separate shapes, got ${tailIslands.length}.`);
  }
  const tailAdvance = await advanceWidth(tail, markerBearing);

  const em = (value: number) => value * SIZE;
  const arcLeft = headAdvance + em(ARC.lead);
  const tailX = arcLeft + em(ARC.boxWidth) + em(ARC.trail);

  const [dotlessStart, dotlessEnd] = tailIslands[1];
  const ringCx = tailX + (dotlessStart + dotlessEnd) / 2;
  const boxTop = BASELINE - em(ARC.boxHeight);
  const ringCy = boxTop + em(ARC.topY);
  const armEndX = ringCx - em(ARC.ringRadius + ARC.ringStroke / 2 + ARC.armGap);

  const arcPath = [
    `M${arcLeft + em(ARC.stemX)} ${boxTop + em(ARC.bottomY)}`,
    `V${boxTop + em(ARC.cornerY)}`,
    `A${em(ARC.cornerRadius)} ${em(ARC.cornerRadius)} 0 0 1 ${arcLeft + em(ARC.cornerEndX)} ${ringCy}`,
    `H${armEndX}`,
  ].join('');

  const ringOuter = em(ARC.ringRadius + ARC.ringStroke / 2);
  const inkLeft = (await inkIslands('Refe'))[0][0];
  const viewLeft = inkLeft - 2;
  const viewRight = tailX + tailIslands[2][1] + 2;
  const viewTop = Math.min(ringCy - ringOuter, BASELINE - em(0.76)) - 2;
  const viewBottom = boxTop + em(ARC.bottomY + ARC.footRadius) + 2;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewLeft} ${viewTop} ${viewRight - viewLeft} ${viewBottom - viewTop}">
  <text x="0" y="${BASELINE}" font-family="${FAMILY}" font-size="${SIZE}" font-weight="700" letter-spacing="${TRACKING}" fill="${NAVY}">Refe</text>
  <path d="${arcPath}" fill="none" stroke="${CORAL}" stroke-width="${em(ARC.stroke)}" stroke-linecap="round"/>
  <circle cx="${ringCx}" cy="${ringCy}" r="${em(ARC.ringRadius)}" fill="${SURFACE}" stroke="${CORAL}" stroke-width="${em(ARC.ringStroke)}"/>
  <circle cx="${arcLeft + em(ARC.stemX)}" cy="${boxTop + em(ARC.bottomY)}" r="${em(ARC.footRadius)}" fill="${NAVY}"/>
  <text x="${tailX}" y="${BASELINE}" font-family="${FAMILY}" font-size="${SIZE}" font-weight="700" letter-spacing="${TRACKING}" fill="${NAVY}">${tail}</text>
</svg>`;

  // Rendered at 2x the 28px display height so it stays sharp on retina clients.
  return sharp(Buffer.from(svg)).resize({ height: 56 }).png().toBuffer();
}

function writePng(path: string, data: Buffer) {
  writeFileSync(path, Uint8Array.from(data));
}

async function main() {
  const icon = await sharp(Buffer.from(ICON_SVG)).resize(64, 64).png().toBuffer();
  writePng(join(publicBrand, 'email-icon.png'), icon);

  const wordmark = await buildWordmark();
  const { width, height } = await sharp(wordmark).metadata();
  writePng(join(publicBrand, 'email-wordmark.png'), wordmark);

  console.log(`Wrote public/brand/email-icon.png (64x64) and public/brand/email-wordmark.png (${width}x${height})`);
}

void main();
