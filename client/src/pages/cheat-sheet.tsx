import { useCheatSheet, useUpdateCheatSheet } from "@/hooks/use-cheat-sheet";
import { BookOpen } from "lucide-react";

const SECTIONS = [
  { id: 'strategy', title: 'Overall Strategy', color: 'text-primary' },
  { id: 'avoid', title: 'Do Not Draft', color: 'text-red-400' },
  { id: 'sleepers', title: 'Late Round Sleepers', color: 'text-purple-400' },
  { id: 'scratchpad', title: 'Scratchpad', color: 'text-muted-foreground' }
];

export default function CheatSheet() {
  const { data: cheatSheet, isLoading } = useCheatSheet();
  const updateCheatSheet = useUpdateCheatSheet();

  if (isLoading) return null;

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex items-center gap-3 mb-2">
        <BookOpen className="w-8 h-8 text-primary" />
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Cheat Sheet</h1>
          <p className="text-muted-foreground text-sm">Your personal scratchpad. Saves automatically on blur.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 pb-6">
        {SECTIONS.map(section => (
          <div key={section.id} className="flex flex-col bg-card/80 backdrop-blur rounded-2xl border border-border/50 shadow-xl overflow-hidden group focus-within:ring-2 focus-within:ring-primary/20 transition-all">
             <div className={`px-5 py-3 border-b border-border/50 bg-muted/20 font-display font-bold tracking-wide ${section.color}`}>
               {section.title}
             </div>
             <textarea
               className="flex-1 w-full p-5 bg-transparent border-none resize-none focus:outline-none text-[13px] font-mono text-foreground placeholder:text-muted-foreground/30 leading-relaxed"
               defaultValue={cheatSheet?.[section.id] || ''}
               onBlur={(e) => {
                 if (e.target.value !== cheatSheet?.[section.id]) {
                   updateCheatSheet.mutate({ section: section.id, content: e.target.value });
                 }
               }}
               placeholder={`Enter your ${section.id} notes here...`}
             />
          </div>
        ))}
      </div>
    </div>
  );
}
