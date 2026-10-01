export async function optimizeCover(blob: Blob, maxSide = 512): Promise<Blob> {
  if (blob.size > 20 * 1024 * 1024) throw new Error(t("coverTooLarge"));
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth * image.naturalHeight > 40_000_000)
      throw new Error(t("coverDimensions"));
    const scale = Math.min(
      1,
      maxSide / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error(t("coverOptimizeFailed"));
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const cover = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.8),
    );
    if (!cover || cover.size > 512 * 1024)
      throw new Error(t("coverTooLarge"));
    return cover;
  } finally {
    URL.revokeObjectURL(url);
  }
}
import { t } from "../../i18n";
