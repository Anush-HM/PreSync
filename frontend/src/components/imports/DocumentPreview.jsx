import './review.css';

// Groups flat list items (with levels) into nested <ul>/<ol> trees.
function ListTree({ items }) {
  const root = [];
  const stack = [{ level: -1, children: root }];
  items.forEach((item) => {
    while (stack.length > 1 && stack[stack.length - 1].level >= item.level) stack.pop();
    const node = { ...item, children: [] };
    stack[stack.length - 1].children.push(node);
    stack.push({ level: item.level, children: node.children });
  });
  const render = (nodes) => {
    const ordered = nodes[0]?.ordered;
    const Tag = ordered ? 'ol' : 'ul';
    return (
      <Tag>
        {nodes.map((n, i) => (
          <li key={i}>
            {n.text}
            {n.children.length > 0 && render(n.children)}
          </li>
        ))}
      </Tag>
    );
  };
  return render(root);
}

// Read-only rendering of the Word document as PreSync parsed it, with
// markers where the suggested outline starts a new slide.
function DocumentPreview({ blocks, images, headings }) {
  const imageById = new Map((images || []).map((i) => [i.id, i]));
  const slideStarts = new Set((headings || []).filter((h) => h.startsSlide).map((h) => h.blockIndex));

  return (
    <article className="doc-paper" aria-label="Document preview">
      {blocks.map((b, i) => {
        const tag = slideStarts.has(i) ? <span className="doc-slide-marker mono">New slide</span> : null;
        switch (b.type) {
          case 'title':
            return <h1 key={i} className="doc-title">{b.text}</h1>;
          case 'subtitle':
            return <p key={i} className="doc-subtitle">{b.text}</p>;
          case 'heading': {
            const Tag = `h${Math.min(6, b.level + 1)}`;
            return <Tag key={i} className={`doc-h doc-h${b.level}`}>{tag}{b.text}</Tag>;
          }
          case 'paragraph':
            return <p key={i} className="doc-p">{b.text}</p>;
          case 'list':
            return <div key={i} className="doc-list"><ListTree items={b.items} /></div>;
          case 'table':
            return (
              <div key={i} className="doc-table-wrap">
                <table className="doc-table">
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r}>{row.map((cell, c) => (r === 0 ? <th key={c} scope="col">{cell}</th> : <td key={c}>{cell}</td>))}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'image': {
            const img = imageById.get(b.imageId);
            return img ? <img key={i} className="doc-img" src={img.dataUrl} alt="Picture from the document" /> : null;
          }
          default:
            return null;
        }
      })}
    </article>
  );
}

export default DocumentPreview;
