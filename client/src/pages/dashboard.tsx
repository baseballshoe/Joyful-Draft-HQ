import { useDashboard } from "@/hooks/use-dashboard";
import { Users, Target, Zap, Trophy, Shield, Layers, UserCheck } from "lucide-react";
import type { EnrichedPlayer } from "@shared/schema";
import { clsx } from "clsx";

function MiniList({ title, players, icon: Icon, color }: { title: string, players: EnrichedPlayer[], icon: any, color: string }) {
  return (
    <div className="flex flex-col bg-card/60 backdrop-blur border border-border/50 rounded-xl overflow-hidden shadow-lg h-full">
      <div className={clsx("px-4 py-3 border-b border-border/50 flex items-center gap-2 font-display font-semibold", color)}>
         <Icon className="w-4 h-4" />
         {title}
      </div>
      <div className="flex flex-col divide-y divide-border/30 overflow-y-auto no-scrollbar flex-1">
        {players.length === 0 ? (
           <div className="p-6 text-sm text-muted-foreground text-center flex-1 flex items-center justify-center">No players</div>
        ) : players.map(p => (
           <div key={p.id} className="px-4 py-2.5 flex items-center justify-between hover:bg-muted/20 transition-colors">
             <div className="flex items-center gap-3">
               <span className="text-xs font-mono text-muted-foreground w-5 text-right">{Math.round(p.consensusRank || 0)}</span>
               <div className="flex flex-col">
                 <span className={clsx("text-[13px] font-medium leading-none", p.status === 'drafted' ? "line-through text-muted-foreground" : "text-foreground")}>{p.name}</span>
                 <span className="text-[10px] text-muted-foreground mt-0.5">{p.team || 'FA'}</span>
               </div>
             </div>
             <span className="text-[10px] font-bold text-muted-foreground px-1.5 py-0.5 rounded bg-muted/50 border border-border/50">
               {p.posDisplay}
             </span>
           </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data, isLoading } = useDashboard();

  if (isLoading) return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="animate-spin w-10 h-10 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  );

  if (!data) return null;

  return (
    <div className="h-full flex flex-col gap-6">
      
      {/* Top Banner - Next Best Available */}
      {data.nextBest && (
        <div className="bg-gradient-to-r from-primary/20 via-primary/10 to-transparent border border-primary/20 rounded-xl p-4 flex items-center justify-between shadow-lg shadow-primary/5">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
              <Zap className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-xs font-bold text-primary uppercase tracking-wider mb-0.5">Next Best Available</p>
              <h2 className="text-xl font-display font-bold text-foreground">
                {data.nextBest.name} <span className="text-sm font-sans font-normal text-muted-foreground ml-2">{data.nextBest.posDisplay} • {data.nextBest.team}</span>
              </h2>
            </div>
          </div>
          <div className="flex gap-4 items-center">
             <div className="text-right">
               <p className="text-xs text-muted-foreground">Consensus</p>
               <p className="font-mono font-bold text-lg">{data.nextBest.consensusRank}</p>
             </div>
          </div>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-6 flex-1 min-h-0">
        
        {/* Left Col - Current Rounds */}
        <div className="lg:col-span-1 xl:col-span-1 flex flex-col gap-6 h-full overflow-y-auto no-scrollbar pr-2">
          {Object.entries(data.roundData).map(([r, players]) => (
             <MiniList 
               key={r}
               title={`Round ${r} Projection`} 
               players={players} 
               icon={Layers} 
               color={parseInt(r) === data.state.currentRound ? "text-primary" : "text-muted-foreground"} 
             />
          ))}
        </div>

        {/* Right Cols - Lists */}
        <div className="lg:col-span-2 xl:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-6 h-full overflow-y-auto no-scrollbar pr-2 pb-6">
          <MiniList title="My Roster" players={data.myRoster} icon={UserCheck} color="text-green-400" />
          <MiniList title="Top 10 Targets" players={data.top10Targets} icon={Target} color="text-primary" />
          <MiniList title="Sleepers" players={data.sleepers} icon={Zzz} color="text-purple-400" />
          <MiniList title="Top 5 Overall" players={data.top5} icon={Trophy} color="text-yellow-500" />
          
          {/* Best By Pos (Special Rendering) */}
          <div className="flex flex-col bg-card/60 backdrop-blur border border-border/50 rounded-xl overflow-hidden shadow-lg col-span-1 md:col-span-2">
            <div className="px-4 py-3 border-b border-border/50 flex items-center gap-2 font-display font-semibold text-blue-400">
               <Shield className="w-4 h-4" />
               Best Available By Position
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 p-4 gap-3">
              {Object.entries(data.bestByPos).map(([pos, p]) => (
                <div key={pos} className="bg-muted/30 border border-border/50 rounded-lg p-3 flex flex-col gap-1">
                  <span className="text-xs font-bold text-muted-foreground uppercase">{pos}</span>
                  {p ? (
                    <>
                      <span className="text-sm font-semibold truncate" title={p.name}>{p.name}</span>
                      <span className="text-[10px] font-mono text-muted-foreground">Rk: {Math.round(p.consensusRank || 0)}</span>
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground/50 italic">None</span>
                  )}
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// Simple icon for Zzz
function Zzz(props: any) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 12h6l-6 8h6"/><path d="M14 4h6l-6 8h6"/>
    </svg>
  );
}
