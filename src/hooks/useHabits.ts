import { useQuery } from "@tanstack/react-query";

interface ContactStreakHabit {
  contactId: string;
  name: string;
  weeks: number;
  thisWeekDone: boolean;
}

interface BehavioralHabit {
  id: string;
  content: string;
  reinforcementCount: number;
  lastReinforcedAt: string;
  daysSinceReinforced: number;
  active: boolean;
}

interface HabitsData {
  contactStreaks: ContactStreakHabit[];
  behavioralHabits: BehavioralHabit[];
}

export function useHabits() {
  return useQuery<HabitsData>({
    queryKey: ["habits"],
    queryFn: async () => {
      const res = await fetch("/api/habits");
      if (!res.ok) throw new Error("Failed to fetch habits");
      return res.json();
    },
    staleTime: 5 * 60 * 1000, // 5 min
  });
}
