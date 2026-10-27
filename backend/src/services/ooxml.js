import { DOMParser } from '@xmldom/xmldom';
import path from 'path';

// Shared helpers for reading Office Open XML packages (.pptx, .docx):
// namespace-agnostic DOM walking by qualified tag name, part loading,
// and relationship resolution.

// --- tiny DOM helpers (namespace-agnostic, by qualified tag name) ------

export function children(node, tag) {
  const out = [];
  if (!node) return out;
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && (!tag || c.nodeName === tag)) out.push(c);
  }
  return out;
}

export function child(node, tag) {
  return children(node, tag)[0] || null;
}

// Follows a path of tag names, e.g. find(sp, 'p:spPr', 'a:xfrm', 'a:off').
export function find(node, ...tags) {
  let cur = node;
  for (const tag of tags) {
    cur = child(cur, tag);
    if (!cur) return null;
  }
  return cur;
}

export function attr(node, name) {
  return node?.getAttribute(name) || null;
}

export function num(node, name) {
  const v = attr(node, name);
  return v === null ? null : Number(v);
}

export function parseXml(text) {
  return new DOMParser({ onError: () => {} }).parseFromString(text, 'text/xml').documentElement;
}

// --- package helpers ----------------------------------------------------

export async function readXml(zip, partPath) {
  const file = zip.file(partPath);
  if (!file) return null;
  return parseXml(await file.async('string'));
}

// Relationships for a part, as Map(rId -> absolute part path).
export async function readRels(zip, partPath) {
  const relsPath = path.posix.join(path.posix.dirname(partPath), '_rels', `${path.posix.basename(partPath)}.rels`);
  const root = await readXml(zip, relsPath);
  const rels = new Map();
  if (!root) return rels;
  for (const rel of children(root, 'Relationship')) {
    if (attr(rel, 'TargetMode') === 'External') continue;
    const target = attr(rel, 'Target');
    const resolved = target.startsWith('/')
      ? target.slice(1)
      : path.posix.normalize(path.posix.join(path.posix.dirname(partPath), target));
    rels.set(attr(rel, 'Id'), { target: resolved, type: attr(rel, 'Type') || '' });
  }
  return rels;
}

export function relOfType(rels, suffix) {
  for (const rel of rels.values()) if (rel.type.endsWith(suffix)) return rel.target;
  return null;
}

