import { Link, useLocation } from "wouter";
import { useDraftState, useUpdateDraftState } from "@/hooks/use-draft";
import { 
  LayoutDashboard, 
  Users, 
  Crosshair, 
  UserCheck, 
  BookOpen, 
  ListOrdered,
  Settings2
} from "lucide-react";
import { clsx } from "clsx";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/players", label: "All Players", icon: Users },
  { href: "/by-position", label: "By Position", icon: Crosshair },
  { href: "/my-roster", label: "My Roster", icon: UserCheck },
  { href: "/cheat-sheet", label: "Cheat Sheet", icon: BookOpen },
  { href: "/round-strategy", label: "Round Strategy", icon: ListOrdered },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: draftState } = useDraftState();
  const updateDraftState = useUpdateDraftState();

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 border-r border-border/50 bg-card/50 flex flex-col backdrop-blur-xl">
        <div className="h-16 flex items-center px-6 border-b border-border/50">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center mr-3 shadow-lg shadow-primary/20">
            <Crosshair className="w-5 h-5 text-white" />
          </div>
          <h1 className="font-display font-bold text-xl tracking-tight text-foreground">
            Draft<span className="text-primary">HQ</span>
          </h1>
        </div>
        
        <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href;
            const Icon = item.icon;
            
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={clsx(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group",
                  isActive 
                    ? "bg-primary/10 text-primary" 
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                <Icon className={clsx(
                  "w-5 h-5 transition-transform duration-200", 
                  isActive ? "scale-110" : "group-hover:scale-110"
                )} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Topbar: Global Draft State */}
        <header className="h-16 flex-shrink-0 border-b border-border/50 bg-card/30 backdrop-blur-md flex items-center justify-between px-6 z-10">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 bg-muted/30 px-4 py-1.5 rounded-full border border-border/50">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Round</span>
              <input 
                type="number" 
                value={draftState?.currentRound || 1}
                onChange={(e) => updateDraftState.mutate({ currentRound: parseInt(e.target.value) || 1 })}
                className="w-10 bg-transparent text-foreground font-mono font-bold text-sm outline-none text-center"
              />
            </div>
            
            <div className="flex items-center gap-2 bg-muted/30 px-4 py-1.5 rounded-full border border-border/50">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pick</span>
              <input 
                type="number" 
                value={draftState?.currentPick || 1}
                onChange={(e) => updateDraftState.mutate({ currentPick: parseInt(e.target.value) || 1 })}
                className="w-10 bg-transparent text-foreground font-mono font-bold text-sm outline-none text-center"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-muted-foreground" />
              <select
                value={draftState?.rankMode || 'priority'}
                onChange={(e) => updateDraftState.mutate({ rankMode: e.target.value })}
                className="bg-muted/30 border border-border/50 rounded-lg px-3 py-1.5 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
              >
                <option value="priority">Priority Rank</option>
                <option value="consensus">Consensus Rank</option>
                <option value="blended">Blended Rank</option>
              </select>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto bg-gradient-to-br from-background to-card/20 p-6 relative">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/5 via-background to-background pointer-events-none" />
          <div className="relative z-10 h-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
