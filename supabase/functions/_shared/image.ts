// Обрезка по центру до 3:4, уменьшение и WebP. ImageMagick в WASM: читает JPEG/PNG/WebP/HEIC.
import {
  ImageMagick,
  initializeImageMagick,
  MagickFormat,
  MagickGeometry,
  ResourceLimits,
} from "npm:@imagemagick/magick-wasm@0.0.45";

let ready: Promise<void> | null = null;

function init() {
  ready ??= (async () => {
    const wasm = await Deno.readFile(
      new URL("x86/magick.wasm", import.meta.resolve("npm:@imagemagick/magick-wasm@0.0.45")),
    );
    await initializeImageMagick(wasm);
    // Защита от «бомб»: огромные размеры в заголовке при маленьком файле
    ResourceLimits.width = 12000n;
    ResourceLimits.height = 12000n;
    ResourceLimits.area = 60_000_000n;
  })();
  return ready;
}

export class ImageProcessError extends Error {}

/** Возвращает WebP 3:4, длинная сторона не больше maxSide. */
export async function toCover(bytes: Uint8Array, maxSide: number, quality: number): Promise<Uint8Array> {
  await init();
  try {
    return ImageMagick.read(bytes, (img) => {
      img.autoOrient();
      const ratio = 3 / 4;
      let w = img.width;
      let h = img.height;
      if (w / h > ratio) w = Math.round(h * ratio);
      else h = Math.round(w / ratio);
      img.crop(new MagickGeometry(Math.round((img.width - w) / 2), Math.round((img.height - h) / 2), w, h));
      img.resetPage();
      const scale = Math.min(1, maxSide / Math.max(w, h));
      if (scale < 1) {
        const g = new MagickGeometry(Math.round(w * scale), Math.round(h * scale));
        g.ignoreAspectRatio = true;
        img.resize(g);
      }
      img.strip(); // без EXIF и геометок
      img.quality = quality;
      return img.write(MagickFormat.WebP, (data) => new Uint8Array(data));
    });
  } catch (e) {
    throw new ImageProcessError(String(e));
  }
}
