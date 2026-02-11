"use client";

import { useState, useCallback } from "react";
import { useSession, signIn } from "next-auth/react";
import ForceGraph from "@/components/graph/ForceGraph";
import ContactPanel from "@/components/ContactPanel";
import AddContactDialog from "@/components/AddContactDialog";
import NudgeList from "@/components/NudgeList";
import QuickLogButton from "@/components/QuickLogButton";
import { useGraphData } from "@/hooks/useGraphData";
import type { GraphNode } from "@/components/graph/types";

export default function Home() {
  const { data: session, status } = useSession();
  const { data: graphData, isLoading } = useGraphData();
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);

  const handleNodeClick = useCallback((node: GraphNode | null) => {
    setSelectedNode(node);
  }, []);

  if (status === "loading") {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-950">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-950">
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-2">
            <span className="text-blue-400">Icy</span>
            <span className="text-red-400">Hot</span>
          </h1>
          <p className="text-gray-400 mb-6">
            See your relationships. Feel the temperature.
          </p>
          <button
            onClick={() => signIn("google")}
            className="bg-white text-gray-900 font-medium px-6 py-2.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  const contactNodes = graphData?.nodes ?? [];

  return (
    <div className="h-screen w-screen overflow-hidden relative">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-3">
        <h1 className="text-lg font-bold">
          <span className="text-blue-400">Icy</span>
          <span className="text-red-400">Hot</span>
        </h1>
        <button
          onClick={() => setShowAddDialog(true)}
          className="bg-gray-800 hover:bg-gray-700 text-white text-sm px-4 py-1.5 rounded-lg transition-colors"
        >
          + Add Person
        </button>
      </div>

      {/* Graph */}
      {isLoading ? (
        <div className="h-full flex items-center justify-center">
          <div className="text-gray-500">Loading your network...</div>
        </div>
      ) : (
        <ForceGraph data={graphData ?? null} onNodeClick={handleNodeClick} />
      )}

      {/* Contact Panel (sidebar) */}
      {selectedNode && (
        <ContactPanel
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
        />
      )}

      {/* Add Contact Dialog */}
      {showAddDialog && (
        <AddContactDialog onClose={() => setShowAddDialog(false)} />
      )}

      {/* Nudge List */}
      <NudgeList nodes={contactNodes} onNodeSelect={setSelectedNode} />

      {/* Quick Log Button */}
      <QuickLogButton nodes={contactNodes} />
    </div>
  );
}
