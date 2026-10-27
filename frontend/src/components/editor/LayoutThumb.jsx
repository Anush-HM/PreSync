// A small diagram of a layout's slots, for the layout chooser.
function LayoutThumb({ layout }) {
  return (
    <svg className="layout-thumb" viewBox="0 0 960 540" aria-hidden="true">
      <rect x="0" y="0" width="960" height="540" className={layout.background === 'accent' ? 'is-accent' : 'is-bg'} />
      {layout.slots.map((s, i) => {
        if (s.kind === 'image') return <rect key={i} x={s.x} y={s.y} width={s.width} height={s.height} className="is-image" />;
        if (s.kind === 'shape') {
          return s.shape === 'ellipse'
            ? <ellipse key={i} cx={s.x + s.width / 2} cy={s.y + s.height / 2} rx={s.width / 2} ry={s.height / 2} className="is-shape" />
            : <rect key={i} x={s.x} y={s.y} width={s.width} height={Math.max(6, s.height)} rx={s.shape === 'roundRect' ? 20 : 0} className="is-shape" />;
        }
        const h = s.kind === 'title' ? Math.max(24, s.fontSize * 0.9) : s.kind === 'subtitle' ? 18 : Math.min(s.height || 40, 220);
        const w = s.textAlign === 'center' ? s.width * 0.7 : s.width;
        const x = s.textAlign === 'center' ? s.x + (s.width - w) / 2 : s.x;
        return <rect key={i} x={x} y={s.y} width={w} height={h} rx="6" className={`is-${s.kind}`} />;
      })}
    </svg>
  );
}

export default LayoutThumb;
