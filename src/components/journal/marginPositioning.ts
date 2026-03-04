"use client";

function normalizeBlockText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export interface MarginAnchorTarget {
  index: number;
  top: number;
  height: number;
  text: string;
  element: HTMLElement;
}

export interface ResolvedMarginAnchor {
  naturalTop: number;
  anchorY: number;
}

export function collectMarginAnchorTargets(editorElement: HTMLElement | null): MarginAnchorTarget[] {
  if (!editorElement) return [];
  const proseMirror = editorElement.querySelector(".ProseMirror");
  if (!proseMirror) return [];

  return Array.from(proseMirror.children)
    .map((child, index) => {
      const el = child as HTMLElement;
      const text = normalizeBlockText(el.innerText || el.textContent || "");
      return {
        index,
        top: el.offsetTop,
        height: el.offsetHeight,
        text,
        element: el,
      } satisfies MarginAnchorTarget;
    })
    .filter((target) => target.height > 0);
}

function anchorSnippet(text: string): string {
  return normalizeBlockText(text).slice(0, 120);
}

function findTextLineAnchorY(target: MarginAnchorTarget): number {
  const walker = document.createTreeWalker(target.element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();

  while (node) {
    const textNode = node as Text;
    const value = textNode.textContent ?? "";
    if (value.trim().length > 0) {
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, Math.min(value.length, 1));
      const rect = range.getBoundingClientRect();
      range.detach?.();

      if (rect.height > 0) {
        const containerRect = target.element.getBoundingClientRect();
        return target.top + (rect.top - containerRect.top) + rect.height / 2;
      }
    }
    node = walker.nextNode();
  }

  return target.top + Math.min(Math.max(target.height * 0.25, 12), 24);
}

export function resolveMarginAnchor(
  targets: MarginAnchorTarget[],
  paragraphIndex: number,
  anchorText?: string,
): ResolvedMarginAnchor | null {
  if (targets.length === 0) return null;

  const normalizedAnchor = normalizeBlockText(anchorText ?? "");
  const snippet = anchorSnippet(anchorText ?? "");
  const scoredTargets = normalizedAnchor
    ? targets
        .map((target) => {
          let score = 0;
          if (target.text === normalizedAnchor) score += 100;
          if (snippet && target.text.includes(snippet)) score += 60;
          if (snippet && normalizedAnchor.includes(target.text)) score += 25;
          score -= Math.abs(target.index - paragraphIndex);
          return { target, score };
        })
        .filter((entry) => entry.score > -20)
        .sort((a, b) => b.score - a.score)
    : [];

  const target =
    scoredTargets[0]?.target ??
    targets[paragraphIndex] ??
    null;

  if (!target) return null;

  const anchorY = findTextLineAnchorY(target);

  return {
    naturalTop: target.top,
    anchorY,
  };
}
