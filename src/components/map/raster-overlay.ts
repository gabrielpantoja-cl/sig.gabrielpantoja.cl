/** Helpers compartidos por las capas raster por viewport. */

export function waitForImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Invalid raster image'));
    image.src = url;
  });
}
