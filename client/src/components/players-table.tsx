import { useState } from "react";
import { useUpdatePlayer, useResetPlayer } from "@/hooks/use-players";
import type { EnrichedPlayer } from "@shared/schema";
import { clsx } from "clsx";
import { Search, Tag, X, Check, ArrowRight } from "lucide-react";

export function PlayersTable({ players, isLoading }: { players?: EnrichedPlayer[], isLoading?: boolean }) {
  const updatePlayer = useUpdatePlayer();
  const resetPlayer = useResetPlayer();

  const handleRankBlur = (player: EnrichedPlayer, val: string) => {
    const num = parseInt(val, 10);
    if (!isNaN(num) && num !== player.myRank) {
      updatePlayer.mutate({ id: player.id, myRank: num });
    } else if (val === '' && player.myRank !== null) {
      updatePlayer.mutate({ id: player.id, myRank: null });
    }
  };

  const toggleTag = (player: EnrichedPlayer, tag: string) => {
    const currentTags = player.tags ? player.tags.split(',').filter(Boolean) : [];
    let newTags;
    if (currentTags.includes(tag)) {
      newTags = currentTags.filter(t => t !== tag);
    } else {
      newTags = [...currentTags, tag];
    }
    updatePlayer.mutate({ id: player.id, tags: newTags.join(',') });
  };

  if (isLoading) {
    return (
      <div className="w-full h-64 flex items-center justify-center border border-border/50 rounded-xl bg-card">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!players || players.length === 0) {
    return (
      <div className="w-full h-64 flex flex-col items-center justify-center border border-border/50 rounded-xl bg-card text-muted-foreground">
        <Search className="w-12 h-12 mb-3 opacity-20" />
        <p className="font-medium">No players found matching criteria</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-12rem)]">
      <div className="overflow-auto no-scrollbar flex-1">
        <table className="w-full text-left border-collapse tabular-nums text-[13px]">
          <thead className="sticky top-0 z-20 bg-card/95 backdrop-blur shadow-sm shadow-black/10">
            <tr className="border-b border-border/50 text-muted-foreground font-semibold font-sans uppercase tracking-wider text-[11px]">
              <th className="py-3 px-4 w-12 text-center">Rk</th>
              <th className="py-3 px-4">Player</th>
              <th className="py-3 px-4 w-16 text-center">Pos</th>
              <th className="py-3 px-4 w-16 text-center">ESPN</th>
              <th className="py-3 px-4 w-16 text-center">Yahoo</th>
              <th className="py-3 px-4 w-24 text-center">My Rk</th>
              <th className="py-3 px-4 w-48">Tags</th>
              <th className="py-3 px-4 w-32 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {players.map(p => {
              const isMine = p.status === 'mine';
              const isDrafted = p.status === 'drafted';
              const tagsList = p.tags ? p.tags.split(',').filter(Boolean) : [];

              return (
                <tr 
                  key={p.id} 
                  className={clsx(
                    "group transition-colors duration-150",
                    isMine ? "bg-green-500/5 hover:bg-green-500/10" : 
                    isDrafted ? "bg-red-500/5 hover:bg-red-500/10 opacity-50" : 
                    "hover:bg-muted/30"
                  )}
                >
                  <td className="py-2 px-4 text-center font-mono text-muted-foreground">
                    {p.consensusRank ? Math.round(p.consensusRank) : '-'}
                  </td>
                  <td className="py-2 px-4">
                    <div className="flex flex-col">
                      <span className={clsx("font-semibold text-sm", isDrafted ? "line-through" : "text-foreground")}>
                        {p.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground uppercase">{p.team || 'FA'}</span>
                    </div>
                  </td>
                  <td className="py-2 px-4 text-center">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-muted text-muted-foreground">
                      {p.posDisplay}
                    </span>
                  </td>
                  <td className="py-2 px-4 text-center font-mono text-muted-foreground">{p.espnRank || '-'}</td>
                  <td className="py-2 px-4 text-center font-mono text-muted-foreground">{p.yahooRank || '-'}</td>
                  <td className="py-2 px-4 text-center">
                    <input 
                      type="number" 
                      defaultValue={p.myRank || ''}
                      onBlur={(e) => handleRankBlur(p, e.target.value)}
                      className={clsx(
                        "w-14 h-7 text-center rounded bg-background/50 border border-transparent hover:border-border focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none transition-all font-mono font-semibold",
                        p.myRank ? "text-primary" : "text-muted-foreground"
                      )}
                      placeholder="-"
                    />
                  </td>
                  <td className="py-2 px-4">
                    <div className="flex flex-wrap gap-1 items-center">
                      {tagsList.map(tag => (
                        <span 
                          key={tag} 
                          onClick={() => toggleTag(p, tag)}
                          className={clsx(
                            "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase cursor-pointer transition-colors border",
                            tag === 'target' ? "bg-primary/20 text-primary border-primary/30 hover:bg-primary/30" :
                            tag === 'sleeper' ? "bg-purple-500/20 text-purple-400 border-purple-500/30 hover:bg-purple-500/30" :
                            tag === 'avoid' ? "bg-orange-500/20 text-orange-400 border-orange-500/30 hover:bg-orange-500/30" :
                            "bg-muted text-muted-foreground border-transparent hover:bg-muted/80"
                          )}
                        >
                          {tag}
                        </span>
                      ))}
                      
                      {/* Quick Tag Adders */}
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
                        {!tagsList.includes('target') && (
                          <button onClick={() => toggleTag(p, 'target')} className="w-5 h-5 rounded flex items-center justify-center bg-muted hover:bg-primary/20 hover:text-primary transition-colors text-[10px]" title="Target">T</button>
                        )}
                        {!tagsList.includes('sleeper') && (
                          <button onClick={() => toggleTag(p, 'sleeper')} className="w-5 h-5 rounded flex items-center justify-center bg-muted hover:bg-purple-500/20 hover:text-purple-400 transition-colors text-[10px]" title="Sleeper">S</button>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-2 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => updatePlayer.mutate({ id: p.id, status: 'available' })}
                        className={clsx(
                          "w-7 h-7 rounded flex items-center justify-center text-[11px] font-bold transition-all border",
                          p.status === 'available' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' : 'bg-transparent text-muted-foreground border-transparent hover:bg-muted'
                        )}
                        title="Available"
                      >
                        A
                      </button>
                      <button
                        onClick={() => updatePlayer.mutate({ id: p.id, status: 'mine' })}
                        className={clsx(
                          "w-7 h-7 rounded flex items-center justify-center text-[11px] font-bold transition-all border",
                          p.status === 'mine' ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-transparent text-muted-foreground border-transparent hover:bg-muted'
                        )}
                        title="Mine"
                      >
                        M
                      </button>
                      <button
                        onClick={() => updatePlayer.mutate({ id: p.id, status: 'drafted' })}
                        className={clsx(
                          "w-7 h-7 rounded flex items-center justify-center text-[11px] font-bold transition-all border",
                          p.status === 'drafted' ? 'bg-red-500/20 text-red-400 border-red-500/30' : 'bg-transparent text-muted-foreground border-transparent hover:bg-muted'
                        )}
                        title="Drafted"
                      >
                        D
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
