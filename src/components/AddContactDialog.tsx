"use client";

import { useState } from "react";
import { useCreateContact } from "@/hooks/useContacts";
import { useGroups, useCreateGroup } from "@/hooks/useGroups";
import { RELATIONSHIP_LABELS } from "@/lib/constants";

interface AddContactDialogProps {
  onClose: () => void;
}

export default function AddContactDialog({ onClose }: AddContactDialogProps) {
  const [name, setName] = useState("");
  const [relationshipType, setRelationshipType] = useState("friend");
  const [importance, setImportance] = useState(5);
  const [notes, setNotes] = useState("");
  const [groupId, setGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [showNewGroup, setShowNewGroup] = useState(false);
  const createContact = useCreateContact();
  const { data: groups } = useGroups();
  const createGroup = useCreateGroup();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    let finalGroupId = groupId || undefined;

    // If creating a new group inline, do it first
    if (showNewGroup && newGroupName.trim()) {
      try {
        const newGroup = await createGroup.mutateAsync({ name: newGroupName.trim() });
        finalGroupId = newGroup.id;
      } catch {
        return; // Don't create contact if group creation fails
      }
    }

    createContact.mutate(
      {
        name: name.trim(),
        relationshipType,
        importance,
        notes: notes.trim() || undefined,
        groupId: finalGroupId,
      },
      { onSuccess: onClose }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-gray-950 border border-gray-800 rounded-xl p-6 w-full max-w-md shadow-2xl">
        <h2 className="text-lg font-semibold text-white mb-4">
          Add Connection
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Who are they?"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
              autoFocus
            />
          </div>

          {/* Relationship Type */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Relationship
            </label>
            <select
              value={relationshipType}
              onChange={(e) => setRelationshipType(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-500"
            >
              {Object.entries(RELATIONSHIP_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {/* Group */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Group (optional)
            </label>
            {!showNewGroup ? (
              <select
                value={groupId}
                onChange={(e) => {
                  if (e.target.value === "__new__") {
                    setShowNewGroup(true);
                    setGroupId("");
                  } else {
                    setGroupId(e.target.value);
                  }
                }}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-500"
              >
                <option value="">No group</option>
                {groups?.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
                <option value="__new__">＋ New group...</option>
              </select>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="Group name"
                  className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => {
                    setShowNewGroup(false);
                    setNewGroupName("");
                  }}
                  className="text-xs text-gray-500 hover:text-gray-300 transition-colors px-2"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Importance */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Importance: {importance}/10
            </label>
            <input
              type="range"
              min={1}
              max={10}
              value={importance}
              onChange={(e) => setImportance(parseInt(e.target.value))}
              className="w-full accent-blue-500"
            />
            <div className="flex justify-between text-xs text-gray-600 mt-0.5">
              <span>Acquaintance</span>
              <span>Core</span>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="How do you know them?"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-none"
              rows={2}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium py-2 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || createContact.isPending}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
            >
              {createContact.isPending ? "Adding..." : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
