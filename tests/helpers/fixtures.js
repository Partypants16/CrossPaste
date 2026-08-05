import sharp from 'sharp';

export async function createPngBuffer({ width = 20, height = 20 } = {}) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 50, b: 50 } },
  })
    .png()
    .toBuffer();
}

export async function createJpegBuffer({ width = 20, height = 20 } = {}) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 50, g: 120, b: 200 } },
  })
    .jpeg()
    .toBuffer();
}

export async function createGifBuffer({ width = 20, height = 20 } = {}) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 50, g: 200, b: 90 } },
  })
    .gif()
    .toBuffer();
}
