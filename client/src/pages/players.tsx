import { useState } from "react";
import { usePlayers } from "@/hooks/use-players";
import { PlayersTable } from "@/components/players-table";
import { Search, Filter } from "lucide-react";

export default function Players() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("available");
  const [pos, setPos] = useState("all");
  const [tag, setTag] = useState("all");

  const { data: players, isLoading } = usePlayers({ search, status, pos, tag });

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-card border border-border/50 p-4 rounded-xl shadow-lg">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search players or teams..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-background border border-border/50 rounded-lg text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all"
          />
        </div>
        
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground hidden sm:block" />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="bg-background border border-border/50 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary cursor-pointer min-w-[120px]"
            >
              <option value="all">All Status</option>
              <option value="available">Available</option>
              <option value="mine">My Roster</option>
              <option value="drafted">Drafted</option>
            </select>
          </div>

          <select
            value={pos}
            onChange={(e) => setPos(e.target.value)}
            className="bg-background border border-border/50 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary cursor-pointer min-w-[100px]"
          >
            <option value="all">All Pos</option>
            {['C','1B','2B','3B','SS','OF','SP','RP','DH'].map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>

          <select
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            className="bg-background border border-border/50 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary cursor-pointer min-w-[120px]"
          >
            <option value="all">All Tags</option>
            <option value="target">Target</option>
            <option value="sleeper">Sleeper</option>
            <option value="avoid">Avoid</option>
            <option value="watch">Watch</option>
          </select>
        </div>
      </div>

      <PlayersTable players={players} isLoading={isLoading} />
    </div>
  );
}
