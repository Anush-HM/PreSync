import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

// QR code drawn as one SVG path, always dark-on-white so phone cameras
// can read it whatever the page theme.
function QrCode({ value, size = 200, label }) {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
      }
    }
    return { path: d, count: n + 8 }; // 4-module quiet zone on each side
  }, [value]);

  return (
    <svg
      className="qr"
      width={size}
      height={size}
      viewBox={`0 0 ${count} ${count}`}
      role="img"
      aria-label={label || `QR code for ${value}`}
      shapeRendering="crispEdges"
    >
      <rect width={count} height={count} fill="#ffffff" />
      <path d={path} fill="#111412" />
    </svg>
  );
}

export default QrCode;
