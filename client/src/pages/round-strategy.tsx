import { useRoundStrategy, useUpdateRoundStrategy } from "@/hooks/use-round-strategy";
import { ListOrdered } from "lucide-react";

export default function RoundStrategy() {
  const { data: strategy, isLoading } = useRoundStrategy();
  const updateStrategy = useUpdateRoundStrategy();

  if (isLoading) return null;

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex items-center gap-3 mb-2">
        <ListOrdered className="w-8 h-8 text-primary" />
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Round Strategy</h1>
          <p className="text-muted-foreground text-sm">Plan your positional targets and tiers round by round.</p>
        </div>
      </div>

      <div className="rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-2xl overflow-hidden flex-1 mb-6 flex flex-col">
        <div className="overflow-auto no-scrollbar flex-1">
          <table className="w-full text-left border-collapse tabular-nums text-[13px]">
            <thead className="sticky top-0 z-20 bg-card/95 backdrop-blur shadow-sm shadow-black/10">
              <tr className="border-b border-border/50 text-muted-foreground font-semibold font-sans uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4 w-16 text-center">Round</th>
                <th className="py-3 px-4 w-32">Picks</th>
                <th className="py-3 px-4 w-48">Targets (Pos)</th>
                <th className="py-3 px-4 w-32">Tier</th>
                <th className="py-3 px-4 w-64">Targets (Names)</th>
                <th className="py-3 px-4">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {strategy?.map(row => (
                <tr key={row.id} className="hover:bg-muted/20 transition-colors group">
                  <td className="py-2.5 px-4 text-center font-bold text-foreground bg-muted/10">
                    {row.roundNum}
                  </td>
                  <td className="py-2.5 px-4">
                    <input 
                      defaultValue={row.picksRange || ''}
                      onBlur={(e) => updateStrategy.mutate({ id: row.id, picksRange: e.target.value })}
                      className="w-full bg-transparent border-b border-transparent hover:border-border focus:border-primary outline-none transition-colors font-mono text-muted-foreground focus:text-foreground"
                      placeholder="e.g. 1-12"
                    />
                  </td>
                  <td className="py-2.5 px-4">
                    <input 
                      defaultValue={row.targetPositions || ''}
                      onBlur={(e) => updateStrategy.mutate({ id: row.id, targetPositions: e.target.value })}
                      className="w-full bg-transparent border-b border-transparent hover:border-border focus:border-primary outline-none transition-colors text-primary font-bold"
                      placeholder="SP, OF"
                    />
                  </td>
                  <td className="py-2.5 px-4">
                    <input 
                      defaultValue={row.tier || ''}
                      onBlur={(e) => updateStrategy.mutate({ id: row.id, tier: e.target.value })}
                      className="w-full bg-transparent border-b border-transparent hover:border-border focus:border-primary outline-none transition-colors text-purple-400"
                      placeholder="Tier 1"
                    />
                  </td>
                  <td className="py-2.5 px-4">
                    <input 
                      defaultValue={row.targetNames || ''}
                      onBlur={(e) => updateStrategy.mutate({ id: row.id, targetNames: e.target.value })}
                      className="w-full bg-transparent border-b border-transparent hover:border-border focus:border-primary outline-none transition-colors"
                      placeholder="Judge, Acuna"
                    />
                  </td>
                  <td className="py-2.5 px-4">
                    <input 
                      defaultValue={row.notes || ''}
                      onBlur={(e) => updateStrategy.mutate({ id: row.id, notes: e.target.value })}
                      className="w-full bg-transparent border-b border-transparent hover:border-border focus:border-primary outline-none transition-colors text-muted-foreground focus:text-foreground"
                      placeholder="Reach if needed..."
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
