"use client";

function normalizeBlockText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export interface MarginAnchorTarget {
  index: number;
  top: number;
  height: number;
  text: string;
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
      } satisfies MarginAnchorTarget;
    })
    .filter((target) => target.height > 0);
}

export function resolveMarginAnchor(
  targets: MarginAnchorTarget[],
  paragraphIndex: number,
  anchorText?: string,
): ResolvedMarginAnchor | null {
  if (targets.length === 0) return null;

  const normalizedAnchor = normalizeBlockText(anchorText ?? "");
  const matchingTargets = normalizedAnchor
    ? targets.filter((target) => target.text === normalizedAnchor)
    : [];

  const target =
    matchingTargets.sort(
      (a, b) => Math.abs(a.index - paragraphIndex) - Math.abs(b.index - paragraphIndex),
    )[0] ??
    targets[paragraphIndex] ??
    null;

  if (!target) return null;

  const anchorY = target.top + Math.min(Math.max(target.height * 0.45, 12), 28);

  return {
    naturalTop: target.top,
    anchorY,
  };
}

