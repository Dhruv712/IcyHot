"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Editor } from "@tiptap/react";
import { Fragment } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import {
  FlowModeExtension,
  FLOW_IDLE_REVEAL_MS,
  FLOW_TICK_MS,
  getFlowDebugState,
  type FlowDebugState,
} from "@/components/journal/extensions/FlowModeExtension";
import { JournalMentionExtension } from "@/components/journal/extensions/JournalMentionExtension";
import type { JournalRichTextNode } from "@/lib/journalRichText";

export interface JournalContactOption {
  id: string;
  name: string;
  relationshipType?: string | null;
}

export interface ReminderSelectionRequest {
  text: string;
  selectionAnchor: {
    from: number;
    to: number;
  };
  contactId: string | null;
}

export interface MarkdownEditorHandle {
  getMarkdown: () => string;
  getContentJson: () => JournalRichTextNode | null;
  revealFlow: () => void;
  getFlowDebugState: () => FlowDebugState | null;
}

interface MarkdownEditorProps {
  initialContent: string;
  initialContentJson?: JournalRichTextNode | null;
  contacts?: JournalContactOption[];
  onChange?: (payload: { markdown: string; contentJson: JournalRichTextNode | null }) => void;
  onActiveParagraph?: (paragraph: { index: number; text: string }) => void;
  onCreateReminderRequest?: (selection: ReminderSelectionRequest) => void;
  placeholder?: string;
  flowMode?: boolean;
}

interface FloatingMentionState {
  query: string;
  from: number;
  to: number;
  top: number;
  left: number;
}

interface FloatingSelectionState {
  text: string;
  from: number;
  to: number;
  top: number;
  left: number;
  contactId: string | null;
}

function getMarkdown(editor: Editor): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (editor.storage as any).markdown.getMarkdown();
}

function toContentJson(editor: Editor): JournalRichTextNode | null {
  return editor.getJSON() as JournalRichTextNode;
}

function getSelectionText(editor: Editor, from: number, to: number): string {
  return editor.state.doc.textBetween(
    from,
    to,
    " ",
    (node) => (node.type.name === "journalMention" ? String(node.attrs.label ?? "") : ""),
  );
}

function getSelectionContactId(editor: Editor, from: number, to: number): string | null {
  let firstContactId: string | null = null;
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (firstContactId) return false;
    if (node.type.name !== "journalMention") return;
    if (typeof node.attrs.id === "string" && node.attrs.id.trim()) {
      firstContactId = node.attrs.id;
    }
  });
  return firstContactId;
}

function getMentionQuery(editor: Editor): { from: number; to: number; query: string } | null {
  const { state } = editor;
  if (!state.selection.empty) return null;

  const { $from, from } = state.selection;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, "\uFFFC");
  const match = /(?:^|\s)@([^\s@]*)$/.exec(textBefore);
  if (!match) return null;

  const query = match[1] ?? "";
  const atFrom = from - query.length - 1;
  if (atFrom < 0) return null;

  return {
    from: atFrom,
    to: from,
    query,
  };
}

function setEditorDocFromJson(editor: Editor, contentJson: JournalRichTextNode) {
  try {
    const nextDoc = editor.schema.nodeFromJSON(contentJson);
    const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, nextDoc.content);
    tr.setSelection(TextSelection.atEnd(tr.doc));
    editor.view.dispatch(tr);
  } catch (error) {
    console.error("[journal-editor] Failed to load structured content:", error);
  }
}

const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(
    {
      initialContent,
      initialContentJson = null,
      contacts = [],
      onChange,
      onActiveParagraph,
      onCreateReminderRequest,
      placeholder = "Start writing...",
      flowMode = false,
    },
    ref,
  ) {
    const flowTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const idleRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const editorInstanceRef = useRef<Editor | null>(null);
    const mentionStateRef = useRef<FloatingMentionState | null>(null);
    const mentionOptionsRef = useRef<JournalContactOption[]>([]);

    const [mentionState, setMentionState] = useState<FloatingMentionState | null>(null);
    const [mentionIndex, setMentionIndex] = useState(0);
    const [selectionState, setSelectionState] = useState<FloatingSelectionState | null>(null);

    const mentionOptions = useMemo(() => {
      if (!mentionState) return [];
      const query = mentionState.query.trim().toLowerCase();
      const normalized = query.replace(/^@/, "");

      const filtered = contacts.filter((contact) => {
        if (!normalized) return true;
        const haystack = [
          contact.name,
          ...contact.name.split(/\s+/),
          contact.relationshipType ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalized);
      });

      return filtered.slice(0, 6);
    }, [contacts, mentionState]);

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

    const syncFloatingUi = useCallback(
      (editor: Editor | null) => {
        if (!editor || !wrapperRef.current) {
          mentionStateRef.current = null;
          setMentionState(null);
          setSelectionState(null);
          return;
        }

        const wrapperRect = wrapperRef.current.getBoundingClientRect();
        const selection = editor.state.selection;

        if (!selection.empty) {
          const selectedText = getSelectionText(editor, selection.from, selection.to).trim();
          if (selectedText.length > 0) {
            const start = editor.view.coordsAtPos(selection.from);
            const end = editor.view.coordsAtPos(selection.to);
            setSelectionState({
              text: selectedText,
              from: selection.from,
              to: selection.to,
              top: Math.max(0, Math.min(start.top, end.top) - wrapperRect.top - 44),
              left:
                ((start.left + end.right) / 2) - wrapperRect.left,
              contactId: getSelectionContactId(editor, selection.from, selection.to),
            });
          } else {
            setSelectionState(null);
          }

          mentionStateRef.current = null;
          setMentionState(null);
          setMentionIndex(0);
          return;
        }

        setSelectionState(null);

        const query = getMentionQuery(editor);
        if (!query) {
          mentionStateRef.current = null;
          setMentionState(null);
          setMentionIndex(0);
          return;
        }

        const coords = editor.view.coordsAtPos(query.to);
        const nextState = {
          ...query,
          top: coords.bottom - wrapperRect.top + 8,
          left: coords.left - wrapperRect.left,
        };
        mentionStateRef.current = nextState;
        setMentionState(nextState);
      },
      [],
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
        JournalMentionExtension,
        FlowModeExtension.configure({
          enabled: flowMode,
        }),
      ],
      content: initialContent,
      editorProps: {
        attributes: {
          class: "journal-editor-content",
        },
        handleKeyDown: (_view, event) => {
          const activeMentionState = mentionStateRef.current;
          if (!activeMentionState) return false;
          const activeEditor = editorInstanceRef.current;
          const activeMentionOptions = mentionOptionsRef.current;

          if (event.key === "ArrowDown") {
            event.preventDefault();
            setMentionIndex((current) =>
              activeMentionOptions.length === 0
                ? 0
                : (current + 1) % activeMentionOptions.length,
            );
            return true;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            setMentionIndex((current) =>
              activeMentionOptions.length === 0
                ? 0
                : (current - 1 + activeMentionOptions.length) % activeMentionOptions.length,
            );
            return true;
          }

          if (event.key === "Enter" || event.key === "Tab") {
            const selected = activeMentionOptions[mentionIndex] ?? activeMentionOptions[0];
            if (!selected || !activeEditor) return false;
            event.preventDefault();

            const mentionNode = activeEditor.schema.nodes.journalMention?.create({
              id: selected.id,
              label: selected.name,
            });
            if (!mentionNode) return true;

            const fragment = Fragment.fromArray([
              mentionNode,
              activeEditor.schema.text(" "),
            ]);
            const tr = activeEditor.state.tr.replaceWith(
              activeMentionState.from,
              activeMentionState.to,
              fragment,
            );
            tr.setSelection(
              TextSelection.create(tr.doc, activeMentionState.from + fragment.size),
            );
            activeEditor.view.dispatch(tr.scrollIntoView());
            activeEditor.view.focus();
            mentionStateRef.current = null;
            setMentionState(null);
            setMentionIndex(0);
            return true;
          }

          if (event.key === "Escape") {
            mentionStateRef.current = null;
            setMentionState(null);
            setMentionIndex(0);
            return false;
          }

          return false;
        },
      },
      onUpdate: ({ editor }) => {
        onChange?.({
          markdown: getMarkdown(editor),
          contentJson: toContentJson(editor),
        });

        if (onActiveParagraph) {
          try {
            const { $head } = editor.state.selection;
            const paragraphText = $head.parent.textContent;
            const paragraphIndex = editor.state.doc.resolve($head.pos).index(0);
            onActiveParagraph({ index: paragraphIndex, text: paragraphText });
          } catch {
            // Safe to ignore during rapid edits
          }
        }

        syncFlowTimers(editor, true);
        syncFloatingUi(editor);
      },
      onSelectionUpdate: ({ editor }) => {
        syncFlowTimers(editor, false);
        syncFloatingUi(editor);
      },
    });

    useImperativeHandle(
      ref,
      () => ({
        getMarkdown: () => (editor ? getMarkdown(editor) : ""),
        getContentJson: () => (editor ? toContentJson(editor) : null),
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
      editorInstanceRef.current = editor ?? null;
    }, [editor]);

    useEffect(() => {
      mentionStateRef.current = mentionState;
      mentionOptionsRef.current = mentionOptions;
    }, [mentionOptions, mentionState]);

    useEffect(() => {
      if (!editor) return;

      const desiredJson = initialContentJson && typeof initialContentJson === "object"
        ? initialContentJson
        : null;

      if (desiredJson) {
        const currentJson = JSON.stringify(editor.getJSON());
        const nextJson = JSON.stringify(desiredJson);
        if (currentJson !== nextJson) {
          setEditorDocFromJson(editor, desiredJson);
          editor.commands.flowReveal();
          clearFlowTimers();
          requestAnimationFrame(() => syncFloatingUi(editor));
        }
        return;
      }

      const currentMd = getMarkdown(editor);
      if (currentMd !== initialContent) {
        editor.commands.setContent(initialContent);
        editor.commands.flowReveal();
        clearFlowTimers();
        requestAnimationFrame(() => syncFloatingUi(editor));
      }
    }, [clearFlowTimers, editor, initialContent, initialContentJson, syncFloatingUi]);

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
        setTimeout(() => {
          editor.commands.focus("end");
          syncFloatingUi(editor);
        }, 50);
      }
    }, [editor, syncFloatingUi]);

    useEffect(() => () => clearFlowTimers(), [clearFlowTimers]);

    const handleCreateReminder = useCallback(() => {
      if (!selectionState || !onCreateReminderRequest) return;
      onCreateReminderRequest({
        text: selectionState.text,
        selectionAnchor: {
          from: selectionState.from,
          to: selectionState.to,
        },
        contactId: selectionState.contactId,
      });
      setSelectionState(null);
    }, [onCreateReminderRequest, selectionState]);

    if (!editor) return null;

    return (
      <div ref={wrapperRef} className="relative">
        <EditorContent editor={editor} />

        {selectionState && onCreateReminderRequest && (
          <div
            className="absolute z-30 -translate-x-1/2"
            style={{ top: selectionState.top, left: selectionState.left }}
          >
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleCreateReminder}
              className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--amber)] shadow-lg transition-colors hover:border-[var(--amber)] hover:bg-[var(--amber-ghost-bg)]"
            >
              Create reminder
            </button>
          </div>
        )}

        {mentionState && mentionOptions.length > 0 && (
          <div
            className="absolute z-30 min-w-[240px] overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-2xl"
            style={{ top: mentionState.top, left: mentionState.left }}
          >
            <div className="border-b border-[var(--border-subtle)] px-3 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
              People
            </div>
            <div className="max-h-72 overflow-y-auto py-1">
              {mentionOptions.map((contact, index) => (
                <button
                  key={contact.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (!editor || !mentionStateRef.current) return;
                    const mentionNode = editor.schema.nodes.journalMention?.create({
                      id: contact.id,
                      label: contact.name,
                    });
                    if (!mentionNode) return;

                    const fragment = Fragment.fromArray([
                      mentionNode,
                      editor.schema.text(" "),
                    ]);
                    const activeMentionState = mentionStateRef.current;
                    const tr = editor.state.tr.replaceWith(
                      activeMentionState.from,
                      activeMentionState.to,
                      fragment,
                    );
                    tr.setSelection(
                      TextSelection.create(tr.doc, activeMentionState.from + fragment.size),
                    );
                    editor.view.dispatch(tr.scrollIntoView());
                    editor.view.focus();
                    mentionStateRef.current = null;
                    setMentionState(null);
                    setMentionIndex(0);
                  }}
                  className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left transition-colors ${
                    index === mentionIndex
                      ? "bg-[var(--amber-ghost-bg)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                  }`}
                >
                  <div>
                    <div className="text-sm font-medium">{contact.name}</div>
                    {contact.relationshipType && (
                      <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                        {contact.relationshipType.replaceAll("_", " ")}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  },
);

export default MarkdownEditor;
