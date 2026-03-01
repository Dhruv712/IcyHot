import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const FLOW_FADE_START_MS = 4_000;
export const FLOW_FADE_FULL_MS = 18_000;
export const FLOW_IDLE_REVEAL_MS = 4_500;
export const FLOW_MIN_OPACITY = 0.1;
export const FLOW_TICK_MS = 250;

const ELIGIBLE_NODE_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "bulletList",
  "orderedList",
]);

export interface FlowDebugBlock {
  index: number;
  pos: number;
  key: string;
  ageMs: number;
  opacity: number;
  eligible: boolean;
}

export interface FlowDebugState {
  enabled: boolean;
  revealed: boolean;
  writing: boolean;
  activeBlockIndex: number;
  blockCount: number;
  fadedBlockCount: number;
  blocks: FlowDebugBlock[];
}

interface FlowTrackedBlock {
  index: number;
  pos: number;
  to: number;
  key: string;
  nodeType: string;
  textContent: string;
  touchedAt: number;
}

interface FlowPluginState {
  enabled: boolean;
  revealed: boolean;
  writing: boolean;
  activeBlockIndex: number;
  lastInputAt: number | null;
  lastTickAt: number;
  lastSelectionFrom: number;
  lastSelectionTo: number;
  blocks: FlowTrackedBlock[];
  decorations: DecorationSet;
}

type FlowMeta =
  | { type: "setEnabled"; enabled: boolean; now: number }
  | { type: "reveal"; now: number }
  | { type: "tick"; now: number };

export const flowModePluginKey = new PluginKey<FlowPluginState>("flowMode");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    flowMode: {
      flowSetEnabled: (enabled: boolean) => ReturnType;
      flowReveal: () => ReturnType;
      flowTick: (now?: number) => ReturnType;
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hashText(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

function getActiveBlockIndex(doc: ProseMirrorNode, selectionFrom: number): number {
  try {
    return doc.resolve(selectionFrom).index(0);
  } catch {
    return 0;
  }
}

function buildStableBlockKey(
  node: ProseMirrorNode,
  duplicateCount: number,
): string {
  return `${node.type.name}:${hashText(node.textContent.trim())}:${duplicateCount}`;
}

function reconcileBlocks(
  doc: ProseMirrorNode,
  previousBlocks: FlowTrackedBlock[],
  activeBlockIndex: number,
  now: number,
  lastInputAt: number | null,
): FlowTrackedBlock[] {
  const previousByKey = new Map(previousBlocks.map((block) => [block.key, block]));
  const duplicateCounter = new Map<string, number>();
  const nextBlocks: FlowTrackedBlock[] = [];

  doc.forEach((node, pos, index) => {
    const baseKey = `${node.type.name}:${hashText(node.textContent.trim())}`;
    const duplicateCount = (duplicateCounter.get(baseKey) ?? 0) + 1;
    duplicateCounter.set(baseKey, duplicateCount);
    const key = buildStableBlockKey(node, duplicateCount);
    const previous = previousByKey.get(key);

    nextBlocks.push({
      index,
      pos,
      to: pos + node.nodeSize,
      key,
      nodeType: node.type.name,
      textContent: node.textContent,
      touchedAt:
        previous?.touchedAt ??
        (index === activeBlockIndex ? now : (lastInputAt ?? now)),
    });
  });

  return nextBlocks;
}

function computeOpacity(ageMs: number): number {
  const progress = clamp(
    (ageMs - FLOW_FADE_START_MS) / (FLOW_FADE_FULL_MS - FLOW_FADE_START_MS),
    0,
    1,
  );
  const eased = easeOutCubic(progress);
  return 1 - eased * (1 - FLOW_MIN_OPACITY);
}

function isEligibleBlock(state: FlowPluginState, block: FlowTrackedBlock): boolean {
  return (
    state.enabled &&
    !state.revealed &&
    block.index < state.activeBlockIndex &&
    ELIGIBLE_NODE_TYPES.has(block.nodeType) &&
    block.textContent.trim().length > 0
  );
}

function buildDecorations(doc: ProseMirrorNode, state: FlowPluginState): DecorationSet {
  if (!state.enabled || state.revealed) {
    return DecorationSet.empty;
  }

  const decorations = state.blocks
    .filter((block) => isEligibleBlock(state, block))
    .map((block) => {
      const ageMs = Math.max(0, state.lastTickAt - block.touchedAt);
      const opacity = computeOpacity(ageMs);
      const progress = clamp(
        (ageMs - FLOW_FADE_START_MS) / (FLOW_FADE_FULL_MS - FLOW_FADE_START_MS),
        0,
        1,
      );
      const filter = progress > 0.35 ? "saturate(0.8)" : "none";

      return Decoration.node(block.pos, block.to, {
        "data-flow-block": "true",
        "data-flow-faded": opacity < 0.995 ? "true" : "false",
        "data-flow-opacity": opacity.toFixed(3),
        style: `opacity:${opacity.toFixed(3)};filter:${filter};`,
      });
    });

  return DecorationSet.create(doc, decorations);
}

function toDebugState(state: FlowPluginState): FlowDebugState {
  const blocks = state.blocks.map((block) => {
    const eligible = isEligibleBlock(state, block);
    const ageMs = eligible ? Math.max(0, state.lastTickAt - block.touchedAt) : 0;
    const opacity = eligible ? computeOpacity(ageMs) : 1;

    return {
      index: block.index,
      pos: block.pos,
      key: block.key,
      ageMs,
      opacity,
      eligible,
    } satisfies FlowDebugBlock;
  });

  return {
    enabled: state.enabled,
    revealed: state.revealed,
    writing: state.writing,
    activeBlockIndex: state.activeBlockIndex,
    blockCount: state.blocks.length,
    fadedBlockCount: blocks.filter((block) => block.eligible && block.opacity < 0.995).length,
    blocks,
  };
}

function withDecorations(doc: ProseMirrorNode, state: Omit<FlowPluginState, "decorations">): FlowPluginState {
  const nextState: FlowPluginState = {
    ...state,
    decorations: DecorationSet.empty,
  };
  nextState.decorations = buildDecorations(doc, nextState);
  return nextState;
}

function buildInitialState(doc: ProseMirrorNode, selectionFrom: number, enabled: boolean, now: number): FlowPluginState {
  const activeBlockIndex = getActiveBlockIndex(doc, selectionFrom);
  const blocks = reconcileBlocks(doc, [], activeBlockIndex, now, null);

  return withDecorations(doc, {
    enabled,
    revealed: true,
    writing: false,
    activeBlockIndex,
    lastInputAt: null,
    lastTickAt: now,
    lastSelectionFrom: selectionFrom,
    lastSelectionTo: selectionFrom,
    blocks,
  });
}

function applyMeta(
  doc: ProseMirrorNode,
  previousState: FlowPluginState,
  nextState: FlowPluginState,
  meta: FlowMeta | undefined,
): FlowPluginState {
  if (!meta) return nextState;

  if (meta.type === "setEnabled") {
    const enabledState = {
      ...nextState,
      enabled: meta.enabled,
      revealed: true,
      writing: false,
      lastTickAt: meta.now,
    };
    return withDecorations(doc, enabledState);
  }

  if (meta.type === "reveal") {
    return withDecorations(doc, {
      ...nextState,
      revealed: true,
      writing: false,
      lastTickAt: meta.now,
    });
  }

  if (meta.type === "tick") {
    return withDecorations(doc, {
      ...nextState,
      lastTickAt: meta.now,
    });
  }

  return nextState;
}

export function getFlowDebugState(editor: Editor | null): FlowDebugState | null {
  if (!editor) return null;
  const state = flowModePluginKey.getState(editor.state);
  return state ? toDebugState(state) : null;
}

export const FlowModeExtension = Extension.create<{ enabled: boolean }>({
  name: "flowMode",

  addOptions() {
    return {
      enabled: false,
    };
  },

  addCommands() {
    return {
      flowSetEnabled:
        (enabled: boolean) =>
        ({ tr, dispatch }) => {
          dispatch?.(
            tr.setMeta(flowModePluginKey, {
              type: "setEnabled",
              enabled,
              now: Date.now(),
            } satisfies FlowMeta),
          );
          return true;
        },
      flowReveal:
        () =>
        ({ tr, dispatch }) => {
          dispatch?.(
            tr.setMeta(flowModePluginKey, {
              type: "reveal",
              now: Date.now(),
            } satisfies FlowMeta),
          );
          return true;
        },
      flowTick:
        (now?: number) =>
        ({ tr, dispatch }) => {
          dispatch?.(
            tr.setMeta(flowModePluginKey, {
              type: "tick",
              now: now ?? Date.now(),
            } satisfies FlowMeta),
          );
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const initialEnabled = this.options.enabled;

    return [
      new Plugin<FlowPluginState>({
        key: flowModePluginKey,
        state: {
          init: (_, state) => buildInitialState(state.doc, state.selection.from, initialEnabled, Date.now()),
          apply: (tr, previous, _oldState, newState) => {
            const meta = tr.getMeta(flowModePluginKey) as FlowMeta | undefined;
            const now = meta?.now ?? Date.now();
            const activeBlockIndex = getActiveBlockIndex(newState.doc, newState.selection.from);
            let next = withDecorations(
              newState.doc,
              {
                ...previous,
                activeBlockIndex,
                blocks: reconcileBlocks(
                  newState.doc,
                  previous.blocks,
                  activeBlockIndex,
                  now,
                  previous.lastInputAt,
                ),
                lastSelectionFrom: newState.selection.from,
                lastSelectionTo: newState.selection.to,
              },
            );

            if (tr.docChanged && next.enabled) {
              next = withDecorations(newState.doc, {
                ...next,
                revealed: false,
                writing: true,
                lastInputAt: now,
                lastTickAt: now,
                blocks: next.blocks.map((block) =>
                  block.index === activeBlockIndex ? { ...block, touchedAt: now } : block,
                ),
              });
            }

            if (tr.selectionSet) {
              const movedUpward = activeBlockIndex < previous.activeBlockIndex;
              const hasSelection = newState.selection.from !== newState.selection.to;

              if (hasSelection || movedUpward) {
                next = withDecorations(newState.doc, {
                  ...next,
                  revealed: true,
                  writing: false,
                });
              }
            }

            return applyMeta(newState.doc, previous, next, meta);
          },
        },
        props: {
          decorations(state) {
            return flowModePluginKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
