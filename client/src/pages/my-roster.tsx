import { usePlayers } from "@/hooks/use-players";
import { PlayersTable } from "@/components/players-table";
import { UserCheck } from "lucide-react";

export default function MyRoster() {
  const { data: players, isLoading } = usePlayers({ status: 'mine' });

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="bg-gradient-to-r from-green-500/20 via-background to-background border border-green-500/20 rounded-xl p-6 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
            <UserCheck className="w-6 h-6 text-green-400" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground tracking-tight">My Roster</h1>
            <p className="text-muted-foreground text-sm mt-1">Players you have drafted so far.</p>
          </div>
        </div>
      </div>

      <div className="flex-1">
        <PlayersTable players={players} isLoading={isLoading} />
      </div>
    </div>
  );
}
