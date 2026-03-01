"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { useCallback, useEffect, useImperativeHandle, forwardRef, useRef } from "react";
import type { Editor } from "@tiptap/react";

export interface MarkdownEditorHandle {
  getMarkdown: () => string;
  revealFlow: () => void;
}

export interface FlowModeState {
  modeEnabled: boolean;
  isWriting: boolean;
  isRevealed: boolean;
  fadedCount: number;
  activeIndex: number;
}

// tiptap-markdown extends editor.storage with a markdown key
function getMarkdown(editor: Editor): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (editor.storage as any).markdown.getMarkdown();
}

const FLOW_IDLE_REVEAL_MS = 2_000;
const FLOW_FADE_START_MS = 30_000;
const FLOW_FADE_FULL_MS = 75_000;
const FLOW_MIN_OPACITY = 0.38;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getActiveBlockIndex(editor: Editor): number {
  try {
    const { $head } = editor.state.selection;
    return editor.state.doc.resolve($head.pos).index(0);
  } catch {
    return 0;
  }
}

function getTopLevelBlocks(editor: Editor): HTMLElement[] {
  return Array.from(editor.view.dom.children).filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );
}

interface MarkdownEditorProps {
  initialContent: string;
  onChange?: (markdown: string) => void;
  onActiveParagraph?: (paragraph: { index: number; text: string }) => void;
  placeholder?: string;
  flowMode?: boolean;
  onFlowStateChange?: (state: FlowModeState) => void;
}

const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(
    {
      initialContent,
      onChange,
      onActiveParagraph,
      placeholder = "Start writing...",
      flowMode = false,
      onFlowStateChange,
    },
    ref,
  ) {
    const paragraphTouchedAtRef = useRef<Map<number, number>>(new Map());
    const flowTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const idleRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const flowRevealedRef = useRef(true);
    const previousSelectionRef = useRef<{ from: number; to: number; index: number } | null>(null);

    const stopFlowTick = useCallback(() => {
      if (flowTickRef.current) {
        clearInterval(flowTickRef.current);
        flowTickRef.current = null;
      }
    }, []);

    const emitFlowState = useCallback(
      (state: Omit<FlowModeState, "modeEnabled">) => {
        onFlowStateChange?.({
          modeEnabled: flowMode,
          ...state,
        });
      },
      [flowMode, onFlowStateChange],
    );

    const clearFlowStyles = useCallback(
      (editor: Editor | null) => {
        if (!editor) return;

        for (const block of getTopLevelBlocks(editor)) {
          block.style.opacity = "";
          block.style.transition = "";
          block.style.willChange = "";
        }

        emitFlowState({
          isWriting: false,
          isRevealed: true,
          fadedCount: 0,
          activeIndex: getActiveBlockIndex(editor),
        });
      },
      [emitFlowState],
    );

    const seedTouchTimes = useCallback((editor: Editor, now: number) => {
      const blocks = getTopLevelBlocks(editor);
      const next = new Map<number, number>();

      blocks.forEach((_, index) => {
        next.set(index, paragraphTouchedAtRef.current.get(index) ?? now);
      });

      paragraphTouchedAtRef.current = next;
      return blocks;
    }, []);

    const applyFlowStyles = useCallback(
      (editor: Editor, options?: { reveal?: boolean; writing?: boolean }) => {
        const blocks = seedTouchTimes(editor, Date.now());
        const activeIndex = getActiveBlockIndex(editor);
        const revealed = options?.reveal ?? flowRevealedRef.current;
        let fadedCount = 0;

        blocks.forEach((block, index) => {
          block.style.transition = "opacity 520ms ease";
          block.style.willChange = "opacity";

          if (!flowMode || revealed || index >= activeIndex) {
            block.style.opacity = "1";
            return;
          }

          const age = Date.now() - (paragraphTouchedAtRef.current.get(index) ?? Date.now());
          const fadeProgress = clamp(
            (age - FLOW_FADE_START_MS) / (FLOW_FADE_FULL_MS - FLOW_FADE_START_MS),
            0,
            1,
          );
          const opacity = 1 - fadeProgress * (1 - FLOW_MIN_OPACITY);

          if (fadeProgress > 0.02) {
            fadedCount += 1;
          }

          block.style.opacity = `${opacity}`;
        });

        emitFlowState({
          isWriting: options?.writing ?? !revealed,
          isRevealed: revealed,
          fadedCount,
          activeIndex,
        });
      },
      [emitFlowState, flowMode, seedTouchTimes],
    );

    const revealFlow = useCallback(
      (editor: Editor | null) => {
        if (!editor) return;

        flowRevealedRef.current = true;
        stopFlowTick();
        if (idleRevealTimerRef.current) {
          clearTimeout(idleRevealTimerRef.current);
          idleRevealTimerRef.current = null;
        }
        applyFlowStyles(editor, { reveal: true, writing: false });
      },
      [applyFlowStyles, stopFlowTick],
    );

    const scheduleIdleReveal = useCallback(
      (editor: Editor) => {
        if (idleRevealTimerRef.current) {
          clearTimeout(idleRevealTimerRef.current);
        }

        idleRevealTimerRef.current = setTimeout(() => {
          revealFlow(editor);
        }, FLOW_IDLE_REVEAL_MS);
      },
      [revealFlow],
    );

    const ensureFlowTick = useCallback(
      (editor: Editor) => {
        if (flowTickRef.current) return;

        flowTickRef.current = setInterval(() => {
          if (flowRevealedRef.current) return;
          applyFlowStyles(editor, { writing: true });
        }, 500);
      },
      [applyFlowStyles],
    );

    const activateFlow = useCallback(
      (editor: Editor) => {
        if (!flowMode) return;

        const now = Date.now();
        const activeIndex = getActiveBlockIndex(editor);
        paragraphTouchedAtRef.current.set(activeIndex, now);
        flowRevealedRef.current = false;

        ensureFlowTick(editor);
        scheduleIdleReveal(editor);
        applyFlowStyles(editor, { writing: true });
      },
      [applyFlowStyles, ensureFlowTick, flowMode, scheduleIdleReveal],
    );

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          codeBlock: { HTMLAttributes: { class: "journal-code-block" } },
          blockquote: { HTMLAttributes: { class: "journal-blockquote" } },
          horizontalRule: { HTMLAttributes: { class: "journal-hr" } },
        }),
        Placeholder.configure({
          placeholder,
          emptyEditorClass: "is-editor-empty",
        }),
        Markdown.configure({
          html: false,
          transformCopiedText: true,
          transformPastedText: true,
        }),
      ],
      content: initialContent,
      editorProps: {
        attributes: {
          class: "journal-editor-content",
        },
        handleDOMEvents: {
          keydown: (_view, event) => {
            if ((event.metaKey || event.ctrlKey) && editor) {
              revealFlow(editor);
            }
            return false;
          },
        },
      },
      onUpdate: ({ editor }) => {
        onChange?.(getMarkdown(editor));

        if (onActiveParagraph) {
          try {
            const { $head } = editor.state.selection;
            const paragraphText = $head.parent.textContent;
            const paragraphIndex = editor.state.doc.resolve($head.pos).index(0);
            onActiveParagraph({ index: paragraphIndex, text: paragraphText });
          } catch {
            // ProseMirror position errors during rapid edits — safe to ignore
          }
        }

        activateFlow(editor);
      },
      onSelectionUpdate: ({ editor }) => {
        if (!flowMode) {
          previousSelectionRef.current = null;
          return;
        }

        const { from, to } = editor.state.selection;
        const activeIndex = getActiveBlockIndex(editor);
        const previous = previousSelectionRef.current;
        const movedUpward = previous ? activeIndex < previous.index || from < previous.from : false;
        const hasSelection = from !== to;

        previousSelectionRef.current = { from, to, index: activeIndex };

        if (hasSelection || movedUpward) {
          revealFlow(editor);
          return;
        }

        applyFlowStyles(editor);
      },
    });

    // Expose getMarkdown to parent
    useImperativeHandle(ref, () => ({
      getMarkdown: () => editor ? getMarkdown(editor) : "",
      revealFlow: () => revealFlow(editor),
    }), [editor, revealFlow]);

    // Update content when initialContent changes (switching entries)
    useEffect(() => {
      if (editor && initialContent !== undefined) {
        const currentMd = getMarkdown(editor);
        // Only reset if content actually changed (avoid cursor reset on re-render)
        if (currentMd !== initialContent) {
          editor.commands.setContent(initialContent);
        }
      }
    }, [editor, initialContent]);

    useEffect(() => {
      if (!editor) return;

      paragraphTouchedAtRef.current = new Map();
      previousSelectionRef.current = null;
      seedTouchTimes(editor, Date.now());

      if (!flowMode) {
        flowRevealedRef.current = true;
        stopFlowTick();
        if (idleRevealTimerRef.current) {
          clearTimeout(idleRevealTimerRef.current);
          idleRevealTimerRef.current = null;
        }
        clearFlowStyles(editor);
        return;
      }

      flowRevealedRef.current = true;
      applyFlowStyles(editor, { reveal: true, writing: false });
    }, [applyFlowStyles, clearFlowStyles, editor, flowMode, initialContent, seedTouchTimes, stopFlowTick]);

    // Auto-focus
    useEffect(() => {
      if (editor) {
        // Small delay to let the editor fully mount
        setTimeout(() => editor.commands.focus("end"), 50);
      }
    }, [editor]);

    useEffect(() => {
      return () => {
        stopFlowTick();
        if (idleRevealTimerRef.current) {
          clearTimeout(idleRevealTimerRef.current);
        }
      };
    }, [stopFlowTick]);

    if (!editor) return null;

    return <EditorContent editor={editor} />;
  }
);

export default MarkdownEditor;
