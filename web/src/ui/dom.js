/**
 * A tiny DOM builder.
 *
 * The page has no framework and no build step, so this stands in for the
 * templating layer: enough to build the boards without string concatenation
 * and without ever assigning untrusted text through `innerHTML`.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export function el(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  applyAttributes(node, attributes);
  append(node, children);
  return node;
}

export function svg(tag, attributes = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  applyAttributes(node, attributes, true);
  append(node, children);
  return node;
}

function applyAttributes(node, attributes, isSVG = false) {
  for (const [key, value] of Object.entries(attributes)) {
    if (value == null || value === false) continue;
    if (key === 'text') {
      node.textContent = String(value);
      continue;
    }
    if (key === 'class') {
      node.setAttribute('class', value);
      continue;
    }
    if (key === 'dataset') {
      for (const [name, item] of Object.entries(value)) node.dataset[name] = String(item);
      continue;
    }
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
      continue;
    }
    node.setAttribute(key, isSVG || typeof value !== 'boolean' ? String(value) : '');
  }
}

function append(node, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Replaces a node's children in place. */
export function replaceChildren(node, children) {
  node.replaceChildren();
  append(node, children);
}
