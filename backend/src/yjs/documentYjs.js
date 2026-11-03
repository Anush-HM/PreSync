import * as Y from 'yjs';

// A Word document's shape inside its Y.Doc, as the editor's TipTap
// Collaboration extension (frontend, @tiptap/y-tiptap) reads and writes it:
//   - XML fragment 'default': the text. Every node is a Y.XmlElement named
//     after its type with its non-null attributes; runs of text are one
//     Y.XmlText whose formatting attributes are the marks, by mark name,
//     each holding that mark's attributes.
//   - map 'meta': title, page and layout, so co-editors see those change
//     too, and 'commentsRev', bumped whenever a comment thread changes so
//     open editors fetch the threads again.
export const FRAGMENT = 'default';
export const META = 'meta';

// Same rule as y-tiptap: overlapping marks get a "--hash" suffix.
const markName = (key) => /^(.*)--[a-zA-Z0-9+/=]{8}$/.exec(key)?.[1] ?? key;

function textDelta(nodes) {
  return nodes.map((n) => {
    const attributes = {};
    for (const m of n.marks || []) attributes[m.type] = m.attrs || {};
    return { insert: n.text || '', attributes };
  });
}

function toYType(node) {
  if (Array.isArray(node)) {
    const text = new Y.XmlText();
    text.applyDelta(textDelta(node));
    return text;
  }
  const el = new Y.XmlElement(node.type);
  for (const [key, value] of Object.entries(node.attrs || {})) {
    if (value !== null && value !== undefined) el.setAttribute(key, value);
  }
  const children = groupText(node.content || []).map(toYType);
  if (children.length) el.insert(0, children);
  return el;
}

// Neighbouring text nodes share one Y.XmlText.
function groupText(content) {
  const out = [];
  for (const child of content) {
    if (child.type === 'text') {
      const last = out[out.length - 1];
      if (Array.isArray(last)) last.push(child);
      else out.push([child]);
    } else {
      out.push(child);
    }
  }
  return out;
}

// Replaces everything in the fragment with this stored content.
export function writeContent(fragment, content) {
  const children = groupText(content?.content || []).map(toYType);
  const apply = () => {
    if (fragment.length) fragment.delete(0, fragment.length);
    if (children.length) fragment.insert(0, children);
  };
  if (fragment.doc) fragment.doc.transact(apply);
  else apply();
}

function fromYType(item) {
  if (item instanceof Y.XmlText) {
    return item.toDelta().filter((d) => typeof d.insert === 'string' && d.insert).map((d) => {
      const text = { type: 'text', text: d.insert };
      const attributes = d.attributes || {};
      const marks = Object.keys(attributes).map((key) => {
        const attrs = attributes[key];
        return attrs && typeof attrs === 'object' && Object.keys(attrs).length ? { type: markName(key), attrs } : { type: markName(key) };
      });
      if (marks.length) text.marks = marks;
      return text;
    });
  }
  if (item instanceof Y.XmlElement) {
    const node = { type: item.nodeName };
    const attrs = item.getAttributes();
    if (Object.keys(attrs).length) node.attrs = attrs;
    const children = item.toArray().flatMap(fromYType);
    if (children.length) node.content = children;
    return [node];
  }
  return [];
}

// The editor's JSON tree for what is in the fragment now.
export function readContent(fragment) {
  return { type: 'doc', content: fragment.toArray().flatMap(fromYType) };
}

// Seeds a fresh Y.Doc from a stored document.
export function fillDoc(doc, stored) {
  doc.transact(() => {
    writeContent(doc.getXmlFragment(FRAGMENT), stored.content);
    const meta = doc.getMap(META);
    meta.set('title', stored.title);
    meta.set('page', stored.page);
    meta.set('layout', stored.layout ?? null);
    meta.set('commentsRev', 0);
  });
}
