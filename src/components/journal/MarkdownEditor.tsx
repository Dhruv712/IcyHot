"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { useCallback, useEffect, useImperativeHandle, forwardRef, useRef } from "react";
import type { Editor } from "@tiptap/react";
import {
  FlowModeExtension,
  FLOW_IDLE_REVEAL_MS,
  FLOW_TICK_MS,
  getFlowDebugState,
  type FlowDebugState,
} from "@/components/journal/extensions/FlowModeExtension";

export interface MarkdownEditorHandle {
  getMarkdown: () => string;
  revealFlow: () => void;
  getFlowDebugState: () => FlowDebugState | null;
}

// tiptap-markdown extends editor.storage with a markdown key
function getMarkdown(editor: Editor): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (editor.storage as any).markdown.getMarkdown();
}

interface MarkdownEditorProps {
  initialContent: string;
  onChange?: (markdown: string) => void;
  onActiveParagraph?: (paragraph: { index: number; text: string }) => void;
  placeholder?: string;
  flowMode?: boolean;
}

const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(
    {
      initialContent,
      onChange,
      onActiveParagraph,
      placeholder = "Start writing...",
      flowMode = false,
    },
    ref,
  ) {
    const flowTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const idleRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearFlowTimers = useCallback(() => {
      if (flowTickRef.current) {
        clearInterval(flowTickRef.current);
        flowTickRef.current = null;
      }
      if (idleRevealTimerRef.current) {
        clearTimeout(idleRevealTimerRef.current);
        idleRevealTimerRef.current = null;
      }
    }, []);

    const syncFlowTimers = useCallback(
      (editor: Editor | null, armIdleReveal: boolean) => {
        if (!editor || !flowMode) {
          clearFlowTimers();
          return;
        }

        const debug = getFlowDebugState(editor);
        if (!debug || debug.revealed || !debug.writing) {
          clearFlowTimers();
          return;
        }

        if (!flowTickRef.current) {
          flowTickRef.current = setInterval(() => {
            editor.commands.flowTick();
          }, FLOW_TICK_MS);
        }

        if (armIdleReveal) {
          if (idleRevealTimerRef.current) {
            clearTimeout(idleRevealTimerRef.current);
          }
          idleRevealTimerRef.current = setTimeout(() => {
            editor.commands.flowReveal();
            clearFlowTimers();
          }, FLOW_IDLE_REVEAL_MS);
        }
      },
      [clearFlowTimers, flowMode],
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
        FlowModeExtension.configure({
          enabled: flowMode,
        }),
      ],
      content: initialContent,
      editorProps: {
        attributes: {
          class: "journal-editor-content",
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

        syncFlowTimers(editor, true);
      },
      onSelectionUpdate: ({ editor }) => {
        syncFlowTimers(editor, false);
      },
    });

    useImperativeHandle(
      ref,
      () => ({
        getMarkdown: () => (editor ? getMarkdown(editor) : ""),
        revealFlow: () => {
          if (!editor) return;
          editor.commands.flowReveal();
          clearFlowTimers();
        },
        getFlowDebugState: () => getFlowDebugState(editor),
      }),
      [clearFlowTimers, editor],
    );

    useEffect(() => {
      if (!editor) return;

      if (initialContent === undefined) return;
      const currentMd = getMarkdown(editor);
      if (currentMd !== initialContent) {
        editor.commands.setContent(initialContent);
        editor.commands.flowReveal();
        clearFlowTimers();
      }
    }, [clearFlowTimers, editor, initialContent]);

    useEffect(() => {
      if (!editor) return;

      editor.commands.flowSetEnabled(flowMode);
      syncFlowTimers(editor, false);

      if (!flowMode) {
        clearFlowTimers();
      }
    }, [clearFlowTimers, editor, flowMode, syncFlowTimers]);

    useEffect(() => {
      if (editor) {
        setTimeout(() => editor.commands.focus("end"), 50);
      }
    }, [editor]);

    useEffect(() => () => clearFlowTimers(), [clearFlowTimers]);

    if (!editor) return null;

    return <EditorContent editor={editor} />;
  },
);

export default MarkdownEditor;
