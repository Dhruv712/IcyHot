"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { useEffect, useImperativeHandle, forwardRef } from "react";
import type { Editor } from "@tiptap/react";

export interface MarkdownEditorHandle {
  getMarkdown: () => string;
}

// tiptap-markdown extends editor.storage with a markdown key
function getMarkdown(editor: Editor): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (editor.storage as any).markdown.getMarkdown();
}

interface MarkdownEditorProps {
  initialContent: string;
  onChange?: (markdown: string) => void;
  placeholder?: string;
}

const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor({ initialContent, onChange, placeholder = "Start writing..." }, ref) {
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
      },
      onUpdate: ({ editor }) => {
        onChange?.(getMarkdown(editor));
      },
    });

    // Expose getMarkdown to parent
    useImperativeHandle(ref, () => ({
      getMarkdown: () => editor ? getMarkdown(editor) : "",
    }), [editor]);

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

    // Auto-focus
    useEffect(() => {
      if (editor) {
        // Small delay to let the editor fully mount
        setTimeout(() => editor.commands.focus("end"), 50);
      }
    }, [editor]);

    if (!editor) return null;

    return <EditorContent editor={editor} />;
  }
);

export default MarkdownEditor;
