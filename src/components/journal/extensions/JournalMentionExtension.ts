import { Node, mergeAttributes } from "@tiptap/core";

export interface JournalMentionAttrs {
  id: string;
  label: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    journalMention: {
      insertJournalMention: (attrs: JournalMentionAttrs) => ReturnType;
    };
  }
}

export const JournalMentionExtension = Node.create({
  name: "journalMention",
  inline: true,
  group: "inline",
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-contact-id"),
        renderHTML: (attributes) => ({
          "data-contact-id": attributes.id,
        }),
      },
      label: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-label") ?? element.textContent ?? "",
        renderHTML: (attributes) => ({
          "data-label": attributes.label,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-journal-mention]",
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-journal-mention": "true",
        class: "journal-mention",
      }),
      node.attrs.label,
    ];
  },

  renderText({ node }) {
    return node.attrs.label || "";
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { text: (value: string) => void }, node: { attrs?: JournalMentionAttrs }) {
          state.text(node.attrs?.label || "");
        },
      },
    };
  },

  addCommands() {
    return {
      insertJournalMention:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
          }),
    };
  },
});
