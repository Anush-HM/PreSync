const MAX_BYTES = 1.5 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/gif'];

function naturalSize(src) {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// A file as image attributes, no wider than the page's text column.
// Throws with a message for the user when the file can't be used.
export async function readImage(file, maxWidth) {
  if (!TYPES.includes(file.type)) throw new Error('Images must be PNG, JPEG or GIF.');
  if (file.size > MAX_BYTES) throw new Error('Images must be 1.5 MB or smaller.');
  const src = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
  const size = await naturalSize(src);
  if (!size?.width) return { src, alt: file.name };
  const width = Math.min(size.width, maxWidth || size.width);
  return { src, alt: file.name, width, height: Math.round((width * size.height) / size.width) };
}
