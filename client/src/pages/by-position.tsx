import { useState } from "react";
import { usePlayers } from "@/hooks/use-players";
import { PlayersTable } from "@/components/players-table";
import { clsx } from "clsx";

const POSITIONS = ['C','1B','2B','3B','SS','OF','SP','RP','DH'];

export default function ByPosition() {
  const [pos, setPos] = useState("OF");
  const { data: players, isLoading } = usePlayers({ pos, status: 'available' }); // Default to available for drafts

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex items-center gap-2 p-2 bg-card border border-border/50 rounded-xl overflow-x-auto no-scrollbar shadow-lg">
        {POSITIONS.map(p => (
          <button
            key={p}
            onClick={() => setPos(p)}
            className={clsx(
              "px-6 py-2.5 rounded-lg text-sm font-bold transition-all whitespace-nowrap",
              pos === p 
                ? "bg-primary text-primary-foreground shadow-md shadow-primary/25" 
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            )}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="flex-1">
        <PlayersTable players={players} isLoading={isLoading} />
      </div>
    </div>
  );
}
